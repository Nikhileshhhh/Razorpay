import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../../../src/modules/policy/policy-engine.js';
import type { PolicyInputProjection } from '../../../src/contracts/policy.js';

function baseInput(overrides: Partial<PolicyInputProjection> = {}): PolicyInputProjection {
  return {
    schema_version: '1.0',
    tenant_id: 'ten_demo',
    environment: 'demo',
    actor_id: 'user_investigator',
    actor_role: 'case_manager',
    action_type: 'SIMULATE_TRANSFER_REMEDIATION',
    authority_level: 'L3',
    amount_impact: { amount_minor: '45500000', currency: 'INR' },
    target: 'subj_1',
    merchant_tier: null,
    customer_impact: 'medium',
    evidence_coverage: 'complete',
    contradiction_count: 0,
    case_version: 0,
    outcome_version: 0,
    approval_status: null,
    policy_bundle_version: 'moneytrace_demo_v1',
    ...overrides,
  };
}

describe('policy engine (backend PRD §12.2 exhaustive default-deny matrix)', () => {
  it('denies any L4/real-money authority regardless of everything else', () => {
    const result = evaluatePolicy(baseInput({ authority_level: 'L4' }));
    expect(result.decision).toBe('DENY');
    expect(result.matchedRules).toContain('REAL_MONEY_AUTHORITY_DENIED');
  });

  it('defensively denies a non-INR amount currency even if one somehow reached the engine', () => {
    // SupportedCurrency is INR-only at the schema layer; this simulates a
    // defense-in-depth check on the engine itself, not a normally-reachable input.
    const input = baseInput({
      amount_impact: { amount_minor: '100', currency: 'USD' as 'INR' },
    });
    const result = evaluatePolicy(input);
    expect(result.decision).toBe('DENY');
    expect(result.matchedRules).toContain('CURRENCY_MISMATCH');
  });

  it('denies an environment outside {demo, buildathon, test}', () => {
    const result = evaluatePolicy(baseInput({ environment: 'production' }));
    expect(result.decision).toBe('DENY');
    expect(result.matchedRules).toContain('ENVIRONMENT_NOT_ALLOWED');
  });

  it('denies an actor role with no operational rights (viewer)', () => {
    const result = evaluatePolicy(baseInput({ actor_role: 'viewer' }));
    expect(result.decision).toBe('DENY');
    expect(result.matchedRules).toContain('ACTOR_ROLE_NOT_PERMITTED');
  });

  it('requires more evidence when contradictions exist, before considering the action type', () => {
    const result = evaluatePolicy(
      baseInput({ contradiction_count: 2, action_type: 'SUPPRESS_SIMULATED_RECOVERY' }),
    );
    expect(result.decision).toBe('REQUIRE_MORE_EVIDENCE');
    expect(result.matchedRules).toContain('CONTRADICTING_EVIDENCE');
  });

  it('requires more evidence when coverage is not complete', () => {
    const result = evaluatePolicy(baseInput({ evidence_coverage: 'partial' }));
    expect(result.decision).toBe('REQUIRE_MORE_EVIDENCE');
    expect(result.matchedRules).toContain('INCOMPLETE_EVIDENCE_COVERAGE');
  });

  it('allows automatic execution for complete duplicate-recovery-suppression evidence', () => {
    const result = evaluatePolicy(
      baseInput({ action_type: 'SUPPRESS_SIMULATED_RECOVERY', amount_impact: null }),
    );
    expect(result.decision).toBe('ALLOW_AUTOMATIC');
    expect(result.requiredRole).toBe('executor');
  });

  it('requires finance_approver approval for simulated transfer remediation', () => {
    const result = evaluatePolicy(baseInput({ action_type: 'SIMULATE_TRANSFER_REMEDIATION' }));
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.requiredRole).toBe('finance_approver');
  });

  it('advises (no dispatch) for the informational REQUEST_MORE_EVIDENCE tool', () => {
    const result = evaluatePolicy(
      baseInput({ action_type: 'REQUEST_MORE_EVIDENCE', amount_impact: null }),
    );
    expect(result.decision).toBe('ADVISE');
  });

  it('denies CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION (Gate B4 scope, not yet available)', () => {
    const result = evaluatePolicy(
      baseInput({
        action_type: 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
        amount_impact: null,
      }),
    );
    expect(result.decision).toBe('DENY');
    expect(result.matchedRules).toContain('RECONCILIATION_CLOSURE_NOT_YET_AVAILABLE');
  });

  it('is a pure function: identical input always yields an identical decision', () => {
    const input = baseInput();
    const a = evaluatePolicy(input);
    const b = evaluatePolicy(input);
    expect(a).toEqual(b);
  });

  const environments: PolicyInputProjection['environment'][] = [
    'demo',
    'buildathon',
    'test',
    'development',
    'production',
  ];
  it.each(environments)('environment=%s only allows demo/buildathon/test through', (env) => {
    const result = evaluatePolicy(baseInput({ environment: env }));
    if (['demo', 'buildathon', 'test'].includes(env)) {
      expect(result.decision).not.toBe('DENY');
    } else {
      expect(result.decision).toBe('DENY');
    }
  });
});
