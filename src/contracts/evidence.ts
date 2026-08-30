import { z } from 'zod';
import { boundedString, LIMITS } from './common/limits.js';
import { EvidenceId, OpaqueId, RawPayloadRef, Sha256Hash, TenantId } from './common/identifiers.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { SchemaVersion } from './common/versions.js';
import { CanonicalEventType, SourceSystem } from './events/event-types.js';

/**
 * Evidence records, references, and sealed evidence-set references.
 *
 * `EvidenceType`/`BlockerType` are seeded from the codes literally named in the
 * PRD (§8.7 example and §9 controls). They are a documented SEED SET — expanding
 * the vocabulary requires a schema-version bump. Raw payloads are never carried
 * here; only an opaque `raw_payload_ref`.
 */
export const SignatureStatus = z.enum(['verified', 'unsigned', 'invalid', 'not_applicable']);
export const DedupeStatus = z.enum(['unique', 'exact_duplicate', 'conflicting_duplicate']);
export const QuarantineStatus = z.enum(['none', 'quarantined']);

/** Documented evidence categories (PRD §8.7 / §9). Seed set; versioned. */
export const EvidenceType = z.enum([
  'captured_payment',
  'paid_order',
  'seller_allocation_rule',
  'transfer_search_result',
  'authoritative_transfer_record',
  'recipient_settlement',
  'bank_credit',
  'seller_receivable',
  'refund',
  'dispute',
  'recovery_action',
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/** Contradictions that block action (PRD §8.7). Seed set; versioned. */
export const BlockerType = z.enum([
  'transfer_found_with_unresolved_identity',
  'refund_pending',
  'payment_disputed',
]);
export type BlockerType = z.infer<typeof BlockerType>;

export const EvidenceRecord = z
  .object({
    schema_version: SchemaVersion,
    evidence_id: EvidenceId,
    tenant_id: TenantId,
    source_system: SourceSystem,
    source_record_type: boundedString(LIMITS.CODE_MAX),
    source_record_id: OpaqueId,
    source_event_id: OpaqueId.nullish(),
    // Preserved upstream string.
    source_event_type: boundedString(LIMITS.ID_MAX).nullish(),
    // Canonical mapping (PRD §17.2). Required key; null only when the evidence is
    // legitimately unmapped/quarantined, so its absence is always explicit.
    event_type: CanonicalEventType.nullable(),
    event_time: Rfc3339Utc,
    ingested_at: Rfc3339Utc,
    payload_hash: Sha256Hash,
    raw_payload_ref: RawPayloadRef,
    signature_status: SignatureStatus,
    dedupe_status: DedupeStatus,
    quarantine_status: QuarantineStatus,
  })
  .strict();
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

export const EvidenceReference = z
  .object({ evidence_id: EvidenceId, evidence_type: EvidenceType.nullish() })
  .strict();
export type EvidenceReference = z.infer<typeof EvidenceReference>;

/** Sealed evidence-set reference (content-hashed snapshot). */
export const EvidenceSetRef = z
  .object({
    evidence_set_id: OpaqueId,
    evidence_set_hash: Sha256Hash,
    item_count: z.number().int().min(0),
  })
  .strict();
export type EvidenceSetRef = z.infer<typeof EvidenceSetRef>;
