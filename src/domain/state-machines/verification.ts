import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/**
 * Verification state machine (architecture handoff §9.3):
 * `VERIFICATION_PENDING -> EFFECT_VERIFIED | EFFECT_FAILED | TIMED_OUT |
 * EFFECT_REVERSED`.
 *
 * Resolved gap-fill (documented, not silent): the handoff diagram does not draw
 * an edge out of `EFFECT_VERIFIED`, but backend PRD §13.2 explicitly requires
 * "a later refund/reversal appends `EFFECT_REVERSED` ... and never erases the
 * prior run/allocation" — i.e. a VERIFIED effect must be able to move to
 * REVERSED when authoritative reversal evidence arrives later. We add exactly
 * that one edge; `EFFECT_FAILED` and `TIMED_OUT` remain terminal for this run
 * (a fresh action/verification run is created instead of resurrecting one).
 */
export const VERIFICATION_STATES = [
  'VERIFICATION_PENDING',
  'EFFECT_VERIFIED',
  'EFFECT_FAILED',
  'TIMED_OUT',
  'EFFECT_REVERSED',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_TRANSITIONS: TransitionMap<VerificationState> = {
  VERIFICATION_PENDING: ['EFFECT_VERIFIED', 'EFFECT_FAILED', 'TIMED_OUT', 'EFFECT_REVERSED'],
  EFFECT_VERIFIED: ['EFFECT_REVERSED'],
  EFFECT_FAILED: [],
  TIMED_OUT: [],
  EFFECT_REVERSED: [],
};

export function assertVerificationTransition(from: VerificationState, to: VerificationState): void {
  assertAllowedTransition('verification', VERIFICATION_TRANSITIONS, from, to);
}
