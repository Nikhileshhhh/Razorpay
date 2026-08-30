import { describe, expect, it } from 'vitest';
import { ActionStatus } from '../../../src/contracts/actions.js';
import { ApprovalDecisionBasis, ApprovalRecord } from '../../../src/contracts/approvals.js';
import { PolicyDecision } from '../../../src/contracts/policy.js';
import { ApproveRequest } from '../../../src/contracts/api-endpoints.js';

describe('policy / approval / action enums', () => {
  it('policy decisions are the five documented values; unknown rejects', () => {
    for (const d of [
      'ALLOW_AUTOMATIC',
      'REQUIRE_APPROVAL',
      'ADVISE',
      'DENY',
      'REQUIRE_MORE_EVIDENCE',
    ]) {
      expect(PolicyDecision.parse(d)).toBe(d);
    }
    expect(PolicyDecision.safeParse('ALLOW_EVERYTHING').success).toBe(false);
  });

  it('OUTCOME_UNKNOWN is a distinct action status from FAILED', () => {
    expect(ActionStatus.parse('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
    expect(ActionStatus.parse('FAILED')).toBe('FAILED');
    expect(ActionStatus.options).toContain('OUTCOME_UNKNOWN');
    expect(ActionStatus.options).toContain('FAILED');
  });
});

describe('approval decision basis', () => {
  const basis = {
    schema_version: '1.0',
    tenant_id: 'ten_demo',
    case_id: 'case_1',
    case_version: 3,
    plan_id: 'plan_1',
    plan_version: 2,
    plan_hash: `sha256:${'a'.repeat(64)}`,
    evidence_set_hash: `sha256:${'b'.repeat(64)}`,
    policy_bundle_version: 'moneytrace_demo_v1',
    policy_decision_id: 'dec_1',
    action_type: 'SIMULATE_TRANSFER_REMEDIATION',
    target: 'order:merchant-order-718:seller-42',
    amount_impact_minor: '45500000',
    currency: 'INR',
    verification_contract_key: 'transfer_remediation',
    verification_contract_version: 'vc_v1',
    required_role: 'finance_approver',
    expires_at: '2026-08-25T12:00:00Z',
  };

  it('accepts all 16 documented binding fields', () => {
    expect(ApprovalDecisionBasis.parse(basis).plan_hash).toContain('sha256:');
  });

  it('rejects a basis missing a binding field', () => {
    const { plan_hash: _drop, ...missing } = basis;
    expect(ApprovalDecisionBasis.safeParse(missing).success).toBe(false);
  });

  it('rejects an unknown extra field on the basis', () => {
    expect(ApprovalDecisionBasis.safeParse({ ...basis, sneaky: 1 }).success).toBe(false);
  });
});

describe('approval request (client)', () => {
  it('accepts a request without any identity', () => {
    expect(
      ApproveRequest.parse({
        schema_version: '1.0',
        approval_id: 'apr_1',
        decision_basis_hash: `sha256:${'c'.repeat(64)}`,
      }).approval_id,
    ).toBe('apr_1');
  });

  it('rejects a client-supplied approver/requester identity or role', () => {
    for (const bad of [
      { approver_id: 'u1' },
      { requester_id: 'u2' },
      { approver_role: 'finance_approver' },
    ]) {
      expect(
        ApproveRequest.safeParse({
          schema_version: '1.0',
          approval_id: 'apr_1',
          decision_basis_hash: `sha256:${'c'.repeat(64)}`,
          ...bad,
        }).success,
      ).toBe(false);
    }
  });

  it('the persisted approval record does carry a server-derived requester_id', () => {
    const record = ApprovalRecord.parse({
      schema_version: '1.0',
      approval_id: 'apr_1',
      decision_basis_hash: `sha256:${'c'.repeat(64)}`,
      requester_id: 'user_prep',
      approver_id: null,
      approver_role: null,
      decision: null,
      state: 'REQUESTED',
      requested_at: '2026-08-25T11:00:00Z',
      decided_at: null,
      expires_at: '2026-08-25T12:00:00Z',
    });
    expect(record.state).toBe('REQUESTED');
  });

  it('correlates terminal approval states with decision identity and time', () => {
    const requested = {
      schema_version: '1.0',
      approval_id: 'apr_1',
      decision_basis_hash: `sha256:${'c'.repeat(64)}`,
      requester_id: 'user_prep',
      approver_id: null,
      approver_role: null,
      decision: null,
      state: 'REQUESTED',
      requested_at: '2026-08-25T11:00:00Z',
      decided_at: null,
      expires_at: '2026-08-25T12:00:00Z',
    };

    expect(
      ApprovalRecord.safeParse({
        ...requested,
        state: 'APPROVED',
        approver_id: 'user_approver',
        approver_role: 'finance_approver',
        decision: 'approve',
        decided_at: '2026-08-25T11:30:00Z',
      }).success,
    ).toBe(true);
    expect(ApprovalRecord.safeParse({ ...requested, state: 'APPROVED' }).success).toBe(false);
    expect(
      ApprovalRecord.safeParse({
        ...requested,
        state: 'REJECTED',
        approver_id: 'user_approver',
        approver_role: 'finance_approver',
        decision: 'reject',
        reason: 'insufficient evidence',
        decided_at: '2026-08-25T11:30:00Z',
      }).success,
    ).toBe(true);
    expect(
      ApprovalRecord.safeParse({ ...requested, decision: 'approve', state: 'REQUESTED' }).success,
    ).toBe(false);
  });
});
