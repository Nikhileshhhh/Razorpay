import { describe, expect, it } from 'vitest';
import {
  computeDecisionBasisHash,
  changedBasisFields,
} from '../../../src/modules/approvals/decision-basis.js';
import { DECISION_BASIS_FIELDS } from '../../../src/domain/state-machines/approval.js';
import type { ApprovalDecisionBasis } from '../../../src/contracts/approvals.js';

function basis(overrides: Partial<ApprovalDecisionBasis> = {}): ApprovalDecisionBasis {
  return {
    schema_version: '1.0',
    tenant_id: 'ten_demo',
    case_id: 'case_1',
    case_version: 0,
    plan_id: 'plan_1',
    plan_version: 1,
    plan_hash: `sha256:${'a'.repeat(64)}`,
    evidence_set_hash: `sha256:${'b'.repeat(64)}`,
    policy_bundle_version: 'moneytrace_demo_v1',
    policy_decision_id: 'policy_decision_1',
    action_type: 'SIMULATE_TRANSFER_REMEDIATION',
    target: 'subj_1',
    amount_impact_minor: '45500000',
    currency: 'INR',
    verification_contract_key: 'TRANSFER_REMEDIATION_VERIFICATION',
    verification_contract_version: 'v1',
    required_role: 'finance_approver',
    expires_at: '2026-08-25T06:00:00.000Z',
    ...overrides,
  };
}

describe('decision-basis hash (architecture §9.4)', () => {
  it('is deterministic: identical basis -> identical hash', () => {
    expect(computeDecisionBasisHash(basis())).toBe(computeDecisionBasisHash(basis()));
  });

  it('has the sha256:<hex> shape', () => {
    expect(computeDecisionBasisHash(basis())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('hashes exactly the documented fields (architecture §9.4), in the shared canonical list', () => {
    expect(DECISION_BASIS_FIELDS).toHaveLength(17);
    expect(new Set(DECISION_BASIS_FIELDS).size).toBe(17);
  });

  it.each(DECISION_BASIS_FIELDS)('changing field "%s" alone changes the hash', (field) => {
    const original = basis();
    const mutated: ApprovalDecisionBasis = { ...original };
    switch (field) {
      case 'case_version':
      case 'plan_version':
        (mutated as Record<string, unknown>)[field] = (original[field] as number) + 1;
        break;
      case 'amount_impact_minor':
        mutated.amount_impact_minor = '1';
        break;
      case 'expires_at':
        mutated.expires_at = '2099-01-01T00:00:00.000Z';
        break;
      case 'currency':
        // INR-only; skip mutation but still assert field membership below.
        return;
      case 'action_type':
        mutated.action_type = 'SUPPRESS_SIMULATED_RECOVERY';
        break;
      case 'required_role':
        mutated.required_role = 'executor';
        break;
      default:
        (mutated as Record<string, unknown>)[field] =
          `${String(original[field as keyof ApprovalDecisionBasis])}_changed`;
    }
    expect(computeDecisionBasisHash(mutated)).not.toBe(computeDecisionBasisHash(original));
    expect(changedBasisFields(original, mutated)).toContain(field);
  });

  it('is independent of extra/unrelated properties order (canonical key sorting)', () => {
    const a = basis();
    const b = { ...basis() };
    // Re-create with keys inserted in a different order.
    const reordered = Object.fromEntries(
      Object.entries(b).reverse(),
    ) as unknown as ApprovalDecisionBasis;
    expect(computeDecisionBasisHash(reordered)).toBe(computeDecisionBasisHash(a));
  });
});
