import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/**
 * Plan state machine (architecture handoff §9.3): `DRAFT -> PROPOSED ->
 * POLICY_DENIED | APPROVAL_REQUIRED | AUTHORIZED`.
 *
 * Resolved gap-fill (documented, not a silent guess): the handoff diagram does
 * not show an edge out of `APPROVAL_REQUIRED`. A plan that requires approval
 * must be able to become `AUTHORIZED` once the bound approval is granted, so we
 * add exactly that one edge. A rejected/expired/invalidated approval does NOT
 * move the plan itself to a terminal "denied" plan state (there is no such
 * status in the contract); the case instead transitions to its own `rejected`
 * lifecycle state and, if remediation is still desired, a NEW plan is proposed.
 */
export const PLAN_STATES = [
  'DRAFT',
  'PROPOSED',
  'POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'AUTHORIZED',
] as const;
export type PlanState = (typeof PLAN_STATES)[number];

export const PLAN_TRANSITIONS: TransitionMap<PlanState> = {
  DRAFT: ['PROPOSED'],
  PROPOSED: ['POLICY_DENIED', 'APPROVAL_REQUIRED', 'AUTHORIZED'],
  APPROVAL_REQUIRED: ['AUTHORIZED'],
  POLICY_DENIED: [],
  AUTHORIZED: [],
};

export function assertPlanTransition(from: PlanState, to: PlanState): void {
  assertAllowedTransition('plan', PLAN_TRANSITIONS, from, to);
}
