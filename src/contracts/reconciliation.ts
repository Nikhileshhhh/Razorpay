import { z } from 'zod';
import { boundedArray, LIMITS } from './common/limits.js';
import { CaseId, EvidenceId, ExpectationId, OpaqueId, SubjectId } from './common/identifiers.js';
import { Money, SignedMoney } from './common/money.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { SchemaVersion } from './common/versions.js';

/**
 * Unique reconciliation (handoff §7.4, PRD §17.14).
 *
 * One authoritative structural schema (runtime AND OpenAPI), status-dependent:
 *   ALLOCATED  -> requires an allocation and non-empty evidence ids;
 *   AMBIGUOUS/UNRESOLVED -> carry no allocation and no closed receivable;
 *   REVERSED   -> carries reversal evidence, no allocation.
 * With INR-only schema 1.0, currency equality is structurally guaranteed.
 */
export const MatchType = z.enum(['EXACT_ONE_TO_ONE']);
export type MatchType = z.infer<typeof MatchType>;

export const ReconciliationStatus = z.enum(['ALLOCATED', 'AMBIGUOUS', 'UNRESOLVED', 'REVERSED']);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatus>;

export const ReconciliationAllocationRef = z
  .object({
    allocation_id: OpaqueId,
    bank_line_evidence_id: EvidenceId,
    expectation_id: ExpectationId,
    amount: Money,
  })
  .strict();
export type ReconciliationAllocationRef = z.infer<typeof ReconciliationAllocationRef>;

const reconciliationCommon = {
  schema_version: SchemaVersion,
  reconciliation_id: OpaqueId,
  case_id: CaseId,
  subject_id: SubjectId,
  matched_amount: Money,
  difference: SignedMoney,
  match_type: MatchType,
  created_at: Rfc3339Utc,
};

const AllocatedReconciliation = z
  .object({
    ...reconciliationCommon,
    status: z.literal('ALLOCATED'),
    allocation: ReconciliationAllocationRef,
    closed_receivable_id: OpaqueId.nullable(),
    evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
  })
  .strict();

const UnallocatedReconciliation = (status: 'AMBIGUOUS' | 'UNRESOLVED') =>
  z
    .object({
      ...reconciliationCommon,
      status: z.literal(status),
      allocation: z.null(),
      closed_receivable_id: z.null(),
      evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX),
    })
    .strict();

const ReversedReconciliation = z
  .object({
    ...reconciliationCommon,
    status: z.literal('REVERSED'),
    allocation: z.null(),
    closed_receivable_id: OpaqueId.nullable(),
    evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
  })
  .strict();

export const ReconciliationResult = z.discriminatedUnion('status', [
  AllocatedReconciliation,
  UnallocatedReconciliation('AMBIGUOUS'),
  UnallocatedReconciliation('UNRESOLVED'),
  ReversedReconciliation,
]);
export type ReconciliationResult = z.infer<typeof ReconciliationResult>;
