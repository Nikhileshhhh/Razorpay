import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PLAN_TEMPLATE_TOOL_MAP,
  Plan,
  RegisteredToolRequest,
  RegisteredToolResult,
  ToolParameters,
  type ToolActionId,
} from '../../../src/contracts/plans.js';

const simulateParams = {
  tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
  economic_subject: 'order:merchant-order-718:seller-42',
  expectation_id: 'exp_1',
};

const planWith = (parameters: Record<string, unknown>) => ({
  schema_version: '1.0',
  plan_id: 'plan_1',
  case_id: 'case_1',
  template_id: 'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL',
  version: 1,
  parameters,
  plan_hash: `sha256:${'a'.repeat(64)}`,
  authority_level: 'L3',
  maximum_amount_impact: { amount_minor: '45500000', currency: 'INR' },
  status: 'PROPOSED',
});

const suppressParams = { tool_id: 'SUPPRESS_SIMULATED_RECOVERY', economic_subject: 'subj_1' };

const suppressPlanWith = (parameters: Record<string, unknown>) => ({
  schema_version: '1.0',
  plan_id: 'plan_2',
  case_id: 'case_1',
  template_id: 'SUPPRESS_DUPLICATE_RECOVERY',
  version: 1,
  parameters,
  plan_hash: `sha256:${'b'.repeat(64)}`,
  authority_level: 'L2',
  maximum_amount_impact: { amount_minor: '0', currency: 'INR' },
  status: 'PROPOSED',
});

describe('plan template -> tool binding', () => {
  it('OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL maps only to SIMULATE_TRANSFER_REMEDIATION', () => {
    expect(PLAN_TEMPLATE_TOOL_MAP.OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL).toEqual([
      'SIMULATE_TRANSFER_REMEDIATION',
    ]);
  });

  it('SUPPRESS_DUPLICATE_RECOVERY (Gate B3) maps only to SUPPRESS_SIMULATED_RECOVERY', () => {
    expect(PLAN_TEMPLATE_TOOL_MAP.SUPPRESS_DUPLICATE_RECOVERY).toEqual([
      'SUPPRESS_SIMULATED_RECOVERY',
    ]);
  });

  it('accepts a plan binding the permitted tool', () => {
    expect(Plan.parse(planWith(simulateParams)).template_id).toBe(
      'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL',
    );
    expect(Plan.parse(suppressPlanWith(suppressParams)).template_id).toBe(
      'SUPPRESS_DUPLICATE_RECOVERY',
    );
  });

  it('rejects the transfer-remediation template bound to any other tool', () => {
    for (const parameters of [
      { tool_id: 'SUPPRESS_SIMULATED_RECOVERY', economic_subject: 's' },
      { tool_id: 'REQUEST_MORE_EVIDENCE', missing_evidence_types: ['bank_credit'] },
      { tool_id: 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION', expectation_id: 'exp_1' },
    ]) {
      expect(Plan.safeParse(planWith(parameters)).success, parameters.tool_id).toBe(false);
    }
  });

  it('rejects the suppress-recovery template bound to any other tool', () => {
    for (const parameters of [
      simulateParams,
      { tool_id: 'REQUEST_MORE_EVIDENCE', missing_evidence_types: ['bank_credit'] },
      { tool_id: 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION', expectation_id: 'exp_1' },
    ]) {
      expect(Plan.safeParse(suppressPlanWith(parameters)).success, parameters.tool_id).toBe(false);
    }
  });
});

describe('tool parameters', () => {
  it('REQUEST_MORE_EVIDENCE requires at least one missing evidence type', () => {
    expect(
      ToolParameters.safeParse({ tool_id: 'REQUEST_MORE_EVIDENCE', missing_evidence_types: [] })
        .success,
    ).toBe(false);
    expect(
      ToolParameters.parse({
        tool_id: 'REQUEST_MORE_EVIDENCE',
        missing_evidence_types: ['bank_credit'],
      }).tool_id,
    ).toBe('REQUEST_MORE_EVIDENCE');
  });
});

describe('registered tool request/result (versioned)', () => {
  it('preserves the exact tool-id union at compile time', () => {
    expectTypeOf<RegisteredToolRequest['tool_id']>().toEqualTypeOf<ToolActionId>();
  });

  it('accepts a versioned request whose tool_id matches its parameters', () => {
    expect(
      RegisteredToolRequest.parse({
        schema_version: '1.0',
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        tool_version: 'v1',
        parameters: simulateParams,
      }).tool_id,
    ).toBe('SIMULATE_TRANSFER_REMEDIATION');
  });

  it('rejects missing/wrong schema_version and mismatched parameters', () => {
    expect(
      RegisteredToolRequest.safeParse({
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        tool_version: 'v1',
        parameters: simulateParams,
      }).success,
    ).toBe(false);
    expect(
      RegisteredToolRequest.safeParse({
        schema_version: '2.0',
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        tool_version: 'v1',
        parameters: simulateParams,
      }).success,
    ).toBe(false);
    // tool_id says suppress but parameters are simulate -> discriminator mismatch.
    expect(
      RegisteredToolRequest.safeParse({
        schema_version: '1.0',
        tool_id: 'SUPPRESS_SIMULATED_RECOVERY',
        tool_version: 'v1',
        parameters: simulateParams,
      }).success,
    ).toBe(false);
  });

  it('a tool result distinguishes ACK/FAIL/UNKNOWN and never claims verified effect', () => {
    for (const status of ['ACKNOWLEDGED', 'FAILED', 'OUTCOME_UNKNOWN'] as const) {
      expect(
        RegisteredToolResult.parse({
          schema_version: '1.0',
          tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
          tool_version: 'v1',
          status,
          external_reference: null,
          submitted_at: '2026-08-25T05:20:00Z',
          acknowledged_at: status === 'ACKNOWLEDGED' ? '2026-08-25T05:20:01Z' : null,
        }).status,
      ).toBe(status);
    }
    // No verified-effect field is permitted on a tool result.
    expect(
      RegisteredToolResult.safeParse({
        schema_version: '1.0',
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        tool_version: 'v1',
        status: 'ACKNOWLEDGED',
        external_reference: null,
        submitted_at: '2026-08-25T05:20:00Z',
        acknowledged_at: null,
        verified_amount: { amount_minor: '1', currency: 'INR' },
      }).success,
    ).toBe(false);
    expect(
      RegisteredToolResult.safeParse({
        schema_version: '1.0',
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        tool_version: 'v1',
        status: 'ACKNOWLEDGED',
        external_reference: null,
        submitted_at: '2026-08-25T05:20:00Z',
        acknowledged_at: null,
      }).success,
    ).toBe(false);
  });
});
