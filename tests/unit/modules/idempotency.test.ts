import { describe, expect, it } from 'vitest';
import {
  computeActionIdempotencyKey,
  computeActionRequestHash,
} from '../../../src/modules/actions/idempotency.js';

describe('action idempotency key derivation (backend PRD §12.4)', () => {
  const base = {
    tenantId: 'ten_demo',
    caseId: 'case_1',
    planHash: `sha256:${'a'.repeat(64)}`,
    toolId: 'SIMULATE_TRANSFER_REMEDIATION',
    target: 'subj_1',
  };

  it('is deterministic and stable for identical inputs', () => {
    expect(computeActionIdempotencyKey(base)).toBe(computeActionIdempotencyKey({ ...base }));
  });

  it('changes if the tenant, case, plan hash, tool, or target differ', () => {
    const key = computeActionIdempotencyKey(base);
    expect(computeActionIdempotencyKey({ ...base, tenantId: 'ten_other' })).not.toBe(key);
    expect(computeActionIdempotencyKey({ ...base, caseId: 'case_2' })).not.toBe(key);
    expect(computeActionIdempotencyKey({ ...base, planHash: `sha256:${'b'.repeat(64)}` })).not.toBe(
      key,
    );
    expect(
      computeActionIdempotencyKey({ ...base, toolId: 'SUPPRESS_SIMULATED_RECOVERY' }),
    ).not.toBe(key);
    expect(computeActionIdempotencyKey({ ...base, target: 'subj_2' })).not.toBe(key);
  });

  it('is NOT derived from a random value (no nondeterminism)', () => {
    const keys = new Set(Array.from({ length: 5 }, () => computeActionIdempotencyKey(base)));
    expect(keys.size).toBe(1);
  });
});

describe('action request-body hash (409 IDEMPOTENCY_BODY_CONFLICT signal)', () => {
  it('is deterministic for identical plan/basis pairs', () => {
    const input = { planId: 'plan_1', decisionBasisHash: `sha256:${'c'.repeat(64)}` };
    expect(computeActionRequestHash(input)).toBe(computeActionRequestHash({ ...input }));
  });

  it('changes when the decision basis hash differs (a different body under the same key)', () => {
    const a = computeActionRequestHash({
      planId: 'plan_1',
      decisionBasisHash: `sha256:${'c'.repeat(64)}`,
    });
    const b = computeActionRequestHash({
      planId: 'plan_1',
      decisionBasisHash: `sha256:${'d'.repeat(64)}`,
    });
    expect(a).not.toBe(b);
  });
});
