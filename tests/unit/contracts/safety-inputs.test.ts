import { describe, expect, it } from 'vitest';
import { SourceAuthorityRecord } from '../../../src/contracts/authority.js';
import { VerificationContract, VerificationResult } from '../../../src/contracts/verification.js';
import { MoneyPath } from '../../../src/contracts/cases.js';
import { PolicyInputProjection } from '../../../src/contracts/policy.js';
import { ActionRecord } from '../../../src/contracts/actions.js';
import { EvidenceRecord } from '../../../src/contracts/evidence.js';
import { ClaimEvaluation } from '../../../src/contracts/agent-claims.js';
import { ClaimAccepted } from '../../../src/contracts/api-endpoints.js';

describe('source authority (required safety inputs)', () => {
  const strong = {
    schema_version: '1.0',
    fact: 'bank_credit.utr',
    source_system: 'SYNTHETIC_BANK',
    scope: null,
    evidence_ref: 'ev_bank_1',
    authority_class: 'AUTHORITATIVE',
    contract_basis: 'bank_feed_contract',
    contract_version: 'bfc_v1',
  };

  it('accepts an AUTHORITATIVE claim with evidence + contract basis/version', () => {
    expect(SourceAuthorityRecord.parse(strong).authority_class).toBe('AUTHORITATIVE');
  });

  it('rejects an AUTHORITATIVE claim with no evidence, basis, or version', () => {
    const { evidence_ref: _e, contract_basis: _b, contract_version: _v, ...bare } = strong;
    expect(SourceAuthorityRecord.safeParse(bare).success).toBe(false);
    expect(SourceAuthorityRecord.safeParse({ ...strong, evidence_ref: undefined }).success).toBe(
      false,
    );
    expect(SourceAuthorityRecord.safeParse({ ...strong, contract_basis: undefined }).success).toBe(
      false,
    );
  });

  it('an UNTRUSTED_CLAIM still requires evidence_ref', () => {
    const claim = {
      schema_version: '1.0',
      fact: 'agent.recovery',
      source_system: 'SYNTHETIC_AGENT',
      scope: null,
      evidence_ref: 'ev_claim_1',
      authority_class: 'UNTRUSTED_CLAIM',
      contract_basis: null,
      contract_version: null,
    };
    expect(SourceAuthorityRecord.parse(claim).authority_class).toBe('UNTRUSTED_CLAIM');
    const { evidence_ref: _e, ...noEvidence } = claim;
    expect(SourceAuthorityRecord.safeParse(noEvidence).success).toBe(false);
  });

  it('an agent can only be an UNTRUSTED_CLAIM', () => {
    for (const authorityClass of [
      'AUTHORITATIVE',
      'ASSERTED',
      'DERIVED',
      'CANDIDATE',
      'CONTROL_EVIDENCE',
      'ACKNOWLEDGEMENT_ONLY',
    ]) {
      expect(
        SourceAuthorityRecord.safeParse({
          ...strong,
          source_system: 'SYNTHETIC_AGENT',
          authority_class: authorityClass,
        }).success,
        authorityClass,
      ).toBe(false);
    }
  });

  it('MoneyTrace can derive/control facts but cannot originate authoritative financial evidence', () => {
    for (const authorityClass of ['AUTHORITATIVE', 'ASSERTED']) {
      expect(
        SourceAuthorityRecord.safeParse({
          ...strong,
          source_system: 'MONEYTRACE',
          authority_class: authorityClass,
        }).success,
        authorityClass,
      ).toBe(false);
    }

    expect(
      SourceAuthorityRecord.safeParse({
        ...strong,
        source_system: 'MONEYTRACE',
        authority_class: 'DERIVED',
      }).success,
    ).toBe(true);
    expect(
      SourceAuthorityRecord.safeParse({
        ...strong,
        source_system: 'MONEYTRACE',
        authority_class: 'CONTROL_EVIDENCE',
        contract_basis: null,
        contract_version: null,
      }).success,
    ).toBe(true);
  });
});

describe('verification contract (complete safety)', () => {
  const auth = (field: string) => ({
    field,
    source_system: 'SYNTHETIC_BANK',
    authority_class: 'AUTHORITATIVE',
  });
  const contract = {
    schema_version: '1.0',
    contract_key: 'transfer_remediation',
    version: 'vc_v1',
    economic_subject_type: 'seller_allocation',
    terminal_state: 'EFFECT_VERIFIED',
    required_evidence: ['bank_credit'],
    optional_evidence: [],
    blocking_evidence: [],
    required_checks: { amount: true, currency: true, identity: true, time: true },
    required_authorities: {
      amount: [auth('amount')],
      currency: [auth('currency')],
      identity: [auth('recipient')],
      time: [auth('value_date')],
    },
    tolerances: { amount_tolerance_minor: '0', value_date_window_days: 2 },
    observation_window_seconds: 3600,
    amount_equation_id: 'eq_1',
    reconciliation_rule_id: 'rule_1',
    reversal_condition_ids: ['rev_1'],
    escalation_policy_id: 'esc_1',
    expiry_seconds: 86400,
  };

  it('accepts a complete contract with all four checks + per-check authorities', () => {
    expect(VerificationContract.parse(contract).contract_key).toBe('transfer_remediation');
  });

  it('rejects a non-empty subset of checks (only amount / missing any check)', () => {
    expect(
      VerificationContract.safeParse({ ...contract, required_checks: { amount: true } }).success,
    ).toBe(false);
    for (const drop of ['currency', 'identity', 'time']) {
      const checks: Record<string, boolean> = {
        amount: true,
        currency: true,
        identity: true,
        time: true,
      };
      delete checks[drop];
      expect(
        VerificationContract.safeParse({ ...contract, required_checks: checks }).success,
        drop,
      ).toBe(false);
    }
  });

  it('rejects insufficient authority classes and missing per-check authority coverage', () => {
    for (const cls of [
      'ACKNOWLEDGEMENT_ONLY',
      'CANDIDATE',
      'ASSERTED',
      'UNTRUSTED_CLAIM',
      'CONTROL_EVIDENCE',
    ]) {
      const bad = {
        ...contract,
        required_authorities: {
          ...contract.required_authorities,
          amount: [{ ...auth('amount'), authority_class: cls }],
        },
      };
      expect(VerificationContract.safeParse(bad).success, cls).toBe(false);
    }
    // no authority coverage for the "time" check
    expect(
      VerificationContract.safeParse({
        ...contract,
        required_authorities: { ...contract.required_authorities, time: [] },
      }).success,
    ).toBe(false);
  });

  it('rejects authority fields assigned to the wrong verification bucket', () => {
    const invalidFieldsByBucket = {
      amount: ['currency', 'identity', 'time', 'utr', 'value_date', 'recipient'],
      currency: ['amount', 'identity', 'time', 'utr', 'value_date', 'recipient'],
      identity: ['amount', 'currency', 'time', 'value_date'],
      time: ['amount', 'currency', 'identity', 'utr', 'recipient'],
    } as const;

    for (const [bucket, invalidFields] of Object.entries(invalidFieldsByBucket)) {
      for (const field of invalidFields) {
        const requiredAuthorities = {
          ...contract.required_authorities,
          [bucket]: [auth(field)],
        };
        expect(
          VerificationContract.safeParse({
            ...contract,
            required_authorities: requiredAuthorities,
          }).success,
          `${bucket} must reject ${field}`,
        ).toBe(false);
      }
    }
  });

  it('accepts every documented identity/time field in its correct bucket', () => {
    for (const field of ['identity', 'utr', 'recipient']) {
      expect(
        VerificationContract.safeParse({
          ...contract,
          required_authorities: {
            ...contract.required_authorities,
            identity: [auth(field)],
          },
        }).success,
        `identity must accept ${field}`,
      ).toBe(true);
    }

    for (const field of ['time', 'value_date']) {
      expect(
        VerificationContract.safeParse({
          ...contract,
          required_authorities: {
            ...contract.required_authorities,
            time: [auth(field)],
          },
        }).success,
        `time must accept ${field}`,
      ).toBe(true);
    }
  });

  it('never accepts agent output as terminal verification authority', () => {
    for (const authorityClass of ['AUTHORITATIVE', 'DERIVED']) {
      for (const bucket of ['amount', 'currency', 'identity', 'time'] as const) {
        const requiredAuthorities = structuredClone(contract.required_authorities);
        const existing = requiredAuthorities[bucket][0];
        if (!existing) throw new Error(`test fixture missing ${bucket} authority`);
        requiredAuthorities[bucket][0] = {
          ...existing,
          source_system: 'SYNTHETIC_AGENT',
          authority_class: authorityClass,
        };
        expect(
          VerificationContract.safeParse({ ...contract, required_authorities: requiredAuthorities })
            .success,
          `${bucket}/${authorityClass}`,
        ).toBe(false);
      }
    }
  });

  it('permits MoneyTrace only for DERIVED terminal requirements', () => {
    expect(
      VerificationContract.safeParse({
        ...contract,
        required_authorities: {
          ...contract.required_authorities,
          amount: [{ ...auth('amount'), source_system: 'MONEYTRACE' }],
        },
      }).success,
    ).toBe(false);
    expect(
      VerificationContract.safeParse({
        ...contract,
        required_authorities: {
          ...contract.required_authorities,
          amount: [{ ...auth('amount'), source_system: 'MONEYTRACE', authority_class: 'DERIVED' }],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects empty required evidence, empty reversal conditions, and zero windows', () => {
    expect(VerificationContract.safeParse({ ...contract, required_evidence: [] }).success).toBe(
      false,
    );
    expect(
      VerificationContract.safeParse({ ...contract, reversal_condition_ids: [] }).success,
    ).toBe(false);
    expect(
      VerificationContract.safeParse({ ...contract, observation_window_seconds: 0 }).success,
    ).toBe(false);
    expect(VerificationContract.safeParse({ ...contract, expiry_seconds: 0 }).success).toBe(false);
  });

  it('rejects a non-EFFECT_VERIFIED terminal_state', () => {
    expect(
      VerificationContract.safeParse({ ...contract, terminal_state: 'bank_credit_verified' })
        .success,
    ).toBe(false);
  });
});

describe('verification result (status-dependent)', () => {
  const verified = {
    schema_version: '1.0',
    verification_id: 'ver_1',
    action_id: 'act_1',
    contract_version: 'vc_v1',
    status: 'EFFECT_VERIFIED',
    evidence_ids: ['ev_bank_1'],
    verified_amount: { amount_minor: '45500000', currency: 'INR' },
    verified_at: '2026-08-25T09:00:00Z',
  };

  it('accepts a complete EFFECT_VERIFIED result', () => {
    expect(VerificationResult.parse(verified).status).toBe('EFFECT_VERIFIED');
  });

  it('rejects EFFECT_VERIFIED without authoritative evidence, amount, or timestamp', () => {
    expect(VerificationResult.safeParse({ ...verified, evidence_ids: [] }).success).toBe(false);
    const { verified_amount: _a, ...noAmount } = verified;
    expect(VerificationResult.safeParse(noAmount).success).toBe(false);
    const { verified_at: _t, ...noAt } = verified;
    expect(VerificationResult.safeParse(noAt).success).toBe(false);
  });

  it('a pending result cannot carry verified fields', () => {
    expect(
      VerificationResult.safeParse({
        schema_version: '1.0',
        verification_id: 'ver_2',
        action_id: 'act_1',
        contract_version: 'vc_v1',
        status: 'VERIFICATION_PENDING',
        verified_amount: { amount_minor: '1', currency: 'INR' },
      }).success,
    ).toBe(false);
  });
});

describe('money path edges require evidence', () => {
  const edge = (over: Record<string, unknown>) => ({
    schema_version: '1.0',
    case_id: 'case_1',
    nodes: [],
    edges: [
      {
        edge_type: 'TRANSFERRED_TO',
        source_node_key: 'n1',
        target_node_key: 'n2',
        confidence_class: 'candidate',
        observation: 'observed',
        link_id: 'link_1',
        ...over,
      },
    ],
    linear: [],
  });

  it('rejects an edge without evidence_ids', () => {
    expect(MoneyPath.safeParse(edge({})).success).toBe(false);
    expect(MoneyPath.safeParse(edge({ evidence_ids: [] })).success).toBe(false);
  });

  it('rejects an edge without a link_id', () => {
    expect(MoneyPath.safeParse(edge({ evidence_ids: ['ev_1'], link_id: undefined })).success).toBe(
      false,
    );
  });

  it('accepts an edge citing evidence', () => {
    expect(MoneyPath.parse(edge({ evidence_ids: ['ev_1'] })).edges).toHaveLength(1);
  });
});

describe('policy input projection requires every §13 input', () => {
  const full = {
    schema_version: '1.0',
    tenant_id: 'ten_demo',
    environment: 'demo',
    actor_id: 'user_1',
    actor_role: 'finance_approver',
    action_type: 'SIMULATE_TRANSFER_REMEDIATION',
    authority_level: 'L3',
    amount_impact: { amount_minor: '45500000', currency: 'INR' },
    target: 'order:merchant-order-718:seller-42',
    merchant_tier: 'standard',
    customer_impact: 'high',
    evidence_coverage: 'complete',
    contradiction_count: 0,
    case_version: 3,
    outcome_version: 2,
    approval_status: 'REQUESTED',
    policy_bundle_version: 'moneytrace_demo_v1',
    reconciliation_state: null,
  };

  it('accepts a complete projection', () => {
    expect(PolicyInputProjection.parse(full).actor_id).toBe('user_1');
  });

  it('rejects omission of actor_id, merchant_tier, or approval_status', () => {
    for (const key of ['actor_id', 'merchant_tier', 'approval_status']) {
      const copy: Record<string, unknown> = { ...full };
      delete copy[key];
      expect(PolicyInputProjection.safeParse(copy).success, key).toBe(false);
    }
  });

  it('allows explicit null for merchant_tier/approval_status but not omission', () => {
    expect(
      PolicyInputProjection.parse({ ...full, merchant_tier: null, approval_status: null }).actor_id,
    ).toBe('user_1');
  });
});

describe('action record outcome is a strict enum', () => {
  const action = {
    schema_version: '1.0',
    action_id: 'act_1',
    case_id: 'case_1',
    plan_id: 'plan_1',
    tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
    tool_version: 'v1',
    idempotency_key: 'idem_1',
    request_hash: `sha256:${'a'.repeat(64)}`,
    status: 'ACKNOWLEDGED',
    attempt_count: 1,
    external_reference: null,
    submitted_at: '2026-08-25T05:20:00Z',
    acknowledged_at: '2026-08-25T05:20:01Z',
    outcome_status: 'ACKNOWLEDGED',
  };

  it('correlates action status, outcome, timestamps, and attempt count', () => {
    expect(ActionRecord.parse(action).outcome_status).toBe('ACKNOWLEDGED');
    expect(
      ActionRecord.parse({
        ...action,
        status: 'OUTCOME_UNKNOWN',
        outcome_status: 'OUTCOME_UNKNOWN',
      }).outcome_status,
    ).toBe('OUTCOME_UNKNOWN');
    expect(ActionRecord.safeParse({ ...action, outcome_status: 'whatever' }).success).toBe(false);
    expect(ActionRecord.safeParse({ ...action, acknowledged_at: null }).success).toBe(false);
    expect(
      ActionRecord.safeParse({ ...action, status: 'FAILED', outcome_status: 'ACKNOWLEDGED' })
        .success,
    ).toBe(false);
    expect(
      ActionRecord.safeParse({
        ...action,
        status: 'RESERVED',
        attempt_count: 1,
        submitted_at: null,
        acknowledged_at: null,
        outcome_status: null,
      }).success,
    ).toBe(false);
    expect(
      ActionRecord.safeParse({
        ...action,
        status: 'RESERVED',
        attempt_count: 0,
        external_reference: 'must-not-exist-before-dispatch',
        submitted_at: null,
        acknowledged_at: null,
        outcome_status: null,
      }).success,
    ).toBe(false);
  });
});

describe('agent claim evaluation is status-correlated', () => {
  const base = {
    schema_version: '1.0',
    claim_id: 'claim_1',
    evaluation_version: 1,
    created_at: '2026-08-25T05:20:00Z',
  };

  it('requires verified amounts only for verified statuses', () => {
    expect(
      ClaimEvaluation.safeParse({
        ...base,
        status: 'VERIFIED',
        verified_amount: { amount_minor: '10', currency: 'INR' },
      }).success,
    ).toBe(true);
    expect(
      ClaimEvaluation.safeParse({ ...base, status: 'VERIFIED', verified_amount: null }).success,
    ).toBe(false);
    expect(
      ClaimEvaluation.safeParse({
        ...base,
        status: 'PENDING',
        verified_amount: { amount_minor: '10', currency: 'INR' },
      }).success,
    ).toBe(false);
  });

  it('represents REVERSED as exact zero and creation as PENDING only', () => {
    expect(
      ClaimEvaluation.safeParse({
        ...base,
        status: 'REVERSED',
        verified_amount: { amount_minor: '0', currency: 'INR' },
      }).success,
    ).toBe(true);
    expect(
      ClaimEvaluation.safeParse({
        ...base,
        status: 'REVERSED',
        verified_amount: { amount_minor: '1', currency: 'INR' },
      }).success,
    ).toBe(false);
    expect(
      ClaimAccepted.safeParse({ claim_id: 'claim_1', status: 'PENDING', idempotent_replay: false })
        .success,
    ).toBe(true);
    expect(
      ClaimAccepted.safeParse({ claim_id: 'claim_1', status: 'VERIFIED', idempotent_replay: true })
        .success,
    ).toBe(true);
    // idempotent_replay is required (a bare PENDING is no longer valid).
    expect(ClaimAccepted.safeParse({ claim_id: 'claim_1', status: 'PENDING' }).success).toBe(false);
  });
});

describe('evidence record canonical event_type', () => {
  const base = {
    schema_version: '1.0',
    evidence_id: 'ev_1',
    tenant_id: 'ten_demo',
    source_system: 'RAZORPAY_TEST',
    source_record_type: 'payment',
    source_record_id: 'pay_901',
    source_event_id: 'x-razorpay-event-id',
    source_event_type: 'payment.captured',
    event_type: 'PaymentCaptured',
    event_time: '2026-08-25T05:20:00Z',
    ingested_at: '2026-08-25T05:20:02Z',
    payload_hash: `sha256:${'a'.repeat(64)}`,
    raw_payload_ref: 'db:ingest_events/ev_1',
    signature_status: 'verified',
    dedupe_status: 'unique',
    quarantine_status: 'none',
  };

  it('requires the event_type key (nullable value allowed)', () => {
    expect(EvidenceRecord.parse(base).event_type).toBe('PaymentCaptured');
    expect(EvidenceRecord.parse({ ...base, event_type: null }).event_type).toBeNull();
    const { event_type: _e, ...missing } = base;
    expect(EvidenceRecord.safeParse(missing).success).toBe(false);
  });
});
