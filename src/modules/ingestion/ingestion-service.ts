import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { auditEntries, ingestEvents, eventConflicts, outbox } from '../../config/db-schema.js';
import { rawBytesHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { computeFallbackDedupeKey, primaryEntityReference } from './dedupe-key.js';
import type { CanonicalEvent } from '../../contracts/events/canonical-event.js';

/**
 * Evidence acceptance (backend PRD §9.1). Owns: source authentication result
 * recording, raw acceptance, hashing, dedupe/conflict detection, and the
 * durable journal write — in ONE transaction, so an accepted event survives a
 * crash immediately after the `202`. Does NOT project (that is a separate call
 * the caller makes only for a genuinely new `accepted` outcome — see
 * `src/modules/ingestion/pipeline.ts`).
 */
export type AcceptanceOutcome =
  | { readonly outcome: 'accepted'; readonly eventId: string }
  | { readonly outcome: 'duplicate'; readonly eventId: string }
  | { readonly outcome: 'conflict'; readonly conflictId: string; readonly existingEventId: string };

export type QuarantineOutcome =
  | { readonly outcome: 'quarantined'; readonly eventId: string }
  | { readonly outcome: 'duplicate'; readonly eventId: string }
  | { readonly outcome: 'conflict'; readonly conflictId: string; readonly existingEventId: string };

export interface AcceptEvidenceInput {
  readonly event: CanonicalEvent;
  /** Exact raw bytes as received (webhook body) or a stable serialization for direct API submission. */
  readonly rawBytes: Buffer | string;
  /** Determined by the caller (adapter/route) BEFORE calling this service. */
  readonly signatureStatus: 'verified' | 'unsigned' | 'invalid' | 'not_applicable';
  /** Webhooks preserve exact bytes; authenticated canonical submissions use a stable row serialization. */
  readonly rawRepresentation?: 'exact_bytes' | 'canonical_row';
  /** Server-derived actor. Never accept this value from the request body. */
  readonly actorId?: string | null;
  /** Server-derived connector identity for non-user source authentication. */
  readonly sourceIdentity?: string;
}

export class EvidenceAuthenticationError extends Error {
  constructor() {
    super('evidence source authentication failed');
    this.name = 'EvidenceAuthenticationError';
  }
}

export class EvidenceTenantMismatchError extends Error {
  constructor() {
    super('canonical event tenant does not match the authenticated tenant');
    this.name = 'EvidenceTenantMismatchError';
  }
}

/**
 * Preserve an authenticated webhook which cannot be mapped into a canonical
 * event. It is deliberately journaled with `event_type = null` and never gets
 * projection work; exact/conflicting retries retain the same dedupe semantics
 * as canonical evidence.
 */
export async function quarantineAuthenticatedEvidence(
  db: Database,
  ctx: TenantContext,
  input: {
    readonly sourceSystem: string;
    readonly sourceAccountId: string;
    readonly sourceEventId: string;
    readonly sourceEventType: string;
    readonly rawBytes: Buffer;
    readonly parsedPayload: unknown;
    readonly reason: string;
  },
): Promise<QuarantineOutcome> {
  const payloadHash = rawBytesHash(input.rawBytes);
  const rawPayload =
    input.parsedPayload &&
    typeof input.parsedPayload === 'object' &&
    !Array.isArray(input.parsedPayload)
      ? (input.parsedPayload as Record<string, unknown>)
      : { parse_status: 'invalid_json' };
  return db.transaction(async (tx) => {
    const identity = `${ctx.tenantId}|${input.sourceSystem}|${input.sourceEventId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const existing = await tx
      .select()
      .from(ingestEvents)
      .where(
        and(
          eq(ingestEvents.tenantId, ctx.tenantId),
          eq(ingestEvents.sourceSystem, input.sourceSystem),
          eq(ingestEvents.sourceEventId, input.sourceEventId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (existing[0].payloadHash === payloadHash) {
        await appendEvidenceAudit(tx, {
          tenantId: ctx.tenantId,
          artifactId: existing[0].id,
          artifactHash: payloadHash,
          outcome: 'duplicate',
          sourceIdentity: `${input.sourceSystem}:${input.sourceAccountId}`,
        });
        return { outcome: 'duplicate', eventId: existing[0].id };
      }
      const conflictId = `conflict_${randomUUID()}`;
      await tx.insert(eventConflicts).values({
        id: conflictId,
        tenantId: ctx.tenantId,
        sourceSystem: input.sourceSystem,
        sourceEventId: input.sourceEventId,
        existingIngestEventId: existing[0].id,
        existingHash: existing[0].payloadHash,
        newHash: payloadHash,
        newRawPayload: rawPayload,
        newRawBytes: Buffer.from(input.rawBytes),
        rawRepresentation: 'exact_bytes',
        quarantineReason: 'source_event_id_reused_with_different_payload_hash',
      });
      await appendEvidenceAudit(tx, {
        tenantId: ctx.tenantId,
        artifactId: conflictId,
        artifactHash: payloadHash,
        outcome: 'conflict',
        relatedEventId: existing[0].id,
        sourceIdentity: `${input.sourceSystem}:${input.sourceAccountId}`,
      });
      return { outcome: 'conflict', conflictId, existingEventId: existing[0].id };
    }

    const eventId = `evt_${randomUUID()}`;
    await tx.insert(ingestEvents).values({
      id: eventId,
      tenantId: ctx.tenantId,
      sourceSystem: input.sourceSystem,
      sourceAccountId: input.sourceAccountId,
      sourceEventId: input.sourceEventId,
      sourceEventType: input.sourceEventType || 'unmapped',
      eventType: null,
      eventTime: new Date(),
      payloadHash,
      rawPayload,
      rawBytes: Buffer.from(input.rawBytes),
      rawRepresentation: 'exact_bytes',
      signatureStatus: 'verified',
      dedupeStatus: 'unique',
      quarantineStatus: 'quarantined',
      fallbackDedupeKey: `${ctx.tenantId}|${input.sourceSystem}|${input.sourceEventId}|${payloadHash}`,
      entityReferences: {},
    });
    await appendEvidenceAudit(tx, {
      tenantId: ctx.tenantId,
      artifactId: eventId,
      artifactHash: payloadHash,
      outcome: 'quarantined',
      reason: input.reason,
      sourceIdentity: `${input.sourceSystem}:${input.sourceAccountId}`,
    });
    return { outcome: 'quarantined', eventId };
  });
}

export async function acceptEvidence(
  db: Database,
  ctx: TenantContext,
  input: AcceptEvidenceInput,
): Promise<AcceptanceOutcome> {
  const { event, signatureStatus } = input;
  if (event.tenant_id !== ctx.tenantId) throw new EvidenceTenantMismatchError();
  if (signatureStatus === 'invalid') throw new EvidenceAuthenticationError();

  const exactBytes = Buffer.isBuffer(input.rawBytes)
    ? Buffer.from(input.rawBytes)
    : Buffer.from(input.rawBytes, 'utf8');
  const rawRepresentation = input.rawRepresentation ?? 'canonical_row';
  const payloadHash = rawBytesHash(exactBytes);
  const entityId = primaryEntityReference(event.entity_references);
  const fallbackDedupeKey = computeFallbackDedupeKey({
    tenantId: ctx.tenantId,
    sourceSystem: event.source_system,
    entityId,
    sourceEventType: event.source_event_type,
    eventTimeIso: event.event_time,
    payloadHash,
  });

  return db.transaction(async (tx) => {
    // Serialize only submissions that can race for the same dedupe identity.
    // PostgreSQL releases this transaction-scoped lock on every exit path.
    const lockIdentity = event.source_event_id ?? fallbackDedupeKey;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|${event.source_system}|${lockIdentity}`}, 0))`,
    );

    if (event.source_event_id) {
      const existingRows = await tx
        .select()
        .from(ingestEvents)
        .where(
          and(
            eq(ingestEvents.tenantId, ctx.tenantId),
            eq(ingestEvents.sourceSystem, event.source_system),
            eq(ingestEvents.sourceEventId, event.source_event_id),
          ),
        )
        .limit(1);
      const existing = existingRows[0];

      if (existing) {
        if (existing.payloadHash === payloadHash) {
          // Exact source ID + same hash: duplicate success, no new domain effect.
          await appendEvidenceAudit(tx, {
            tenantId: ctx.tenantId,
            artifactId: existing.id,
            artifactHash: payloadHash,
            actorId: input.actorId,
            sourceIdentity: input.sourceIdentity,
            outcome: 'duplicate',
          });
          return { outcome: 'duplicate', eventId: existing.id };
        }
        // Exact source ID + different hash: quarantine, never project.
        const conflictId = `conflict_${randomUUID()}`;
        await tx.insert(eventConflicts).values({
          id: conflictId,
          tenantId: ctx.tenantId,
          sourceSystem: event.source_system,
          sourceEventId: event.source_event_id,
          existingIngestEventId: existing.id,
          existingHash: existing.payloadHash,
          newHash: payloadHash,
          newRawPayload: event as unknown as Record<string, unknown>,
          newRawBytes: exactBytes,
          rawRepresentation,
          quarantineReason: 'source_event_id_reused_with_different_payload_hash',
        });
        await appendEvidenceAudit(tx, {
          tenantId: ctx.tenantId,
          artifactId: conflictId,
          artifactHash: payloadHash,
          actorId: input.actorId,
          sourceIdentity: input.sourceIdentity,
          outcome: 'conflict',
          relatedEventId: existing.id,
        });
        await tx.insert(outbox).values({
          id: `outbox_${randomUUID()}`,
          tenantId: ctx.tenantId,
          topic: 'evaluate-controls.v1',
          domainEventId: `${existing.id}:conflict:${conflictId}`,
          payload: {
            tenant_id: ctx.tenantId,
            ingest_event_id: existing.id,
            conflict_id: conflictId,
            replay: false,
          },
        });
        return { outcome: 'conflict', conflictId, existingEventId: existing.id };
      }
    } else {
      // No source event id: fall back to the composite dedupe key.
      const existingRows = await tx
        .select()
        .from(ingestEvents)
        .where(
          and(
            eq(ingestEvents.tenantId, ctx.tenantId),
            eq(ingestEvents.fallbackDedupeKey, fallbackDedupeKey),
            isNull(ingestEvents.sourceEventId),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        await appendEvidenceAudit(tx, {
          tenantId: ctx.tenantId,
          artifactId: existing.id,
          artifactHash: payloadHash,
          actorId: input.actorId,
          sourceIdentity: input.sourceIdentity,
          outcome: 'duplicate',
        });
        return { outcome: 'duplicate', eventId: existing.id };
      }
    }

    const eventId = `evt_${randomUUID()}`;
    await tx.insert(ingestEvents).values({
      id: eventId,
      tenantId: ctx.tenantId,
      sourceSystem: event.source_system,
      sourceAccountId: event.source_account_id ?? null,
      sourceEventId: event.source_event_id ?? null,
      sourceEventType: event.source_event_type,
      eventType: event.event_type,
      sourceEntityVersion: event.source_entity_version ?? null,
      eventTime: new Date(event.event_time),
      payloadHash,
      rawPayload: event as unknown as Record<string, unknown>,
      rawBytes: exactBytes,
      rawRepresentation,
      signatureStatus,
      dedupeStatus: 'unique',
      quarantineStatus: 'none',
      fallbackDedupeKey,
      correlationId: event.correlation_id ?? null,
      amountMinor: event.amount_minor != null ? BigInt(event.amount_minor) : null,
      currency: event.currency ?? null,
      entityReferences: event.entity_references,
      economicSubjectHint: event.economic_subject_hint ?? null,
    });

    await appendEvidenceAudit(tx, {
      tenantId: ctx.tenantId,
      artifactId: eventId,
      artifactHash: payloadHash,
      actorId: input.actorId,
      sourceIdentity: input.sourceIdentity,
      outcome: 'accepted',
    });
    await tx.insert(outbox).values({
      id: `outbox_${randomUUID()}`,
      tenantId: ctx.tenantId,
      topic: 'project-evidence.v1',
      domainEventId: eventId,
      payload: { tenant_id: ctx.tenantId, ingest_event_id: eventId, replay: false },
    });

    return { outcome: 'accepted', eventId };
  });
}

type EvidenceAuditInput = {
  readonly tenantId: string;
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly actorId?: string | null;
  readonly outcome: 'accepted' | 'duplicate' | 'conflict' | 'quarantined';
  readonly relatedEventId?: string;
  readonly reason?: string;
  readonly sourceIdentity?: string;
};

async function appendEvidenceAudit(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: EvidenceAuditInput,
): Promise<void> {
  await tx.insert(auditEntries).values({
    id: `audit_${randomUUID()}`,
    tenantId: input.tenantId,
    artifactType: 'EVIDENCE',
    artifactId: input.artifactId,
    artifactHash: input.artifactHash,
    actorId: input.actorId ?? null,
    details: {
      outcome: input.outcome,
      ...(input.relatedEventId ? { related_event_id: input.relatedEventId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.sourceIdentity ? { source_identity: input.sourceIdentity } : {}),
    },
  });
}
