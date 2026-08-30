import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';
import { CANONICAL_EVENT_CLASSIFICATIONS } from '../../../src/contracts/events/classification.js';
import { requiredEnvironmentFor } from '../../../src/contracts/events/event-types.js';
import { ModelInvestigationOutput } from '../../../src/contracts/findings.js';
import { buildOpenApiDocument } from '../../../src/contracts/openapi.js';
import { Plan } from '../../../src/contracts/plans.js';
import { ReconciliationResult } from '../../../src/contracts/reconciliation.js';
import { COMPONENTS } from '../../../src/contracts/registry.js';

const component = (name: string) => COMPONENTS.find((c) => c.name === name)?.schema;

const load = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/contracts/${name}`, import.meta.url)),
      'utf8',
    ),
  );
const clone = (b: Record<string, unknown>, o: Record<string, unknown>) => ({
  ...structuredClone(b),
  ...o,
});
const payment = () => load('payment-captured.valid.json');
const bank = () => load('bank-credit-observed.valid.json');

interface SchemaShape {
  allOf?: unknown[];
  anyOf?: unknown[];
  oneOf?: unknown[];
  properties?: Record<string, unknown>;
  required?: string[];
  enum?: unknown[];
  items?: unknown;
  minItems?: number;
  nullable?: boolean;
}

function schema(value: unknown, label: string): SchemaShape {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`expected generated schema object for ${label}`);
  }
  return value as SchemaShape;
}

function schemaList(value: unknown, label: string): SchemaShape[] {
  if (!Array.isArray(value)) throw new Error(`expected generated schema array for ${label}`);
  return value.map((item, index) => schema(item, `${label}[${index}]`));
}

function property(parent: SchemaShape, name: string): SchemaShape {
  return schema(parent.properties?.[name], `property ${name}`);
}

function generatedComponent(
  document: ReturnType<typeof buildOpenApiDocument>,
  name: string,
): SchemaShape {
  return schema(document.components?.schemas?.[name], `component ${name}`);
}

function literalValue(parent: SchemaShape, name: string): unknown {
  return property(parent, name).enum?.[0];
}

function optionalLiteralValue(parent: SchemaShape, name: string): unknown {
  const value = parent.properties?.[name];
  return value === undefined ? undefined : schema(value, `property ${name}`).enum?.[0];
}

describe('runtime schema IS the OpenAPI component (no weaker twin)', () => {
  it('the registered component is the same object as the authoritative runtime schema', () => {
    expect(component('CanonicalEvent')).toBe(CanonicalEvent);
    expect(component('ModelInvestigationOutput')).toBe(ModelInvestigationOutput);
    expect(component('Plan')).toBe(Plan);
    expect(component('ReconciliationResult')).toBe(ReconciliationResult);
  });
});

describe('authoritative runtime invalid corpus', () => {
  const noCurrency = () => {
    const { currency: _c, ...rest } = payment();
    return rest;
  };
  const noAmount = () => {
    const { amount_minor: _a, ...rest } = payment();
    return rest;
  };

  const canonicalCorpus: Array<[string, unknown]> = [
    ['amount without currency', noCurrency()],
    ['currency without amount', noAmount()],
    [
      'RAZORPAY_TEST + BankCreditObserved',
      clone(bank(), { source_system: 'RAZORPAY_TEST', metadata: { environment: 'test' } }),
    ],
    [
      'RAZORPAY_TEST + SyntheticTransferFailed',
      clone(payment(), {
        event_type: 'SyntheticTransferFailed',
        source_system: 'RAZORPAY_TEST',
        metadata: { environment: 'test' },
      }),
    ],
    [
      'synthetic bank + PaymentCaptured',
      clone(payment(), { source_system: 'SYNTHETIC_BANK', metadata: { environment: 'synthetic' } }),
    ],
    ['source/environment mismatch', clone(payment(), { metadata: { environment: 'synthetic' } })],
    ['live environment in schema 1.0', clone(payment(), { metadata: { environment: 'live' } })],
  ];

  it.each(canonicalCorpus)('CanonicalEvent rejects: %s', (_label, payload) => {
    expect(CanonicalEvent.safeParse(payload).success).toBe(false);
  });

  it('ModelInvestigationOutput rejects a conflicting abstention without contradiction evidence', () => {
    const bad = {
      schema_version: '1.0',
      result_type: 'ABSTENTION',
      abstention_reason: 'CONFLICTING_EVIDENCE',
      summary: 'x',
      explanation: 'y',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      missing_evidence_types: [],
      confidence_band: 'low',
      evidence_coverage: 'insufficient',
      recommended_plan_template_id: null,
    };
    expect(ModelInvestigationOutput.safeParse(bad).success).toBe(false);
  });

  it('Plan rejects a mismatched plan-template/tool', () => {
    const bad = {
      schema_version: '1.0',
      plan_id: 'plan_1',
      case_id: 'case_1',
      template_id: 'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL',
      version: 1,
      parameters: { tool_id: 'REQUEST_MORE_EVIDENCE', missing_evidence_types: ['bank_credit'] },
      plan_hash: `sha256:${'a'.repeat(64)}`,
      authority_level: 'L3',
      maximum_amount_impact: { amount_minor: '1', currency: 'INR' },
      status: 'PROPOSED',
    };
    expect(Plan.safeParse(bad).success).toBe(false);
  });

  it('ReconciliationResult rejects an ALLOCATED result without an allocation', () => {
    const bad = {
      schema_version: '1.0',
      reconciliation_id: 'rec_1',
      case_id: 'case_1',
      subject_id: 'subj_1',
      matched_amount: { amount_minor: '1', currency: 'INR' },
      difference: { amount_minor: '0', currency: 'INR' },
      match_type: 'EXACT_ONE_TO_ONE',
      status: 'ALLOCATED',
      allocation: null,
      closed_receivable_id: null,
      evidence_ids: ['ev_1'],
      created_at: '2026-08-25T09:00:00Z',
    };
    expect(ReconciliationResult.safeParse(bad).success).toBe(false);
  });
});

describe('generated OpenAPI retains authoritative structural safety', () => {
  it('derives every canonical event/source/environment variant from the registry', () => {
    const document = buildOpenApiDocument();
    const canonical = generatedComponent(document, 'CanonicalEvent');
    const allOf = schemaList(canonical.allOf, 'CanonicalEvent.allOf');
    expect(allOf).toHaveLength(2);

    const generatedVariants = schemaList(allOf[0]?.anyOf, 'CanonicalEvent source variants');
    const expectedVariants = CANONICAL_EVENT_CLASSIFICATIONS.flatMap((classification) =>
      classification.allowed_source_systems.map((source) =>
        [classification.event_type, source, requiredEnvironmentFor(source)].join('|'),
      ),
    ).sort();
    const actualVariants = generatedVariants
      .map((variant) => {
        const metadata = property(variant, 'metadata');
        return [
          literalValue(variant, 'event_type'),
          literalValue(variant, 'source_system'),
          literalValue(metadata, 'environment'),
        ].join('|');
      })
      .sort();

    expect(actualVariants).toEqual(expectedVariants);

    const moneyBranches = schemaList(allOf[1]?.anyOf, 'CanonicalEvent money presence');
    expect(moneyBranches).toHaveLength(2);
    expect(moneyBranches.map((branch) => [...(branch.required ?? [])].sort())).toContainEqual([
      'amount_minor',
      'currency',
    ]);
    const absentMoney = moneyBranches.find((branch) => (branch.required ?? []).length === 0);
    expect(absentMoney).toBeDefined();
    expect(property(absentMoney!, 'amount_minor').nullable).toBe(true);
    expect(property(absentMoney!, 'currency').nullable).toBe(true);
  });

  it('retains model, plan, and reconciliation variant constraints', () => {
    const document = buildOpenApiDocument();

    const modelVariants = schemaList(
      generatedComponent(document, 'ModelInvestigationOutput').anyOf,
      'ModelInvestigationOutput.anyOf',
    );
    expect(modelVariants).toHaveLength(3);
    const finding = modelVariants.find(
      (variant) => literalValue(variant, 'result_type') === 'FINDING',
    );
    const conflicting = modelVariants.find(
      (variant) => optionalLiteralValue(variant, 'abstention_reason') === 'CONFLICTING_EVIDENCE',
    );
    expect(property(finding!, 'supporting_evidence_ids').minItems).toBe(1);
    expect(property(conflicting!, 'contradicting_evidence_ids').minItems).toBe(1);

    const planVariants = schemaList(generatedComponent(document, 'Plan').oneOf, 'Plan.oneOf');
    expect(planVariants).toHaveLength(2);
    const transferPlan = planVariants.find(
      (variant) =>
        literalValue(variant, 'template_id') === 'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL',
    );
    const suppressPlan = planVariants.find(
      (variant) => literalValue(variant, 'template_id') === 'SUPPRESS_DUPLICATE_RECOVERY',
    );
    expect(literalValue(property(transferPlan!, 'parameters'), 'tool_id')).toBe(
      'SIMULATE_TRANSFER_REMEDIATION',
    );
    expect(literalValue(property(suppressPlan!, 'parameters'), 'tool_id')).toBe(
      'SUPPRESS_SIMULATED_RECOVERY',
    );

    const reconciliationVariants = schemaList(
      generatedComponent(document, 'ReconciliationResult').oneOf,
      'ReconciliationResult.oneOf',
    );
    expect(reconciliationVariants.map((variant) => literalValue(variant, 'status')).sort()).toEqual(
      ['ALLOCATED', 'AMBIGUOUS', 'REVERSED', 'UNRESOLVED'],
    );
    const allocated = reconciliationVariants.find(
      (variant) => literalValue(variant, 'status') === 'ALLOCATED',
    );
    expect(allocated?.required).toContain('allocation');
    expect(property(allocated!, 'evidence_ids').minItems).toBe(1);
  });

  it('publishes field-specific verification authority buckets', () => {
    const document = buildOpenApiDocument();
    const verification = generatedComponent(document, 'VerificationContract');
    const authorities = property(verification, 'required_authorities');
    const expectedFields = {
      amount: ['amount'],
      currency: ['currency'],
      identity: ['identity', 'utr', 'recipient'],
      time: ['time', 'value_date'],
    };

    for (const [bucket, fields] of Object.entries(expectedFields)) {
      const authorityArray = property(authorities, bucket);
      expect(authorityArray.minItems, bucket).toBe(1);
      const authorityItem = schema(authorityArray.items, `${bucket} authority item`);
      const variants = schemaList(authorityItem.oneOf, `${bucket} authority variants`);
      expect(variants).toHaveLength(2);
      for (const variant of variants) {
        expect(property(variant, 'field').enum, bucket).toEqual(fields);
      }

      const authoritative = variants.find(
        (variant) => literalValue(variant, 'authority_class') === 'AUTHORITATIVE',
      );
      const derived = variants.find(
        (variant) => literalValue(variant, 'authority_class') === 'DERIVED',
      );
      expect(authoritative).toBeDefined();
      expect(derived).toBeDefined();
      expect(property(authoritative!, 'source_system').enum).not.toContain('SYNTHETIC_AGENT');
      expect(property(authoritative!, 'source_system').enum).not.toContain('MONEYTRACE');
      expect(property(derived!, 'source_system').enum).not.toContain('SYNTHETIC_AGENT');
      expect(property(derived!, 'source_system').enum).toContain('MONEYTRACE');
    }
  });

  it('publishes source, workflow-state, and tool bindings as structural variants', () => {
    const document = buildOpenApiDocument();

    const sourceAuthorities = schemaList(
      generatedComponent(document, 'SourceAuthorityRecord').oneOf,
      'SourceAuthorityRecord.oneOf',
    );
    const sourceVariant = (authorityClass: string) =>
      sourceAuthorities.find(
        (variant) => literalValue(variant, 'authority_class') === authorityClass,
      );
    expect(property(sourceVariant('AUTHORITATIVE')!, 'source_system').enum).not.toContain(
      'SYNTHETIC_AGENT',
    );
    expect(property(sourceVariant('AUTHORITATIVE')!, 'source_system').enum).not.toContain(
      'MONEYTRACE',
    );
    expect(property(sourceVariant('DERIVED')!, 'source_system').enum).toContain('MONEYTRACE');
    expect(property(sourceVariant('UNTRUSTED_CLAIM')!, 'source_system').enum).toEqual([
      'SYNTHETIC_AGENT',
    ]);

    const toolRequests = schemaList(
      generatedComponent(document, 'RegisteredToolRequest').oneOf,
      'RegisteredToolRequest.oneOf',
    );
    expect(toolRequests.map((variant) => literalValue(variant, 'tool_id')).sort()).toEqual([
      'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
      'REQUEST_MORE_EVIDENCE',
      'SIMULATE_TRANSFER_REMEDIATION',
      'SUPPRESS_SIMULATED_RECOVERY',
    ]);
    for (const request of toolRequests) {
      expect(literalValue(property(request, 'parameters'), 'tool_id')).toBe(
        literalValue(request, 'tool_id'),
      );
    }

    const toolResults = schemaList(
      generatedComponent(document, 'RegisteredToolResult').oneOf,
      'RegisteredToolResult.oneOf',
    );
    const acknowledgedToolResult = toolResults.find(
      (variant) => literalValue(variant, 'status') === 'ACKNOWLEDGED',
    );
    expect(property(acknowledgedToolResult!, 'acknowledged_at').nullable).not.toBe(true);

    const approvalStates = schemaList(
      generatedComponent(document, 'ApprovalRecord').oneOf,
      'ApprovalRecord.oneOf',
    );
    expect(approvalStates.map((variant) => literalValue(variant, 'state')).sort()).toEqual([
      'APPROVED',
      'EXPIRED',
      'INVALIDATED',
      'REJECTED',
      'REQUESTED',
    ]);
    const approved = approvalStates.find(
      (variant) => literalValue(variant, 'state') === 'APPROVED',
    );
    expect(literalValue(approved!, 'decision')).toBe('approve');
    expect(property(approved!, 'approver_id').nullable).not.toBe(true);
    expect(property(approved!, 'decided_at').nullable).not.toBe(true);

    const actionStates = schemaList(
      generatedComponent(document, 'ActionRecord').oneOf,
      'ActionRecord.oneOf',
    );
    expect(actionStates.map((variant) => literalValue(variant, 'status')).sort()).toEqual([
      'ACKNOWLEDGED',
      'AUTHORIZED',
      'DISPATCHING',
      'FAILED',
      'OUTCOME_UNKNOWN',
      'RESERVED',
      'VERIFICATION_PENDING',
    ]);
    const acknowledged = actionStates.find(
      (variant) => literalValue(variant, 'status') === 'ACKNOWLEDGED',
    );
    expect(literalValue(acknowledged!, 'outcome_status')).toBe('ACKNOWLEDGED');
    expect(property(acknowledged!, 'acknowledged_at').nullable).not.toBe(true);

    const evaluations = schemaList(
      generatedComponent(document, 'ClaimEvaluation').oneOf,
      'ClaimEvaluation.oneOf',
    );
    expect(evaluations.map((variant) => literalValue(variant, 'status')).sort()).toEqual([
      'PARTIALLY_VERIFIED',
      'PENDING',
      'REJECTED',
      'REVERSED',
      'UNRESOLVED',
      'VERIFIED',
    ]);
    const pending = evaluations.find((variant) => literalValue(variant, 'status') === 'PENDING');
    const verified = evaluations.find((variant) => literalValue(variant, 'status') === 'VERIFIED');
    expect(property(pending!, 'verified_amount').nullable).toBe(true);
    expect(property(verified!, 'verified_amount').nullable).not.toBe(true);

    expect(literalValue(generatedComponent(document, 'ClaimAccepted'), 'status')).toBe('PENDING');
  });
});
