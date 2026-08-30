import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/**
 * Case lifecycle state machine (PRD §18.4, FR-CASE-004). Independent of the
 * financial-outcome, plan, approval, action, and verification machines — none
 * of those enums substitute for this one.
 *
 * Literal backbone (PRD §18.4):
 *   candidate -> open -> investigating -> recommendation_ready ->
 *   approval_required -> approved -> executing -> verification_pending ->
 *   reconciled
 *
 * Documented additions beyond the literal backbone (not guesses — each is
 * required by an explicit requirement elsewhere in the controlling docs):
 *  - `recommendation_ready -> executing`: backend PRD §12.2 requires a
 *    complete duplicate-recovery finding + `SUPPRESS_SIMULATED_RECOVERY` to
 *    receive policy `ALLOW_AUTOMATIC`, which by definition skips the approval
 *    step (scenario 4, backend PRD §2).
 *  - "Any non-terminal state -> `abstained`" (PRD §18.4, stated literally).
 *  - `abstained -> investigating`: backend PRD §9.2/handoff §20.5 requires
 *    late evidence to trigger case reevaluation, so an abstained case must be
 *    able to re-enter investigation once new evidence changes the picture.
 *  - `approval_required -> rejected | expired`: the Approval machine's own
 *    REJECTED/EXPIRED outcomes must be reflected on the case that requested it.
 *  - Manual operator escape hatches (`escalated`, `cancelled`,
 *    `closed_no_action`) from every open non-terminal state, needed by the
 *    control-loop/assign/notes endpoints (backend PRD §14.2) for real case
 *    management; these do not affect the four required demo scenarios.
 *
 * `reconciled` is terminal FOR ITS EPOCH: a later authoritative reversal opens
 * a NEW case epoch rather than transitioning the same row (handoff §9.1,
 * backend PRD §7.4) — so `reconciled` correctly has no outgoing edges here.
 */
export const CASE_LIFECYCLE_STATES = [
  'candidate',
  'open',
  'investigating',
  'recommendation_ready',
  'approval_required',
  'approved',
  'executing',
  'verification_pending',
  'reconciled',
  'abstained',
  'escalated',
  'rejected',
  'expired',
  'cancelled',
  'closed_no_action',
] as const;
export type CaseLifecycleState = (typeof CASE_LIFECYCLE_STATES)[number];

const ESCAPE_HATCHES = ['escalated', 'cancelled', 'closed_no_action'] as const;

export const CASE_LIFECYCLE_TRANSITIONS: TransitionMap<CaseLifecycleState> = {
  candidate: ['open', 'abstained', ...ESCAPE_HATCHES],
  open: ['investigating', 'abstained', ...ESCAPE_HATCHES],
  investigating: ['recommendation_ready', 'abstained', ...ESCAPE_HATCHES],
  recommendation_ready: ['approval_required', 'executing', 'abstained', ...ESCAPE_HATCHES],
  approval_required: ['approved', 'rejected', 'expired', 'abstained', ...ESCAPE_HATCHES],
  approved: ['executing', 'abstained', ...ESCAPE_HATCHES],
  executing: ['verification_pending', 'abstained', ...ESCAPE_HATCHES],
  verification_pending: ['reconciled', 'abstained', ...ESCAPE_HATCHES],
  abstained: ['investigating', ...ESCAPE_HATCHES],
  reconciled: [],
  escalated: [],
  rejected: [],
  expired: [],
  cancelled: [],
  closed_no_action: [],
};

export function assertCaseLifecycleTransition(
  from: CaseLifecycleState,
  to: CaseLifecycleState,
): void {
  assertAllowedTransition('case_lifecycle', CASE_LIFECYCLE_TRANSITIONS, from, to);
}
