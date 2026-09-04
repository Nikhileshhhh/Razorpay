import { createHmac } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { approvals, cases, economicSubjects, expectations } from '../../config/db-schema.js';
import { canonicalJsonStringify, contentHash } from '../../config/hashing.js';
import type { Env } from '../../config/env.js';
import { resolveSyntheticHmacSecret } from '../../config/env.js';
import {
  CanonicalEvent,
  type CanonicalEvent as CanonicalEventValue,
} from '../../contracts/events/canonical-event.js';
import type { CanonicalEventType, SourceSystem } from '../../contracts/events/event-types.js';
import type { AgentResultClaim } from '../../contracts/agent-claims.js';
import { ingestAndProject } from '../ingestion/pipeline.js';
import { evaluateAffectedControls } from '../invariants/control-orchestrator.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { runInvestigation } from '../investigation/investigation-service.js';
import { evaluateCasePolicy } from '../policy/policy-service.js';
import { getCurrentPlan } from '../policy/plan-service.js';
import { requestApproval, decideApproval } from '../approvals/approval-service.js';
import { reserveAction } from '../actions/action-service.js';
import { dispatchAction } from '../actions/action-dispatch.js';
import { reconcileExpectation } from '../reconciliation/reconciliation-service.js';
import { observeReceivableClosure } from '../reconciliation/closure-service.js';
import { authenticateConnector } from '../identity/connector-principal.js';
import { acceptAgentClaim, evaluateAgentClaim } from '../claims/claim-service.js';
import { DEMO_FIXED_CLOCK } from './dataset.js';
import { assertRegisteredDemoTenant } from './demo-tenant.js';

const INVESTIGATOR = 'user_investigator';
const APPROVER = 'user_approver';
const OPERATOR = 'user_operator';

const SOURCE_ACCOUNTS: Readonly<Record<SourceSystem, string>> = {
  RAZORPAY_TEST: 'acct_demo_razorpay_test',
  SYNTHETIC_RAZORPAY_FIXTURE: 'acct_demo_razorpay_fixture',
  SYNTHETIC_OMS: 'acct_demo_oms',
  SYNTHETIC_ERP: 'acct_demo_erp',
  SYNTHETIC_BANK: 'acct_demo_bank',
  SYNTHETIC_RECOVERY: 'acct_demo_recovery',
  SYNTHETIC_AGENT: 'acct_demo_agent',
  SYNTHETIC_ROUTE: 'acct_demo_route',
  MONEYTRACE: 'acct_demo_moneytrace',
};

interface EventInput {
  readonly key: string;
  readonly subject: string;
  readonly type: CanonicalEventType;
  readonly source: SourceSystem;
  readonly occurredAt: string;
  readonly amountMinor?: bigint;
  readonly references: Record<string, string>;
  readonly data?: Record<string, unknown>;
  readonly causationId?: string;
}

function scenarioEvent(ctx: TenantContext, input: EventInput): CanonicalEventValue {
  return CanonicalEvent.parse({
    schema_version: '1.0',
    event_id: `scenario_${input.key}`,
    tenant_id: ctx.tenantId,
    source_system: input.source,
    source_account_id: SOURCE_ACCOUNTS[input.source],
    source_event_id: `scenario_${input.key}`,
    source_event_type: input.type,
    event_type: input.type,
    event_time: input.occurredAt,
    ingested_at: DEMO_FIXED_CLOCK.toISOString(),
    source_entity_version: 1,
    entity_references: input.references,
    economic_subject_hint: input.subject,
    amount_minor: input.amountMinor?.toString() ?? null,
    currency: input.amountMinor === undefined ? null : 'INR',
    correlation_id: `scenario_${input.subject.replaceAll(':', '_')}`,
    causation_id: input.causationId ?? null,
    payload_hash: contentHash({ scenario_event: input.key }),
    raw_payload_ref: `db:scenario/${input.key}`,
    metadata: { environment: input.source === 'RAZORPAY_TEST' ? 'test' : 'synthetic' },
    data: input.data ?? {},
  });
}

async function ingestScenarioEvent(
  db: Database,
  ctx: TenantContext,
  input: EventInput,
): Promise<string> {
  const event = scenarioEvent(ctx, input);
  const outcome = await ingestAndProject(db, ctx, {
    event,
    rawBytes: canonicalJsonStringify(event),
    rawRepresentation: 'canonical_row',
    signatureStatus: 'verified',
    sourceIdentity: `${input.source}:${SOURCE_ACCOUNTS[input.source]}`,
  });
  if (outcome.outcome === 'conflict') throw new Error('registered scenario event conflicted');
  if (outcome.outcome === 'accepted') {
    await evaluateAffectedControls(db, ctx, outcome.eventId, DEMO_FIXED_CLOCK);
  }
  return outcome.eventId;
}

async function findCase(db: Database, ctx: TenantContext, subject: string, controlId = 'CTRL-01') {
  const rows = await db
    .select({ caseRow: cases, expectation: expectations })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .innerJoin(
      expectations,
      and(eq(expectations.tenantId, cases.tenantId), eq(expectations.id, cases.expectationId)),
    )
    .where(
      and(
        eq(cases.tenantId, ctx.tenantId),
        eq(cases.controlId, controlId),
        eq(economicSubjects.subjectKey, subject),
      ),
    )
    .orderBy(desc(cases.epoch))
    .limit(1);
  if (!rows[0]) throw new Error('registered scenario case was not created');
  return rows[0];
}

async function seedMissingTransfer(
  db: Database,
  ctx: TenantContext,
  prefix: string,
  subject: string,
): Promise<void> {
  const base = '2026-08-25T00:00:00.000Z';
  await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_order_paid`,
    subject,
    type: 'OrderPaid',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: base,
    amountMinor: 50_000_000n,
    references: { order_id: `${prefix}_order` },
  });
  await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_capture`,
    subject,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: base,
    amountMinor: 50_000_000n,
    references: { order_id: `${prefix}_order`, payment_id: `${prefix}_payment` },
  });
  await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_receivable_open`,
    subject,
    type: 'SellerReceivableOpened',
    source: 'SYNTHETIC_ERP',
    occurredAt: '2026-08-25T00:01:00.000Z',
    amountMinor: 45_500_000n,
    references: {
      receivable_id: `${prefix}_receivable`,
      recipient_account_id: `${prefix}_recipient`,
    },
  });
}

async function investigate(
  db: Database,
  ctx: TenantContext,
  env: Pick<Env, 'MODEL_PROVIDER' | 'MODEL_API_URL' | 'MODEL_API_KEY'>,
  subject: string,
  controlId = 'CTRL-01',
): Promise<void> {
  const found = await findCase(db, ctx, subject, controlId);
  await runInvestigation(db, ctx, env, {
    caseId: found.caseRow.id,
    actorId: INVESTIGATOR,
  });
}

async function evaluatePolicyForScenario(
  db: Database,
  ctx: TenantContext,
  subject: string,
): Promise<void> {
  const found = await findCase(db, ctx, subject);
  const plan = await getCurrentPlan(db, ctx, found.caseRow.id);
  if (!plan) throw new Error('registered scenario plan was not created');
  if (plan.status === 'PROPOSED') {
    await evaluateCasePolicy(db, ctx, {
      caseId: found.caseRow.id,
      planId: plan.id,
      expectedPlanVersion: plan.version,
      actorId: INVESTIGATOR,
    });
  }
}

async function approveScenario(db: Database, ctx: TenantContext, subject: string): Promise<void> {
  const found = await findCase(db, ctx, subject);
  const plan = await getCurrentPlan(db, ctx, found.caseRow.id);
  if (!plan) throw new Error('registered scenario plan was not created');
  const existing = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.tenantId, ctx.tenantId), eq(approvals.planId, plan.id)))
    .orderBy(desc(approvals.requestedAt))
    .limit(1);
  let approval = existing[0]
    ? null
    : await requestApproval(db, ctx, {
        caseId: found.caseRow.id,
        planId: plan.id,
        expectedCaseVersion: found.caseRow.version,
        expectedPlanVersion: plan.version,
        requesterId: INVESTIGATOR,
      });
  if (!existing[0]) {
    const requested = approval!;
    approval = await decideApproval(db, ctx, {
      caseId: found.caseRow.id,
      approvalId: requested.approval_id,
      decisionBasisHash: requested.decision_basis_hash,
      decision: 'approve',
      approverId: APPROVER,
    });
    return;
  }
  if (existing[0].state === 'REQUESTED') {
    await decideApproval(db, ctx, {
      caseId: found.caseRow.id,
      approvalId: existing[0].id,
      decisionBasisHash: existing[0].decisionBasisHash,
      decision: 'approve',
      approverId: APPROVER,
    });
  }
}

async function executeScenarioAction(
  db: Database,
  ctx: TenantContext,
  subject: string,
): Promise<string> {
  const found = await findCase(db, ctx, subject);
  const plan = await getCurrentPlan(db, ctx, found.caseRow.id);
  if (!plan) throw new Error('registered scenario plan was not created');
  const approval = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.tenantId, ctx.tenantId),
        eq(approvals.planId, plan.id),
        eq(approvals.state, 'APPROVED'),
      ),
    )
    .limit(1);
  if (!approval[0]) throw new Error('registered scenario approval was not approved');
  const action = await reserveAction(db, ctx, {
    caseId: found.caseRow.id,
    planId: plan.id,
    decisionBasisHash: approval[0].decisionBasisHash,
    actorId: OPERATOR,
  });
  await dispatchAction(db, ctx, action.action_id);
  return action.action_id;
}

async function finishRemediation(
  db: Database,
  ctx: TenantContext,
  prefix: string,
  subject: string,
): Promise<void> {
  const recipient = `${prefix}_recipient`;
  const utr = `UTR${prefix.replaceAll('_', '').toUpperCase()}455`;
  await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_transfer`,
    subject,
    type: 'TransferProcessed',
    source: 'SYNTHETIC_ROUTE',
    occurredAt: '2026-08-25T05:00:00.000Z',
    amountMinor: 45_500_000n,
    references: { transfer_id: `${prefix}_transfer`, recipient_account_id: recipient },
  });
  await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_settlement`,
    subject,
    type: 'SettlementObserved',
    source: 'SYNTHETIC_ROUTE',
    occurredAt: '2026-08-25T05:05:00.000Z',
    amountMinor: 45_500_000n,
    references: { settlement_id: `${prefix}_settlement`, recipient_account_id: recipient },
    data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
  });
  await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_bank`,
    subject,
    type: 'BankCreditObserved',
    source: 'SYNTHETIC_BANK',
    occurredAt: '2026-08-25T05:10:00.000Z',
    amountMinor: 45_500_000n,
    references: { bank_credit_id: `${prefix}_bank`, recipient_account_id: recipient },
    data: { utr, value_date: '2026-08-25' },
  });
  const found = await findCase(db, ctx, subject);
  const reconciled = await reconcileExpectation(db, ctx, found.expectation.id, DEMO_FIXED_CLOCK);
  if (!reconciled.closeActionId) throw new Error('registered scenario did not allocate uniquely');
  await dispatchAction(db, ctx, reconciled.closeActionId);
  const closureEvidenceId = await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_receivable_close`,
    subject,
    type: 'SellerReceivableClosed',
    source: 'SYNTHETIC_ERP',
    occurredAt: '2026-08-25T05:15:00.000Z',
    amountMinor: 0n,
    references: { receivable_id: `${prefix}_receivable`, recipient_account_id: recipient },
    causationId: reconciled.closeActionId,
  });
  await observeReceivableClosure(db, ctx, closureEvidenceId, DEMO_FIXED_CLOCK);
}

async function claimReversalStep(
  db: Database,
  ctx: TenantContext,
  env: Pick<Env, 'MONEYTRACE_ENV' | 'SYNTHETIC_SOURCE_HMAC_SECRET'>,
  step: number,
): Promise<void> {
  const subject = 'scenario:claim-reversal';
  if (step === 1) {
    await ingestScenarioEvent(db, ctx, {
      key: 'claim_reversal_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 12_000_000n,
      references: { payment_id: 'claim_reversal_payment' },
    });
    return;
  }
  const captureId = await ingestScenarioEvent(db, ctx, {
    key: 'claim_reversal_capture',
    subject,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: '2026-08-25T01:00:00.000Z',
    amountMinor: 12_000_000n,
    references: { payment_id: 'claim_reversal_payment' },
  });
  const claim: AgentResultClaim = {
    schema_version: '1.0',
    external_claim_id: 'demo_claim_reversal',
    external_agent_id: 'demo_agent',
    tenant_id: ctx.tenantId,
    economic_subject: subject,
    claimed_amount: { amount_minor: '12000000', currency: 'INR' },
    result_type: 'RECOVERY',
    attribution_method: 'CORRELATED',
    correlation_id: 'claim_reversal',
    claim_time: '2026-08-25T01:10:00.000Z',
    evidence_time: '2026-08-25T01:00:00.000Z',
    evidence_refs: [{ evidence_id: captureId, evidence_type: 'captured_payment' }],
  };
  const raw = Buffer.from(canonicalJsonStringify(claim), 'utf8');
  const secret = resolveSyntheticHmacSecret(env);
  const principal = await authenticateConnector(db, {
    sourceSystem: 'SYNTHETIC_AGENT',
    externalAccountId: SOURCE_ACCOUNTS.SYNTHETIC_AGENT,
    rawBytes: raw,
    providedSignature: createHmac('sha256', secret).update(raw).digest('hex'),
    secret,
  });
  const accepted = await acceptAgentClaim(db, principal, claim, DEMO_FIXED_CLOCK);
  await evaluateAgentClaim(db, principal.tenantContext, accepted.claimId, DEMO_FIXED_CLOCK);
  if (step === 3) {
    await ingestScenarioEvent(db, ctx, {
      key: 'claim_reversal_refund',
      subject,
      type: 'RefundProcessed',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T02:00:00.000Z',
      amountMinor: 12_000_000n,
      references: { refund_id: 'claim_reversal_refund', payment_id: 'claim_reversal_payment' },
    });
    await evaluateAgentClaim(db, principal.tenantContext, accepted.claimId, DEMO_FIXED_CLOCK);
  }
}

async function conflictStep(
  db: Database,
  ctx: TenantContext,
  env: Pick<Env, 'MODEL_PROVIDER' | 'MODEL_API_URL' | 'MODEL_API_KEY'>,
  step: number,
): Promise<void> {
  const subject = 'scenario:conflicting-bank-evidence';
  if (step === 1) return seedMissingTransfer(db, ctx, 'conflicting_bank', subject);
  if (step === 2) {
    for (const variant of ['a', 'b'] as const) {
      await ingestScenarioEvent(db, ctx, {
        key: `conflicting_bank_${variant}`,
        subject,
        type: 'BankCreditObserved',
        source: 'SYNTHETIC_BANK',
        occurredAt: variant === 'a' ? '2026-08-25T04:00:00.000Z' : '2026-08-27T04:00:00.000Z',
        amountMinor: 45_500_000n,
        references: {
          bank_credit_id: `conflicting_bank_${variant}`,
          recipient_account_id: `recipient_${variant}`,
        },
        data: {
          utr: `UTRCONFLICT${variant.toUpperCase()}`,
          value_date: variant === 'a' ? '2026-08-25' : '2026-08-27',
        },
      });
    }
    return;
  }
  await investigate(db, ctx, env, subject, 'CTRL-05');
}

export async function runDemoScenarioStep(
  db: Database,
  ctx: TenantContext,
  env: Pick<
    Env,
    | 'MONEYTRACE_ENV'
    | 'SYNTHETIC_SOURCE_HMAC_SECRET'
    | 'MODEL_PROVIDER'
    | 'MODEL_API_URL'
    | 'MODEL_API_KEY'
  >,
  scenarioId: string,
  step: number,
): Promise<void> {
  assertRegisteredDemoTenant(ctx);
  if (scenarioId === 'claim-reversal') return claimReversalStep(db, ctx, env, step);
  if (scenarioId === 'conflicting-bank-evidence') return conflictStep(db, ctx, env, step);
  const duplicate = scenarioId === 'duplicate-replay';
  if (scenarioId !== 'missing-transfer-remediation' && !duplicate)
    throw new Error('unregistered scenario');
  const prefix = duplicate ? 'duplicate_replay' : 'missing_transfer';
  const subject = `scenario:${scenarioId}`;
  if (step === 1) {
    await seedMissingTransfer(db, ctx, prefix, subject);
    if (duplicate) await seedMissingTransfer(db, ctx, prefix, subject);
    return;
  }
  if (step === 2) {
    await investigate(db, ctx, env, subject);
    if (duplicate) {
      await evaluatePolicyForScenario(db, ctx, subject);
      await approveScenario(db, ctx, subject);
    }
    return;
  }
  if (!duplicate && step === 3) return evaluatePolicyForScenario(db, ctx, subject);
  if (!duplicate && step === 4) return approveScenario(db, ctx, subject);
  if ((duplicate && step === 3) || (!duplicate && step === 5)) {
    await executeScenarioAction(db, ctx, subject);
    if (duplicate) await executeScenarioAction(db, ctx, subject);
    return;
  }
  await finishRemediation(db, ctx, prefix, subject);
  if (duplicate) {
    await finishRemediation(db, ctx, prefix, subject);
    return;
  }
  await emitMissingTransferClaim(db, ctx, env, prefix, subject);
}

/**
 * Missing-transfer-remediation only (never duplicate-replay): the agent
 * reports a recovery for the same subject the deterministic pipeline just
 * independently verified via `finishRemediation`. The claim is accepted and
 * evaluated through the real claim-service pipeline — `evaluateAgentClaim`
 * computes its actual status from persisted captures/refunds/baseline
 * (backend PRD §13.3); this function never assigns a status itself, so the
 * claimed amount can legitimately diverge from what gets verified.
 */
async function emitMissingTransferClaim(
  db: Database,
  ctx: TenantContext,
  env: Pick<Env, 'MONEYTRACE_ENV' | 'SYNTHETIC_SOURCE_HMAC_SECRET'>,
  prefix: string,
  subject: string,
): Promise<void> {
  const captureId = await ingestScenarioEvent(db, ctx, {
    key: `${prefix}_capture`,
    subject,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: '2026-08-25T00:00:00.000Z',
    amountMinor: 50_000_000n,
    references: { order_id: `${prefix}_order`, payment_id: `${prefix}_payment` },
  });
  const claim: AgentResultClaim = {
    schema_version: '1.0',
    external_claim_id: 'demo_missing_transfer_remediation',
    external_agent_id: 'demo_agent',
    tenant_id: ctx.tenantId,
    economic_subject: subject,
    claimed_amount: { amount_minor: '45500000', currency: 'INR' },
    result_type: 'RECOVERY',
    attribution_method: 'CORRELATED',
    correlation_id: 'missing_transfer_remediation',
    claim_time: '2026-08-25T05:15:00.000Z',
    evidence_time: '2026-08-25T00:00:00.000Z',
    evidence_refs: [{ evidence_id: captureId, evidence_type: 'captured_payment' }],
  };
  const raw = Buffer.from(canonicalJsonStringify(claim), 'utf8');
  const secret = resolveSyntheticHmacSecret(env);
  const principal = await authenticateConnector(db, {
    sourceSystem: 'SYNTHETIC_AGENT',
    externalAccountId: SOURCE_ACCOUNTS.SYNTHETIC_AGENT,
    rawBytes: raw,
    providedSignature: createHmac('sha256', secret).update(raw).digest('hex'),
    secret,
  });
  const accepted = await acceptAgentClaim(db, principal, claim, DEMO_FIXED_CLOCK);
  await evaluateAgentClaim(db, principal.tenantContext, accepted.claimId, DEMO_FIXED_CLOCK);
}
