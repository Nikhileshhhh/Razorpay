import { z } from 'zod';
import { boundedArray, LIMITS } from './common/limits.js';
import { OpaqueId, SubjectKey, TenantId } from './common/identifiers.js';
import { Money, SupportedCurrency } from './common/money.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';
import { EvidenceReference, EvidenceType } from './evidence.js';

/**
 * Agent Result Claims (PRD §8.14, handoff §7/§9.2).
 *
 * An agent result is an UNTRUSTED external claim, evaluated independently and
 * never allowed to change source financial facts. `AttributionMethod` uses the
 * causality vocabulary from §16.7; `AgentResultType` is a documented seed set
 * (expansion needs a schema-version bump).
 */
export const AgentResultType = z.enum(['RECOVERY']);
export type AgentResultType = z.infer<typeof AgentResultType>;

export const AttributionMethod = z.enum([
  'CORRELATED',
  'ATTRIBUTED_UNDER_RULE',
  'EXPERIMENTALLY_INCREMENTAL',
  'CAUSALLY_ESTABLISHED',
]);
export type AttributionMethod = z.infer<typeof AttributionMethod>;

export const AgentClaimStatus = z.enum([
  'PENDING',
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'REJECTED',
  'UNRESOLVED',
  'REVERSED',
]);
export type AgentClaimStatus = z.infer<typeof AgentClaimStatus>;

export const AgentResultClaim = z
  .object({
    schema_version: SchemaVersion,
    external_claim_id: OpaqueId,
    external_agent_id: OpaqueId,
    tenant_id: TenantId,
    economic_subject: SubjectKey,
    claimed_amount: Money,
    result_type: AgentResultType,
    attribution_method: AttributionMethod,
    correlation_id: OpaqueId.nullish(),
    claim_time: Rfc3339Utc,
    evidence_time: Rfc3339Utc.nullish(),
    // Gate B4 remediation: an agent claim must bind to at least one
    // validated evidence reference (backend PRD §13.3) — an empty array
    // would let an untrusted claim assert retained value with nothing to
    // correlate against. Each referenced id is additionally validated at
    // acceptance time (same tenant, same subject, accepted, non-quarantined,
    // signature-verified) in `acceptAgentClaim`.
    evidence_refs: boundedArray(
      EvidenceReference.extend({ evidence_type: EvidenceType }),
      LIMITS.EVIDENCE_IDS_MAX,
    ).min(1),
  })
  .strict();
export type AgentResultClaim = z.infer<typeof AgentResultClaim>;

const claimEvaluationBase = {
  schema_version: SchemaVersion,
  claim_id: OpaqueId,
  evaluation_version: ResourceVersion,
  created_at: Rfc3339Utc,
};

const unverifiedClaimEvaluation = (status: 'PENDING' | 'REJECTED' | 'UNRESOLVED') =>
  z
    .object({ ...claimEvaluationBase, status: z.literal(status), verified_amount: z.null() })
    .strict();

const verifiedClaimEvaluation = (status: 'VERIFIED' | 'PARTIALLY_VERIFIED') =>
  z.object({ ...claimEvaluationBase, status: z.literal(status), verified_amount: Money }).strict();

const ReversedClaimEvaluation = z
  .object({
    ...claimEvaluationBase,
    status: z.literal('REVERSED'),
    verified_amount: z
      .object({ amount_minor: z.literal('0'), currency: SupportedCurrency })
      .strict(),
  })
  .strict();

export const ClaimEvaluation = z.discriminatedUnion('status', [
  unverifiedClaimEvaluation('PENDING'),
  verifiedClaimEvaluation('VERIFIED'),
  verifiedClaimEvaluation('PARTIALLY_VERIFIED'),
  unverifiedClaimEvaluation('REJECTED'),
  unverifiedClaimEvaluation('UNRESOLVED'),
  ReversedClaimEvaluation,
]);
export type ClaimEvaluation = z.infer<typeof ClaimEvaluation>;
