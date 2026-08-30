import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/**
 * Action state machine (architecture handoff §9.3):
 * `AUTHORIZED -> RESERVED -> DISPATCHING -> ACKNOWLEDGED | OUTCOME_UNKNOWN |
 * FAILED`, then `ACKNOWLEDGED | OUTCOME_UNKNOWN -> VERIFICATION_PENDING`.
 *
 * `OUTCOME_UNKNOWN` is NOT `FAILED` — it never transitions to `FAILED` within
 * this machine. It is checked/reconciled (never blindly retried with a new
 * idempotency key) until the independent Verification machine resolves it via
 * `EFFECT_VERIFIED` / `EFFECT_FAILED` / `TIMED_OUT`.
 */
export const ACTION_STATES = [
  'AUTHORIZED',
  'RESERVED',
  'DISPATCHING',
  'ACKNOWLEDGED',
  'OUTCOME_UNKNOWN',
  'FAILED',
  'VERIFICATION_PENDING',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export const ACTION_TRANSITIONS: TransitionMap<ActionState> = {
  AUTHORIZED: ['RESERVED'],
  RESERVED: ['DISPATCHING'],
  DISPATCHING: ['ACKNOWLEDGED', 'OUTCOME_UNKNOWN', 'FAILED'],
  ACKNOWLEDGED: ['VERIFICATION_PENDING'],
  OUTCOME_UNKNOWN: ['VERIFICATION_PENDING'],
  FAILED: [],
  VERIFICATION_PENDING: [],
};

export function assertActionTransition(from: ActionState, to: ActionState): void {
  assertAllowedTransition('action', ACTION_TRANSITIONS, from, to);
}
