import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/**
 * Approval state machine (architecture handoff §9.3):
 * `REQUESTED -> APPROVED | REJECTED | EXPIRED | INVALIDATED`. Every terminal
 * state is final for THIS request; a stale/invalidated approval requires an
 * entirely new request bound to a freshly rebuilt decision basis (§9.4) — it is
 * never resurrected in place.
 */
export const APPROVAL_STATES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'INVALIDATED',
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_TRANSITIONS: TransitionMap<ApprovalState> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  INVALIDATED: [],
};

export function assertApprovalTransition(from: ApprovalState, to: ApprovalState): void {
  assertAllowedTransition('approval', APPROVAL_TRANSITIONS, from, to);
}

/**
 * Fields whose change invalidates a REQUESTED approval (decision-basis hash
 * inputs, architecture §9.4). Exposed as a named list so the approvals service
 * (Gate B3) and its tests share one definition of "every hashed field".
 */
export const DECISION_BASIS_FIELDS = [
  'tenant_id',
  'case_id',
  'case_version',
  'plan_id',
  'plan_version',
  'plan_hash',
  'evidence_set_hash',
  'policy_bundle_version',
  'policy_decision_id',
  'action_type',
  'target',
  'amount_impact_minor',
  'currency',
  'verification_contract_key',
  'verification_contract_version',
  'required_role',
  'expires_at',
] as const;
export type DecisionBasisField = (typeof DECISION_BASIS_FIELDS)[number];
