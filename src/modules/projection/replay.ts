import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { entityCurrent, entityRevisions, ingestEvents } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { CanonicalEventType } from '../../contracts/events/event-types.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { compareProjectionOrder, projectIngestEvent } from './projector.js';
import { mappingFor, resolveEntityIdentity } from './entity-mapping.js';

interface ManifestRevision {
  readonly entityKey: string;
  /**
   * Deterministic content identity for this revision — the ingested event's
   * `payload_hash`, NOT a database surrogate id. Two independently rebuilt
   * databases fed the same logical events (even with entirely different
   * random `ingest_events.id`/`entity_revisions.id` values) produce the same
   * `identityHash` for the same logical revision, so the manifest — and the
   * ordering decisions that feed it via `compareProjectionOrder`'s tiebreaker
   * — are reproducible across fresh rebuilds, not merely across two replays
   * of the SAME already-populated database.
   */
  readonly identityHash: string;
  readonly state: string;
  readonly sourceVersion: number | null;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly eventTime: string;
}

/**
 * Re-run every idempotent projector and independently rebuild its expected
 * current/history state in memory. The shadow manifest contains no database
 * surrogate UUIDs, so it is stable across real rebuilds and can be compared
 * safely without deleting append-only evidence or history.
 */
export async function replayTenantProjections(db: Database, ctx: TenantContext) {
  const events = await db
    .select()
    .from(ingestEvents)
    .where(eq(ingestEvents.tenantId, ctx.tenantId))
    .orderBy(asc(ingestEvents.eventTime), asc(ingestEvents.id));
  for (const event of events) await projectIngestEvent(db, ctx, event.id, { replay: true });

  const actualCurrent = await db
    .select({
      entityKey: entityCurrent.entityKey,
      identityHash: ingestEvents.payloadHash,
    })
    .from(entityCurrent)
    .innerJoin(
      entityRevisions,
      and(
        eq(entityRevisions.tenantId, entityCurrent.tenantId),
        eq(entityRevisions.id, entityCurrent.currentRevisionId),
      ),
    )
    .innerJoin(
      ingestEvents,
      and(
        eq(ingestEvents.tenantId, entityRevisions.tenantId),
        eq(ingestEvents.id, entityRevisions.ingestEventId),
      ),
    )
    .where(eq(entityCurrent.tenantId, ctx.tenantId));
  const actualRevisionRows = await db
    .select({
      entityKey: entityRevisions.entityKey,
      businessState: entityRevisions.businessState,
      sourceEntityVersion: entityRevisions.sourceEntityVersion,
      amountMinor: entityRevisions.amountMinor,
      currency: entityRevisions.currency,
      eventTime: entityRevisions.eventTime,
      identityHash: ingestEvents.payloadHash,
    })
    .from(entityRevisions)
    .innerJoin(
      ingestEvents,
      and(
        eq(ingestEvents.tenantId, entityRevisions.tenantId),
        eq(ingestEvents.id, entityRevisions.ingestEventId),
      ),
    )
    .where(eq(entityRevisions.tenantId, ctx.tenantId));
  const actualPayload = {
    current: [...actualCurrent].sort((a, b) => a.entityKey.localeCompare(b.entityKey)),
    revisions: sortRevisions(actualRevisionRows.map(toManifestRevision)),
  };

  const shadowRevisions: Array<ManifestRevision & { entityType: string }> = [];
  const shadowCurrent = new Map<string, ManifestRevision & { entityType: string }>();
  for (const event of events) {
    if (!event.eventType || event.quarantineStatus !== 'none') continue;
    const mapping = mappingFor(event.eventType as CanonicalEventType);
    const identity = resolveEntityIdentity(
      mapping,
      (event.entityReferences ?? {}) as Record<string, string | null | undefined>,
      event.economicSubjectHint,
    );
    const revision: ManifestRevision & { entityType: string } = {
      entityKey: identity.entityKey,
      identityHash: event.payloadHash,
      state: mapping.businessState,
      sourceVersion: event.sourceEntityVersion,
      amount: event.amountMinor?.toString() ?? null,
      currency: event.currency,
      eventTime: event.eventTime.toISOString(),
      entityType: mapping.entityType,
    };
    shadowRevisions.push(revision);
    const current = shadowCurrent.get(identity.entityKey);
    if (
      !current ||
      compareProjectionOrder(
        {
          sourceVersion: revision.sourceVersion,
          entityType: revision.entityType,
          businessState: revision.state,
          eventTime: new Date(revision.eventTime),
          tieBreaker: revision.identityHash,
        },
        {
          sourceVersion: current.sourceVersion,
          entityType: current.entityType,
          businessState: current.state,
          eventTime: new Date(current.eventTime),
          tieBreaker: current.identityHash,
        },
      ) > 0
    ) {
      shadowCurrent.set(identity.entityKey, revision);
    }
  }
  const shadowPayload = {
    current: [...shadowCurrent.values()]
      .sort((a, b) => a.entityKey.localeCompare(b.entityKey))
      .map((row) => ({ entityKey: row.entityKey, identityHash: row.identityHash })),
    revisions: sortRevisions(shadowRevisions.map(({ entityType: _entityType, ...row }) => row)),
  };
  const manifestHash = contentHash(actualPayload);
  const shadowManifestHash = contentHash(shadowPayload);
  return {
    eventCount: events.length,
    manifestHash,
    shadowManifestHash,
    matchesShadow: manifestHash === shadowManifestHash,
  };
}

/**
 * Stable, content-only ordering for the revisions list — `entityKey` then
 * `eventTime` then `identityHash` as the final tiebreaker. Never sorts by a
 * database surrogate id, so two independent rebuilds of the same logical
 * events always produce the same array order (and therefore the same hash).
 */
function sortRevisions(revisions: readonly ManifestRevision[]): ManifestRevision[] {
  return [...revisions].sort(
    (a, b) =>
      a.entityKey.localeCompare(b.entityKey) ||
      a.eventTime.localeCompare(b.eventTime) ||
      a.identityHash.localeCompare(b.identityHash),
  );
}

function toManifestRevision(row: {
  entityKey: string;
  businessState: string;
  sourceEntityVersion: number | null;
  amountMinor: bigint | null;
  currency: string | null;
  eventTime: Date;
  identityHash: string;
}): ManifestRevision {
  return {
    entityKey: row.entityKey,
    identityHash: row.identityHash,
    state: row.businessState,
    sourceVersion: row.sourceEntityVersion,
    amount: row.amountMinor?.toString() ?? null,
    currency: row.currency,
    eventTime: row.eventTime.toISOString(),
  };
}
