import { describe, expect, it } from 'vitest';
import {
  ACTION_STATES,
  ACTION_TRANSITIONS,
  assertActionTransition,
  AGENT_CLAIM_STATES,
  AGENT_CLAIM_TRANSITIONS,
  assertAgentClaimTransition,
  APPROVAL_STATES,
  APPROVAL_TRANSITIONS,
  assertApprovalTransition,
  CASE_LIFECYCLE_STATES,
  CASE_LIFECYCLE_TRANSITIONS,
  assertCaseLifecycleTransition,
  FINANCIAL_OUTCOME_STATES,
  FINANCIAL_OUTCOME_TRANSITIONS,
  assertFinancialOutcomeTransition,
  PLAN_STATES,
  PLAN_TRANSITIONS,
  assertPlanTransition,
  VERIFICATION_STATES,
  VERIFICATION_TRANSITIONS,
  assertVerificationTransition,
  ForbiddenTransitionError,
} from '../../../../src/domain/state-machines/index.js';

/** Table-driven exhaustive check: every declared edge is allowed; every other pair is forbidden. */
function exhaustiveCheck<S extends string>(
  name: string,
  states: readonly S[],
  transitions: Readonly<Record<S, readonly S[]>>,
  assertFn: (from: S, to: S) => void,
) {
  describe(`${name} — exhaustive transition table`, () => {
    for (const from of states) {
      for (const to of states) {
        const allowed = (transitions[from] ?? []).includes(to);
        if (from === to) continue; // no-op transitions are a service-layer concern, not this graph
        it(`${from} -> ${to} is ${allowed ? 'allowed' : 'forbidden'}`, () => {
          if (allowed) {
            expect(() => assertFn(from, to)).not.toThrow();
          } else {
            expect(() => assertFn(from, to)).toThrow(ForbiddenTransitionError);
          }
        });
      }
    }
  });
}

exhaustiveCheck(
  'financial outcome',
  FINANCIAL_OUTCOME_STATES,
  FINANCIAL_OUTCOME_TRANSITIONS,
  assertFinancialOutcomeTransition,
);
exhaustiveCheck(
  'case lifecycle',
  CASE_LIFECYCLE_STATES,
  CASE_LIFECYCLE_TRANSITIONS,
  assertCaseLifecycleTransition,
);
exhaustiveCheck(
  'agent claim',
  AGENT_CLAIM_STATES,
  AGENT_CLAIM_TRANSITIONS,
  assertAgentClaimTransition,
);
exhaustiveCheck('plan', PLAN_STATES, PLAN_TRANSITIONS, assertPlanTransition);
exhaustiveCheck('approval', APPROVAL_STATES, APPROVAL_TRANSITIONS, assertApprovalTransition);
exhaustiveCheck('action', ACTION_STATES, ACTION_TRANSITIONS, assertActionTransition);
exhaustiveCheck(
  'verification',
  VERIFICATION_STATES,
  VERIFICATION_TRANSITIONS,
  assertVerificationTransition,
);

describe('specific financial-safety edges', () => {
  it('VERIFIED can only reach REVERSED (never directly back to a divergent state)', () => {
    expect(() => assertFinancialOutcomeTransition('VERIFIED', 'REVERSED')).not.toThrow();
    expect(() => assertFinancialOutcomeTransition('VERIFIED', 'DIVERGED')).toThrow(
      ForbiddenTransitionError,
    );
    expect(() => assertFinancialOutcomeTransition('VERIFIED', 'EXPECTED')).toThrow(
      ForbiddenTransitionError,
    );
  });

  it('REVERSED cannot jump straight back to VERIFIED', () => {
    expect(() => assertFinancialOutcomeTransition('REVERSED', 'VERIFIED')).toThrow(
      ForbiddenTransitionError,
    );
  });

  it('action OUTCOME_UNKNOWN never transitions to FAILED (distinct from failure)', () => {
    expect(() => assertActionTransition('OUTCOME_UNKNOWN', 'FAILED')).toThrow(
      ForbiddenTransitionError,
    );
    expect(() => assertActionTransition('OUTCOME_UNKNOWN', 'VERIFICATION_PENDING')).not.toThrow();
  });

  it('a rejected/expired/invalidated approval is terminal for that request', () => {
    for (const terminal of ['REJECTED', 'EXPIRED', 'INVALIDATED'] as const) {
      for (const target of APPROVAL_STATES) {
        if (target === terminal) continue;
        expect(() => assertApprovalTransition(terminal, target)).toThrow(ForbiddenTransitionError);
      }
    }
  });

  it('reconciled case epoch has no outgoing edge (reopening creates a new epoch)', () => {
    for (const target of CASE_LIFECYCLE_STATES) {
      if (target === 'reconciled') continue;
      expect(() => assertCaseLifecycleTransition('reconciled', target)).toThrow(
        ForbiddenTransitionError,
      );
    }
  });
});
