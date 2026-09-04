import type { Database } from '../../config/db.js';
import { canonicalJsonStringify, contentHash } from '../../config/hashing.js';
import {
  CanonicalEvent,
  type CanonicalEvent as CanonicalEventValue,
} from '../../contracts/events/canonical-event.js';
import type { CanonicalEventType, SourceSystem } from '../../contracts/events/event-types.js';
import { ingestAndProject } from '../ingestion/pipeline.js';
import { evaluateAffectedControls } from '../invariants/control-orchestrator.js';
import type { TenantContext } from '../identity/tenant-context.js';

/**
 * Shared synthetic-evidence construction for demo/dataset seeding (backend
 * PRD §16). Every record uses `metadata.environment='synthetic'`, fixed UTC
 * times via the caller-supplied clock, and a stable deterministic ID — the
 * same shape `scenario-runner.ts` builds by hand for the four named
 * scenarios, factored out so the 500-record dataset generator does not
 * duplicate it a third time.
 */

export const DATASET_SOURCE_ACCOUNTS: Readonly<Partial<Record<SourceSystem, string>>> = {
  SYNTHETIC_RAZORPAY_FIXTURE: 'acct_demo_razorpay_fixture',
  SYNTHETIC_OMS: 'acct_demo_oms',
  SYNTHETIC_ERP: 'acct_demo_erp',
  SYNTHETIC_BANK: 'acct_demo_bank',
  SYNTHETIC_ROUTE: 'acct_demo_route',
  SYNTHETIC_RECOVERY: 'acct_demo_recovery',
};

export interface SyntheticEvidenceInput {
  readonly key: string;
  readonly subject: string;
  readonly type: CanonicalEventType;
  readonly source: SourceSystem;
  readonly occurredAt: Date;
  readonly ingestedAt: Date;
  readonly amountMinor?: bigint;
  readonly references: Record<string, string>;
  readonly data?: Record<string, unknown>;
  readonly causationId?: string | null;
}

export interface SyntheticEvidenceOptions {
  /** Return the original event id for an exact duplicate during crash-safe dataset repair. */
  readonly reuseExactDuplicate?: boolean;
}

export function buildSyntheticEvent(
  ctx: TenantContext,
  input: SyntheticEvidenceInput,
): CanonicalEventValue {
  const account =
    DATASET_SOURCE_ACCOUNTS[input.source] ?? `acct_demo_${input.source.toLowerCase()}`;
  return CanonicalEvent.parse({
    schema_version: '1.0',
    event_id: `dataset_${input.key}`,
    tenant_id: ctx.tenantId,
    source_system: input.source,
    source_account_id: account,
    source_event_id: `dataset_${input.key}`,
    source_event_type: input.type,
    event_type: input.type,
    event_time: input.occurredAt.toISOString(),
    ingested_at: input.ingestedAt.toISOString(),
    source_entity_version: 1,
    entity_references: input.references,
    economic_subject_hint: input.subject,
    amount_minor: input.amountMinor?.toString() ?? null,
    currency: input.amountMinor === undefined ? null : 'INR',
    correlation_id: `dataset_${input.subject.replaceAll(':', '_')}`,
    causation_id: input.causationId ?? null,
    payload_hash: contentHash({ dataset_event: input.key }),
    raw_payload_ref: `db:dataset/${input.key}`,
    metadata: { environment: 'synthetic' },
    data: input.data ?? {},
  });
}

/**
 * Ingest one synthetic evidence record through the real acceptance/
 * projection/control pipeline (never a hand-rolled row insert) and evaluate
 * the controls it affects with the given fixed clock. Returns the accepted
 * `ingest_events.id`, or `null` if the exact-duplicate/conflict path did not
 * accept a new row (dedupe/conflict handling still ran for real).
 */
export async function ingestSyntheticEvidence(
  db: Database,
  ctx: TenantContext,
  input: SyntheticEvidenceInput,
  options: SyntheticEvidenceOptions = {},
): Promise<string | null> {
  const event = buildSyntheticEvent(ctx, input);
  const outcome = await ingestAndProject(db, ctx, {
    event,
    rawBytes: canonicalJsonStringify(event),
    rawRepresentation: 'canonical_row',
    signatureStatus: 'verified',
    sourceIdentity: `${input.source}:${DATASET_SOURCE_ACCOUNTS[input.source] ?? input.source}`,
  });
  if (outcome.outcome === 'duplicate' && options.reuseExactDuplicate) return outcome.eventId;
  if (outcome.outcome !== 'accepted') return null;
  await evaluateAffectedControls(db, ctx, outcome.eventId, input.ingestedAt);
  return outcome.eventId;
}

/**
 * Ingest a byte-different duplicate attempt for the SAME `source_event_id` as
 * an already-accepted record — the real conflicting-duplicate quarantine path
 * (backend PRD §9.1), used to mark a dataset record as a genuine data-quality
 * "unmatched" case rather than an invented flag column.
 */
export async function ingestConflictingDuplicate(
  db: Database,
  ctx: TenantContext,
  input: SyntheticEvidenceInput,
): Promise<'conflict' | 'accepted' | 'duplicate'> {
  const event = buildSyntheticEvent(ctx, {
    ...input,
    // Same source_event_id (via the same `key`), different amount so the raw
    // bytes hash differs — this is the same-ID/different-hash conflict path,
    // never the same-ID/same-hash duplicate-success path.
    amountMinor: (input.amountMinor ?? 0n) + 1n,
  });
  const outcome = await ingestAndProject(db, ctx, {
    event,
    rawBytes: canonicalJsonStringify(event),
    rawRepresentation: 'canonical_row',
    signatureStatus: 'verified',
    sourceIdentity: `${input.source}:${DATASET_SOURCE_ACCOUNTS[input.source] ?? input.source}`,
  });
  return outcome.outcome;
}
