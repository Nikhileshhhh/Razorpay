import { describe, expect, it } from 'vitest';
import {
  Plan,
  PlanTemplateId,
  ToolActionId,
  ToolParameters,
} from '../../../src/contracts/plans.js';

describe('registered tools and plan templates', () => {
  it('accepts exactly the four documented tool ids', () => {
    for (const id of [
      'SUPPRESS_SIMULATED_RECOVERY',
      'SIMULATE_TRANSFER_REMEDIATION',
      'REQUEST_MORE_EVIDENCE',
      'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
    ]) {
      expect(ToolActionId.parse(id)).toBe(id);
    }
    expect(ToolActionId.options).toHaveLength(4);
  });

  it('accepts only the three documented plan templates (Gate B4 adds CLOSE_RECEIVABLE_AFTER_RECONCILIATION)', () => {
    expect(PlanTemplateId.parse('OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL')).toBeTruthy();
    expect(PlanTemplateId.parse('SUPPRESS_DUPLICATE_RECOVERY')).toBeTruthy();
    expect(PlanTemplateId.parse('CLOSE_RECEIVABLE_AFTER_RECONCILIATION')).toBeTruthy();
    expect(PlanTemplateId.options).toHaveLength(3);
    expect(PlanTemplateId.safeParse('SOME_OTHER_TEMPLATE').success).toBe(false);
  });

  it('a plan-template id is not a tool/action id', () => {
    expect(ToolActionId.safeParse('OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL').success).toBe(false);
    expect(PlanTemplateId.safeParse('SIMULATE_TRANSFER_REMEDIATION').success).toBe(false);
  });

  it('requires the CLOSE plan to be L3 with exactly zero INR impact', () => {
    const close = {
      schema_version: '1.0',
      plan_id: 'plan_close_1',
      case_id: 'case_close_1',
      template_id: 'CLOSE_RECEIVABLE_AFTER_RECONCILIATION',
      version: 0,
      parameters: {
        tool_id: 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
        expectation_id: 'exp_1',
      },
      plan_hash: `sha256:${'a'.repeat(64)}`,
      authority_level: 'L3',
      maximum_amount_impact: { amount_minor: '0', currency: 'INR' },
      status: 'AUTHORIZED',
    };
    expect(Plan.safeParse(close).success).toBe(true);
    expect(Plan.safeParse({ ...close, authority_level: 'L2' }).success).toBe(false);
    expect(
      Plan.safeParse({
        ...close,
        maximum_amount_impact: { amount_minor: '1', currency: 'INR' },
      }).success,
    ).toBe(false);
  });

  it('accepts strict typed tool parameters', () => {
    expect(
      ToolParameters.parse({
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        economic_subject: 'order:merchant-order-718:seller-42',
        expectation_id: 'exp_1',
      }).tool_id,
    ).toBe('SIMULATE_TRANSFER_REMEDIATION');
  });

  it('rejects arbitrary URL/HTTP/SQL/free-form tool definitions', () => {
    for (const bad of [
      { tool_id: 'GENERIC_HTTP', url: 'https://x', method: 'POST' },
      { tool_id: 'SIMULATE_TRANSFER_REMEDIATION', sql: 'DELETE FROM x' },
      {
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        economic_subject: 'x',
        expectation_id: 'e',
        extra: 1,
      },
      {
        tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
        economic_subject: 'x',
        expectation_id: 'e',
        amount_minor: '1',
      },
    ]) {
      expect(ToolParameters.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
