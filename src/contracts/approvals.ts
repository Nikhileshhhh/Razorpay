import { z } from 'zod';
import { boundedString, LIMITS } from './common/limits.js';
import { ApprovalId, CaseId, OpaqueId, PlanId, Sha256Hash } from './common/identifiers.js';
import { MinorAmount, SupportedCurrency } from './common/money.js';
import { Role } from './common/roles.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ContractVersion, ResourceVersion, SchemaVersion } from './common/versions.js';
import { ToolActionId } from './plans.js';

/**
 * Approvals (handoff §9.3–§9.4, §14.3–§14.4).
 *
 * The client approval REQUEST never carries requester/approver identity or role;
 * the server derives those. The `ApprovalDecisionBasis` contains exactly the
 * documented binding fields — this is the strict INPUT schema for later
 * deterministic hashing (the hash itself is NOT computed in MT-002).
 */
export const ApprovalDecisionValue = z.enum(['approve', 'reject', 'request_more_evidence']);
export type ApprovalDecisionValue = z.infer<typeof ApprovalDecisionValue>;

export const ApprovalState = z.enum([
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'INVALIDATED',
]);
export type ApprovalState = z.infer<typeof ApprovalState>;

/** Exactly the 16 documented binding fields (handoff §9.4). Input for hashing. */
export const ApprovalDecisionBasis = z
  .object({
    schema_version: SchemaVersion,
    tenant_id: OpaqueId,
    case_id: CaseId,
    case_version: ResourceVersion,
    plan_id: PlanId,
    plan_version: ResourceVersion,
    plan_hash: Sha256Hash,
    evidence_set_hash: Sha256Hash,
    policy_bundle_version: ContractVersion,
    policy_decision_id: OpaqueId,
    action_type: ToolActionId,
    target: boundedString(LIMITS.TARGET_MAX),
    amount_impact_minor: MinorAmount,
    currency: SupportedCurrency,
    verification_contract_key: boundedString(LIMITS.CODE_MAX),
    verification_contract_version: ContractVersion,
    required_role: Role,
    expires_at: Rfc3339Utc,
  })
  .strict();
export type ApprovalDecisionBasis = z.infer<typeof ApprovalDecisionBasis>;

/** Client-supplied approval request — server derives identity/role. */
export const ApprovalRequest = z
  .object({
    schema_version: SchemaVersion,
    plan_id: PlanId,
    expected_case_version: ResourceVersion,
    expected_plan_version: ResourceVersion,
    reason: boundedString(LIMITS.REASON_MAX).nullish(),
  })
  .strict();
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

const approvalRecordBase = {
  schema_version: SchemaVersion,
  approval_id: ApprovalId,
  decision_basis_hash: Sha256Hash,
  requester_id: OpaqueId,
  requested_at: Rfc3339Utc,
  expires_at: Rfc3339Utc,
};

const RequestedApproval = z
  .object({
    ...approvalRecordBase,
    state: z.literal('REQUESTED'),
    approver_id: z.null(),
    approver_role: z.null(),
    decision: z.null(),
    reason: boundedString(LIMITS.REASON_MAX).nullish(),
    decided_at: z.null(),
  })
  .strict();

const ApprovedApproval = z
  .object({
    ...approvalRecordBase,
    state: z.literal('APPROVED'),
    approver_id: OpaqueId,
    approver_role: Role,
    decision: z.literal('approve'),
    reason: boundedString(LIMITS.REASON_MAX).nullish(),
    decided_at: Rfc3339Utc,
  })
  .strict();

const RejectedApproval = z
  .object({
    ...approvalRecordBase,
    state: z.literal('REJECTED'),
    approver_id: OpaqueId,
    approver_role: Role,
    decision: z.enum(['reject', 'request_more_evidence']),
    reason: boundedString(LIMITS.REASON_MAX),
    decided_at: Rfc3339Utc,
  })
  .strict();

const systemTerminatedApproval = (state: 'EXPIRED' | 'INVALIDATED') =>
  z
    .object({
      ...approvalRecordBase,
      state: z.literal(state),
      approver_id: z.null(),
      approver_role: z.null(),
      decision: z.null(),
      reason: boundedString(LIMITS.REASON_MAX).nullish(),
      decided_at: Rfc3339Utc,
    })
    .strict();

/** Persisted approval record with state-correlated decision and identity fields. */
export const ApprovalRecord = z.discriminatedUnion('state', [
  RequestedApproval,
  ApprovedApproval,
  RejectedApproval,
  systemTerminatedApproval('EXPIRED'),
  systemTerminatedApproval('INVALIDATED'),
]);
export type ApprovalRecord = z.infer<typeof ApprovalRecord>;
