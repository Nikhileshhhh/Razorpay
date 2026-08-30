import { describe, expect, it } from 'vitest';
import { Finding, ModelInvestigationOutput } from '../../../src/contracts/findings.js';

const baseModelFinding = {
  schema_version: '1.0' as const,
  result_type: 'FINDING' as const,
  finding_code: 'MISSING_EXPECTED_TRANSFER' as const,
  summary: 'Captured payment is not linked to the expected seller transfer.',
  explanation: 'The customer payment is captured, but no transfer exists after grace.',
  supporting_evidence_ids: ['ev_payment_captured_17', 'ev_order_paid_19'],
  contradicting_evidence_ids: [],
  missing_evidence_types: ['authoritative_transfer_record'],
  confidence_band: 'high' as const,
  evidence_coverage: 'complete_for_finding' as const,
  safe_to_act: false,
  recommended_plan_template_id: 'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL' as const,
};

describe('model investigation output', () => {
  it('parses a valid FINDING output', () => {
    expect(ModelInvestigationOutput.parse(baseModelFinding).result_type).toBe('FINDING');
  });

  it('rejects missing or wrong schema_version', () => {
    const { schema_version: _s, ...noVersion } = baseModelFinding;
    expect(ModelInvestigationOutput.safeParse(noVersion).success).toBe(false);
    expect(
      ModelInvestigationOutput.safeParse({ ...baseModelFinding, schema_version: '2.0' }).success,
    ).toBe(false);
  });

  it('rejects a FINDING with zero supporting evidence', () => {
    expect(
      ModelInvestigationOutput.safeParse({ ...baseModelFinding, supporting_evidence_ids: [] })
        .success,
    ).toBe(false);
  });

  it('parses a valid ABSTENTION and rejects a conflicting abstention without contradictions', () => {
    const abstention = {
      schema_version: '1.0' as const,
      result_type: 'ABSTENTION' as const,
      abstention_reason: 'CONFLICTING_EVIDENCE' as const,
      summary: 'Bank evidence conflicts on UTR and date.',
      explanation: 'Cannot safely resolve.',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: ['ev_bank_22', 'ev_settlement_14'],
      missing_evidence_types: [],
      confidence_band: 'low' as const,
      evidence_coverage: 'insufficient' as const,
      recommended_plan_template_id: null,
    };
    expect(ModelInvestigationOutput.parse(abstention).result_type).toBe('ABSTENTION');
    expect(
      ModelInvestigationOutput.safeParse({ ...abstention, contradicting_evidence_ids: [] }).success,
    ).toBe(false);
  });

  it('rejects authoritative money and forbidden control fields', () => {
    for (const extra of [
      { exposure_amount_minor: '45500000' },
      { currency: 'INR' },
      { policy_decision: 'ALLOW_AUTOMATIC' },
      { approval_decision: 'approve' },
      { verification_status: 'EFFECT_VERIFIED' },
      { reconciliation_id: 'rec_1' },
      { case_state: 'reconciled' },
    ]) {
      expect(ModelInvestigationOutput.safeParse({ ...baseModelFinding, ...extra }).success).toBe(
        false,
      );
    }
  });

  it('rejects an unknown finding code', () => {
    expect(
      ModelInvestigationOutput.safeParse({ ...baseModelFinding, finding_code: 'MADE_UP_CODE' })
        .success,
    ).toBe(false);
  });
});

describe('persisted finding (provenance union)', () => {
  const common = {
    schema_version: '1.0' as const,
    finding_id: 'find_1',
    case_id: 'case_1',
    finding_code: 'MISSING_EXPECTED_TRANSFER' as const,
    summary: 'x',
    confidence_band: 'high' as const,
    supporting_evidence_ids: ['ev_1'],
    contradicting_evidence_ids: [],
    missing_evidence_types: [],
    evidence_set_hash: `sha256:${'a'.repeat(64)}`,
    exposure: { amount_minor: '45500000', currency: 'INR' },
    created_at: '2026-08-25T05:20:00Z',
  };

  it('accepts a model-validated finding with complete model metadata', () => {
    const f = Finding.parse({
      ...common,
      provenance: 'MODEL_VALIDATED',
      model_id: 'model-stub',
      prompt_version: 'p1',
      output_schema_version: '1.0',
    });
    if (f.provenance !== 'MODEL_VALIDATED') throw new Error('wrong variant');
    expect(f.model_id).toBe('model-stub');
  });

  it('accepts a rules-only finding without fabricated model metadata', () => {
    const f = Finding.parse({
      ...common,
      provenance: 'RULES_ONLY',
      validator_id: 'ctrl-01',
      validator_version: 'v1',
    });
    expect(f.provenance).toBe('RULES_ONLY');
  });

  it('rejects a rules-only finding carrying model metadata', () => {
    expect(
      Finding.safeParse({
        ...common,
        provenance: 'RULES_ONLY',
        validator_id: 'ctrl-01',
        validator_version: 'v1',
        model_id: 'model-stub',
      }).success,
    ).toBe(false);
  });

  it('rejects a material finding with zero supporting evidence', () => {
    expect(
      Finding.safeParse({
        ...common,
        supporting_evidence_ids: [],
        provenance: 'RULES_ONLY',
        validator_id: 'ctrl-01',
        validator_version: 'v1',
      }).success,
    ).toBe(false);
  });
});
