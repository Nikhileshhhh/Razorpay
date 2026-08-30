import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/**
 * Financial outcome state machine (architecture handoff §9.1). This is the
 * DETERMINISTIC ground truth of whether money reached its intended destination
 * — independent of case lifecycle, plan, approval, action, and verification
 * states, which are guarded separately.
 */
export const FINANCIAL_OUTCOME_STATES = [
  'EXPECTED',
  'OBSERVED_UNVERIFIED',
  'DIVERGED',
  'ACTION_PENDING',
  'VERIFIED',
  'REVERSED',
  'UNRESOLVED',
] as const;
export type FinancialOutcomeState = (typeof FINANCIAL_OUTCOME_STATES)[number];

export const FINANCIAL_OUTCOME_TRANSITIONS: TransitionMap<FinancialOutcomeState> = {
  EXPECTED: ['OBSERVED_UNVERIFIED', 'DIVERGED', 'UNRESOLVED'],
  OBSERVED_UNVERIFIED: ['VERIFIED', 'DIVERGED', 'UNRESOLVED'],
  // DIVERGED -> VERIFIED is only sound when authoritative late evidence proves
  // the original obligation WITHOUT remediation; the caller (verification
  // service) must confirm that precondition before invoking this transition —
  // the pure graph only says the edge exists.
  DIVERGED: ['ACTION_PENDING', 'OBSERVED_UNVERIFIED', 'VERIFIED', 'UNRESOLVED'],
  ACTION_PENDING: ['OBSERVED_UNVERIFIED', 'DIVERGED', 'UNRESOLVED'],
  // VERIFIED can only be reached via the full terminal-verification precondition
  // (backend PRD §7.4); from here the ONLY forward edge is an authoritative
  // reversal.
  VERIFIED: ['REVERSED'],
  REVERSED: ['ACTION_PENDING', 'OBSERVED_UNVERIFIED', 'UNRESOLVED'],
  UNRESOLVED: ['OBSERVED_UNVERIFIED', 'DIVERGED'],
};

export function assertFinancialOutcomeTransition(
  from: FinancialOutcomeState,
  to: FinancialOutcomeState,
): void {
  assertAllowedTransition('financial_outcome', FINANCIAL_OUTCOME_TRANSITIONS, from, to);
}
