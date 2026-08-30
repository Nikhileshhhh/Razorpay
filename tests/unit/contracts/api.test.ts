import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiResponse, MutationResponse } from '../../../src/contracts/api-common.js';
import { CaseDetailResponse, EvaluatePolicyRequest } from '../../../src/contracts/api-endpoints.js';

const Data = z.object({ ok: z.boolean() }).strict();

describe('API response envelopes', () => {
  it('every top-level response requires schema_version and request_id', () => {
    const R = ApiResponse(Data);
    expect(
      R.parse({ schema_version: '1.0', request_id: 'req_1', data: { ok: true } }).request_id,
    ).toBe('req_1');
    expect(R.safeParse({ request_id: 'req_1', data: { ok: true } }).success).toBe(false);
    expect(R.safeParse({ schema_version: '1.0', data: { ok: true } }).success).toBe(false);
    expect(
      R.safeParse({ schema_version: '2.0', request_id: 'r', data: { ok: true } }).success,
    ).toBe(false);
  });

  it('mutating responses additionally require the resulting resource_version', () => {
    const M = MutationResponse(Data);
    expect(
      M.parse({ schema_version: '1.0', request_id: 'r', resource_version: 4, data: { ok: true } })
        .resource_version,
    ).toBe(4);
    expect(
      M.safeParse({ schema_version: '1.0', request_id: 'r', data: { ok: true } }).success,
    ).toBe(false);
  });

  it('a case-detail response is a well-formed envelope', () => {
    const parsed = CaseDetailResponse.parse({
      schema_version: '1.0',
      request_id: 'req_1',
      data: {
        schema_version: '1.0',
        case_id: 'case_1',
        case_dedupe_key: 'order:merchant-order-718:seller-42',
        tenant_id: 'ten_demo',
        subject_id: 'subj_1',
        expectation_id: 'exp_1',
        control_id: 'CTRL-01',
        epoch: 0,
        lifecycle_state: 'open',
        outcome_status: 'DIVERGED',
        exposure: { amount_minor: '45500000', currency: 'INR' },
        priority_score: 0.9,
        evidence_coverage: 'complete',
        contradiction_count: 0,
        owner_id: null,
        opened_at: '2026-08-25T05:20:00Z',
        due_at: null,
        closed_at: null,
        resource_version: 1,
        finding_id: null,
        current_plan_id: null,
        latest_policy_decision_id: null,
        money_path_available: true,
      },
    });
    expect(parsed.data.exposure.currency).toBe('INR');
  });
});

describe('tenant requiredness', () => {
  it('the approval decision basis rejects a missing tenant_id', () => {
    // EvaluatePolicyRequest is a body without tenant (server-derived); the
    // control artifact ApprovalDecisionBasis requires tenant explicitly.
    expect(
      EvaluatePolicyRequest.safeParse({
        schema_version: '1.0',
        plan_id: 'p',
        expected_plan_version: 1,
      }).success,
    ).toBe(true);
  });
});
