import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  entityCurrent,
  entityRevisions,
  ingestEvents,
  outbox,
  projectorRuns,
} from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import {
  isCyclicEntityType,
  mappingFor,
  resolveEntityIdentity,
  statePrecedence,
} from './entity-mapping.js';
import type { CanonicalEventType } from '../../contracts/events/event-types.js';
import { createProjectionProvenance } from '../provenance/provenance-service.js';

export const PROJECTOR_NAME = 'canonical-entity-projector';
export const PROJECTOR_VERSION = 'v1';

export type ProjectionStatus = 'applied' | 'already_applied' | 'not_found';

export interface ProjectionResult {
  readonly status: ProjectionStatus;
  readonly entityKey?: string;
  readonly becameCurrent?: boolean;
}

/**
 * Idempotent projector (backend PRD §9.2): current state uses the source
 * entity version when available, otherwise event time; late/out-of-order
 * events are ALWAYS retained in `entity_revisions` history and never regress
 * `entity_current` — a late event that arrives with an earlier event_time (and
 * no higher source version) is recorded but does not move the current pointer.
 */
export async function projectIngestEvent(
  db: Database,
  ctx: TenantContext,
  ingestEventId: string,
  options: { readonly replay?: boolean } = {},
): Promise<ProjectionResult> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|${PROJECTOR_NAME}|${PROJECTOR_VERSION}|${ingestEventId}`}, 0))`,
    );
    const existingRun = await tx
      .select()
      .from(projectorRuns)
      .where(
        and(
          eq(projectorRuns.tenantId, ctx.tenantId),
          eq(projectorRuns.projectorName, PROJECTOR_NAME),
          eq(projectorRuns.projectorVersion, PROJECTOR_VERSION),
          eq(projectorRuns.ingestEventId, ingestEventId),
        ),
      )
      .limit(1);
    if (existingRun[0]) {
      const priorEvent = await tx
        .select()
        .from(ingestEvents)
        .where(and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, ingestEventId)))
        .limit(1);
      const priorType = priorEvent[0]?.eventType as CanonicalEventType | null | undefined;
      if (!priorEvent[0] || !priorType) return { status: 'already_applied' as const };
      const priorMapping = mappingFor(priorType);
      const priorIdentity = resolveEntityIdentity(
        priorMapping,
        (priorEvent[0].entityReferences ?? {}) as Record<string, string | null | undefined>,
        priorEvent[0].economicSubjectHint,
      );
      return {
        status: 'already_applied' as const,
        entityKey: priorIdentity.entityKey,
      };
    }

    const eventRows = await tx
      .select()
      .from(ingestEvents)
      .where(and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, ingestEventId)))
      .limit(1);
    const ingestEvent = eventRows[0];
    if (!ingestEvent) {
      return { status: 'not_found' as const };
    }

    const eventType = ingestEvent.eventType as CanonicalEventType | null;
    if (!eventType) {
      // Unmapped/unknown canonical event type: record the projector run as
      // applied (so it is never retried) but project nothing further.
      await tx.insert(projectorRuns).values({
        id: `run_${randomUUID()}`,
        tenantId: ctx.tenantId,
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
        ingestEventId,
        status: 'skipped',
      });
      return { status: 'applied' as const };
    }

    const mapping = mappingFor(eventType);
    const entityReferences = (ingestEvent.entityReferences ?? {}) as Record<
      string,
      string | null | undefined
    >;
    const { entityKey, sourceEntityId } = resolveEntityIdentity(
      mapping,
      entityReferences,
      ingestEvent.economicSubjectHint,
    );

    const revisionId = `rev_${randomUUID()}`;
    await tx.insert(entityRevisions).values({
      id: revisionId,
      tenantId: ctx.tenantId,
      entityType: mapping.entityType,
      entityKey,
      sourceSystem: ingestEvent.sourceSystem,
      sourceEntityId,
      revisionKey: ingestEventId,
      sourceEntityVersion: ingestEvent.sourceEntityVersion,
      businessState: mapping.businessState,
      amountMinor: ingestEvent.amountMinor,
      currency: ingestEvent.currency,
      eventTime: ingestEvent.eventTime,
      ingestEventId,
    });

    const currentRows = await tx
      .select()
      .from(entityCurrent)
      .where(and(eq(entityCurrent.tenantId, ctx.tenantId), eq(entityCurrent.entityKey, entityKey)))
      .limit(1);
    const current = currentRows[0];

    let becameCurrent = false;
    if (!current) {
      await tx.insert(entityCurrent).values({
        tenantId: ctx.tenantId,
        entityKey,
        entityType: mapping.entityType,
        currentRevisionId: revisionId,
      });
      becameCurrent = true;
    } else {
      // The tiebreaker must be deterministic CONTENT identity, never the
      // random ingestion-time surrogate id (`entity_revisions.revision_key`
      // stores `ingest_event_id` purely for the storage-layer uniqueness
      // constraint — see the column comment — it must never leak into an
      // ordering decision). `payload_hash` is derived from the event's own
      // bytes at ingestion, so two independently-rebuilt databases fed the
      // same logical events resolve same-instant ties identically.
      const currentRevisionRows = await tx
        .select({
          sourceEntityVersion: entityRevisions.sourceEntityVersion,
          entityType: entityRevisions.entityType,
          businessState: entityRevisions.businessState,
          eventTime: entityRevisions.eventTime,
          payloadHash: ingestEvents.payloadHash,
        })
        .from(entityRevisions)
        .innerJoin(
          ingestEvents,
          and(
            eq(ingestEvents.tenantId, entityRevisions.tenantId),
            eq(ingestEvents.id, entityRevisions.ingestEventId),
          ),
        )
        .where(eq(entityRevisions.id, current.currentRevisionId))
        .limit(1);
      const currentRevision = currentRevisionRows[0];
      const isLater =
        !currentRevision ||
        compareProjectionOrder(
          {
            sourceVersion: ingestEvent.sourceEntityVersion,
            entityType: mapping.entityType,
            businessState: mapping.businessState,
            eventTime: ingestEvent.eventTime,
            tieBreaker: ingestEvent.payloadHash,
          },
          {
            sourceVersion: currentRevision.sourceEntityVersion,
            entityType: currentRevision.entityType,
            businessState: currentRevision.businessState,
            eventTime: currentRevision.eventTime,
            tieBreaker: currentRevision.payloadHash,
          },
        ) > 0;
      if (isLater) {
        await tx
          .update(entityCurrent)
          .set({ currentRevisionId: revisionId, updatedAt: new Date() })
          .where(
            and(eq(entityCurrent.tenantId, ctx.tenantId), eq(entityCurrent.entityKey, entityKey)),
          );
        becameCurrent = true;
      }
    }

    await tx.insert(projectorRuns).values({
      id: `run_${randomUUID()}`,
      tenantId: ctx.tenantId,
      projectorName: PROJECTOR_NAME,
      projectorVersion: PROJECTOR_VERSION,
      ingestEventId,
      status: 'applied',
    });
    if (!options.replay) {
      await tx
        .insert(outbox)
        .values({
          id: `outbox_${randomUUID()}`,
          tenantId: ctx.tenantId,
          topic: 'evaluate-controls.v1',
          domainEventId: `${ingestEventId}:controls`,
          payload: {
            tenant_id: ctx.tenantId,
            ingest_event_id: ingestEventId,
            entity_key: entityKey,
            became_current: becameCurrent,
          },
        })
        .onConflictDoNothing();
    }

    return { status: 'applied' as const, entityKey, becameCurrent };
  });
  if ((result.status === 'applied' || result.status === 'already_applied') && result.entityKey) {
    const rows = await db
      .select({
        eventType: ingestEvents.eventType,
        subjectKey: ingestEvents.economicSubjectHint,
      })
      .from(ingestEvents)
      .where(and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, ingestEventId)))
      .limit(1);
    const event = rows[0];
    if (event?.eventType && event.subjectKey) {
      const mapping = mappingFor(event.eventType as CanonicalEventType);
      await createProjectionProvenance(db, ctx, {
        ingestEventId,
        subjectKey: event.subjectKey,
        entityKey: result.entityKey,
        entityType: mapping.entityType,
      });
    }
  }
  return result;
}

interface ProjectionOrder {
  readonly sourceVersion: number | null;
  readonly entityType: string;
  readonly businessState: string;
  readonly eventTime: Date;
  readonly tieBreaker: string;
}

/** Positive means candidate is newer/more authoritative than current. */
export function compareProjectionOrder(
  candidate: ProjectionOrder,
  current: ProjectionOrder,
): number {
  if (candidate.sourceVersion != null || current.sourceVersion != null) {
    if (candidate.sourceVersion == null) return -1;
    if (current.sourceVersion == null) return 1;
    if (candidate.sourceVersion !== current.sourceVersion) {
      return candidate.sourceVersion - current.sourceVersion;
    }
  }

  if (!isCyclicEntityType(candidate.entityType)) {
    const stateDifference =
      statePrecedence(candidate.entityType, candidate.businessState) -
      statePrecedence(current.entityType, current.businessState);
    if (stateDifference !== 0) return stateDifference;
  }

  const timeDifference = candidate.eventTime.getTime() - current.eventTime.getTime();
  if (timeDifference !== 0) return timeDifference;
  return candidate.tieBreaker.localeCompare(current.tieBreaker);
}
