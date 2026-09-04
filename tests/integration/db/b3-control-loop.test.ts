import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import * as schema from '../../../src/config/db-schema.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { seedPolicyBundle } from '../../../src/modules/policy/policy-bundle.js';
import { seedVerificationContracts } from '../../../src/modules/verification/verification-contracts-seed.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { ensureSellerAllocationExpectation } from '../../../src/modules/expectations/expectation-service.js';
import { evaluateCtrl01MissingTransfer } from '../../../src/modules/invariants/ctrl-01-missing-transfer.js';
import { evaluateCtrl04DuplicateRecovery } from '../../../src/modules/invariants/ctrl-04-duplicate-recovery.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';
import { getCase } from '../../../src/modules/cases/case-service.js';
import { appendCaseNote } from '../../../src/modules/cases/case-operations.js';
import {
  runInvestigation,
  requestInvestigation,
} from '../../../src/modules/investigation/investigation-service.js';
import { getLatestInvestigation } from '../../../src/modules/investigation/investigation-repository.js';
import { evaluateCasePolicy } from '../../../src/modules/policy/policy-service.js';
import { getCurrentPlan } from '../../../src/modules/policy/plan-service.js';
import {
  requestApproval,
  decideApproval,
  ApprovalSelfApprovalError,
  ApprovalStaleError,
  ApprovalStateConflictError,
} from '../../../src/modules/approvals/approval-service.js';
import {
  resolveBasisExpiry,
  rebuildDecisionBasis,
  computeDecisionBasisHash,
} from '../../../src/modules/approvals/decision-basis.js';
import {
  reserveAction,
  ActionBasisStaleError,
  ActionIdempotencyBodyConflictError,
} from '../../../src/modules/actions/action-service.js';
import { dispatchAction } from '../../../src/modules/actions/action-dispatch.js';
import {
  assertReplayTopicAllowed,
  ReplayTopicForbiddenError,
} from '../../../src/worker/outbox-dispatcher.js';
import { buildControlLoopView } from '../../../src/modules/cases/control-loop-service.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';

const GRACE_SECONDS = 3600;
const CAPTURE_TIME = new Date('2026-08-25T05:20:00Z');
const AFTER_GRACE = new Date(CAPTURE_TIME.getTime() + (GRACE_SECONDS + 60) * 1000);
const env = { MODEL_PROVIDER: 'stub' } as const;

function baseEvent(overrides: Partial<CanonicalEvent>): CanonicalEvent {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    tenant_id: 'ten_demo',
    source_system: 'SYNTHETIC_OMS',
    source_account_id: null,
    source_event_id: null,
    source_event_type: 'synthetic.event',
    event_type: 'PaymentCaptured',
    schema_version: '1.0',
    event_time: CAPTURE_TIME.toISOString(),
    ingested_at: CAPTURE_TIME.toISOString(),
    source_entity_version: null,
    entity_references: {},
    economic_subject_hint: 'subj',
    amount_minor: '50000000',
    currency: 'INR',
    correlation_id: null,
    causation_id: null,
    payload_hash: `sha256:${Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64)}`,
    raw_payload_ref: 'db:ingest_events/x',
    metadata: { environment: 'synthetic' },
    data: {},
    ...overrides,
  } as CanonicalEvent;
}

describe('Gate B3 control loop (investigation -> policy -> approval -> action)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ctx = createTenantContext('ten_demo', 'demo');
  const otherCtx = createTenantContext('ten_other', 'demo');

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await seedIdentity(db);
    await seedPolicyBundle(db);
    await seedVerificationContracts(db);
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  async function openMissingTransferCase(subjectKey: string): Promise<string> {
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50000000n,
    });
    const captured = baseEvent({
      event_id: `evt_captured_${subjectKey}`,
      event_type: 'PaymentCaptured',
      economic_subject_hint: subjectKey,
      payload_hash: `sha256:${'1'.repeat(64)}`,
    });
    const paid = baseEvent({
      event_id: `evt_paid_${subjectKey}`,
      event_type: 'OrderPaid',
      economic_subject_hint: subjectKey,
      payload_hash: `sha256:${'2'.repeat(64)}`,
    });
    for (const event of [captured, paid]) {
      const accepted = await ingestAndProject(db, ctx, {
        event,
        rawBytes: JSON.stringify(event),
        signatureStatus: 'verified',
      });
      expect(accepted.outcome).toBe('accepted');
    }
    const result = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: AFTER_GRACE,
    });
    expect(result.violated).toBe(true);
    return result.caseId as string;
  }

  async function openDuplicateRecoveryCase(subjectKey: string): Promise<string> {
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50000000n,
    });
    const captured = baseEvent({
      event_id: `evt_captured_${subjectKey}`,
      event_type: 'PaymentCaptured',
      economic_subject_hint: subjectKey,
      amount_minor: '50000000',
      payload_hash: `sha256:${'3'.repeat(64)}`,
    });
    const recovery = baseEvent({
      event_id: `evt_recovery_${subjectKey}`,
      event_type: 'RecoveryScheduled',
      source_system: 'SYNTHETIC_RECOVERY',
      economic_subject_hint: subjectKey,
      amount_minor: '50000000',
      entity_references: { recovery_id: `rec_${subjectKey}` },
      payload_hash: `sha256:${'4'.repeat(64)}`,
    });
    const refund = baseEvent({
      event_id: `evt_refund_${subjectKey}`,
      event_type: 'RefundCreated',
      source_system: 'RAZORPAY_TEST',
      economic_subject_hint: subjectKey,
      amount_minor: '50000000',
      metadata: { environment: 'test' },
      payload_hash: `sha256:${'5'.repeat(64)}`,
    });
    for (const event of [captured, recovery, refund]) {
      const accepted = await ingestAndProject(db, ctx, {
        event,
        rawBytes: JSON.stringify(event),
        signatureStatus: 'verified',
      });
      expect(accepted.outcome).toBe('accepted');
    }
    const result = await evaluateCtrl04DuplicateRecovery(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      scheduledRecoveryAmountMinor: 50000000n,
      evaluatedAt: CAPTURE_TIME,
    });
    expect(result.violated).toBe(true);
    return result.caseId as string;
  }

  describe('Scenario: missing seller transfer -> investigation -> approval -> execute', () => {
    it('runs the full control loop end to end', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-1:seller-1');

      // 1. Investigation request is durable (outbox row), not synchronous.
      const requested = await requestInvestigation(db, ctx, {
        caseId,
        actorId: 'user_investigator',
      });
      expect(requested.requestId).toMatch(/^investigation_req_/);

      // Simulate the worker picking up the job.
      const investigated = await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      expect(investigated.resultType).toBe('FINDING');

      const investigation = await getLatestInvestigation(db, ctx, caseId);
      expect(investigation?.finding?.finding_code).toBe('MISSING_EXPECTED_TRANSFER');
      expect(investigation?.finding?.exposure.amount_minor).toBe('45500000');

      const afterInvestigation = await getCase(db, ctx, caseId);
      expect(afterInvestigation?.lifecycleState).toBe('recommendation_ready');

      const plan = await getCurrentPlan(db, ctx, caseId);
      expect(plan?.status).toBe('PROPOSED');
      expect(plan?.templateId).toBe('OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL');

      // 2. Policy evaluation requires approval for transfer remediation.
      const policyResult = await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedPlanVersion: plan!.version,
        actorId: 'user_investigator',
      });
      expect(policyResult.record.decision).toBe('REQUIRE_APPROVAL');
      expect(policyResult.plan.status).toBe('APPROVAL_REQUIRED');
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('approval_required');

      // 3. Request approval.
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: policyResult.plan ? (await getCase(db, ctx, caseId))!.version : 0,
        expectedPlanVersion: policyResult.plan.version,
        requesterId: 'user_investigator',
      });
      expect(approval.state).toBe('REQUESTED');

      // 4. Self-approval is forbidden.
      await db.insert(schema.memberships).values({
        id: 'mem_user_investigator_finance_approver_self_test',
        tenantId: 'ten_demo',
        userId: 'user_investigator',
        role: 'finance_approver',
      });
      try {
        await expect(
          decideApproval(db, ctx, {
            caseId,
            approvalId: approval.approval_id,
            decisionBasisHash: approval.decision_basis_hash,
            decision: 'approve',
            approverId: 'user_investigator', // same as requester and currently authorized
          }),
        ).rejects.toThrow(ApprovalSelfApprovalError);
      } finally {
        await db.execute(
          `delete from memberships where id = 'mem_user_investigator_finance_approver_self_test'`,
        );
      }

      // 5. Approve with a distinct approver.
      const approved = await decideApproval(db, ctx, {
        caseId,
        approvalId: approval.approval_id,
        decisionBasisHash: approval.decision_basis_hash,
        decision: 'approve',
        approverId: 'user_approver',
      });
      expect(approved.state).toBe('APPROVED');
      expect((await getCurrentPlan(db, ctx, caseId))?.status).toBe('AUTHORIZED');
      // The case deliberately stays at `approval_required` here — see
      // approval-service.ts's note on why the case_version bump is deferred
      // until reservation, so the decision basis stays stable through execute.
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('approval_required');

      // 6. Execute reserves the action idempotently.
      const authorizedPlan = await getCurrentPlan(db, ctx, caseId);
      const expiresAt = await resolveBasisExpiry(db, ctx, authorizedPlan!.id);
      const rebuilt = await rebuildDecisionBasis(
        db,
        ctx,
        { caseId, planId: authorizedPlan!.id },
        expiresAt,
      );
      const freshHash = computeDecisionBasisHash(rebuilt!);

      const [action1, initialRace] = await Promise.all([
        reserveAction(db, ctx, {
          caseId,
          planId: authorizedPlan!.id,
          decisionBasisHash: freshHash,
          actorId: 'user_operator',
        }),
        reserveAction(db, ctx, {
          caseId,
          planId: authorizedPlan!.id,
          decisionBasisHash: freshHash,
          actorId: 'user_operator',
        }),
      ]);
      expect(action1.status).toBe('RESERVED');
      expect(initialRace.action_id).toBe(action1.action_id);
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('executing');
      const reservationAudits = await db.query.auditEntries.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.artifactId, action1.action_id),
      });
      const dispatchRows = await db.query.outbox.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.domainEventId, action1.action_id),
      });
      expect(reservationAudits).toHaveLength(1);
      expect(dispatchRows).toHaveLength(1);
      const lifecycle = await db.query.caseTransitions.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.caseId, caseId),
        orderBy: (t, { asc: ascOp }) => [ascOp(t.occurredAt)],
      });
      expect(lifecycle.map((row) => row.toState)).toEqual([
        'open',
        'investigating',
        'recommendation_ready',
        'approval_required',
        'approved',
        'executing',
      ]);

      // 7. Concurrent execute (double-submit) is idempotent: same action returned.
      const [a, b] = await Promise.all([
        reserveAction(db, ctx, {
          caseId,
          planId: authorizedPlan!.id,
          decisionBasisHash: freshHash,
          actorId: 'user_operator',
        }),
        reserveAction(db, ctx, {
          caseId,
          planId: authorizedPlan!.id,
          decisionBasisHash: freshHash,
          actorId: 'user_operator',
        }),
      ]);
      expect(a.action_id).toBe(action1.action_id);
      expect(b.action_id).toBe(action1.action_id);

      // 8. A post-adapter crash leaves the stable action DISPATCHING; worker
      // redelivery reuses that same action/effect reference and repairs the
      // durable attempt without creating a second effect.
      await expect(
        dispatchAction(db, ctx, action1.action_id, { failAfterAdapterForTest: true }),
      ).rejects.toThrow('simulated post-adapter crash');
      const interrupted = await db.query.actions.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, action1.action_id),
      });
      expect(interrupted?.status).toBe('DISPATCHING');
      expect(interrupted?.attemptCount).toBe(0);
      await dispatchAction(db, ctx, action1.action_id);
      await dispatchAction(db, ctx, action1.action_id); // redelivery / crash retry

      const rows = await db.query.actions.findMany({
        where: (t, { eq: eqOp, and: andOp }) =>
          andOp(eqOp(t.tenantId, 'ten_demo'), eqOp(t.id, action1.action_id)),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('VERIFICATION_PENDING');
      expect(rows[0]?.outcomeStatus).toBe('ACKNOWLEDGED');
      expect(rows[0]?.externalReference).toBe(`synthetic_route_${action1.action_id}`);
      expect(rows[0]?.attemptCount).toBe(1); // never blindly retried into a 2nd attempt

      const attempts = await db.query.actionAttempts.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.actionId, action1.action_id),
      });
      expect(attempts).toHaveLength(1);

      // 9. Control-loop read model reflects real persisted state.
      const view = await buildControlLoopView(db, ctx, caseId);
      expect(view?.finding?.finding_code).toBe('MISSING_EXPECTED_TRANSFER');
      expect(view?.plan?.status).toBe('AUTHORIZED');
      expect(view?.approval?.state).toBe('APPROVED');
      expect(view?.action?.status).toBe('VERIFICATION_PENDING');
    });

    it('invalidates a REQUESTED approval when the underlying case basis changes (stale field-by-field)', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-2:seller-2');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedPlanVersion: plan!.version,
        actorId: 'user_investigator',
      });
      const caseBefore = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseBefore!.version,
        expectedPlanVersion: (await getCurrentPlan(db, ctx, caseId))!.version,
        requesterId: 'user_investigator',
      });

      // Mutate the case (bumps case_version — one of the hashed basis fields).
      await appendCaseNote(db, ctx, {
        caseId,
        body: 'operator note changing case_version',
        expectedVersion: caseBefore!.version,
        authorId: 'user_operator',
        actorRole: 'platform_operator',
      });

      await expect(
        decideApproval(db, ctx, {
          caseId,
          approvalId: approval.approval_id,
          decisionBasisHash: approval.decision_basis_hash,
          decision: 'approve',
          approverId: 'user_approver',
        }),
      ).rejects.toThrow(ApprovalStaleError);

      const afterRow = await db.query.approvals.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, approval.approval_id),
      });
      expect(afterRow?.state).toBe('INVALIDATED');
    });

    it('exactly one of two concurrent decisions on the same approval wins', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-3:seller-3');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedPlanVersion: plan!.version,
        actorId: 'user_investigator',
      });
      const caseRow = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseRow!.version,
        expectedPlanVersion: (await getCurrentPlan(db, ctx, caseId))!.version,
        requesterId: 'user_investigator',
      });

      const results = await Promise.allSettled([
        decideApproval(db, ctx, {
          caseId,
          approvalId: approval.approval_id,
          decisionBasisHash: approval.decision_basis_hash,
          decision: 'approve',
          approverId: 'user_approver',
        }),
        decideApproval(db, ctx, {
          caseId,
          approvalId: approval.approval_id,
          decisionBasisHash: approval.decision_basis_hash,
          decision: 'reject',
          reason: 'concurrent rejection',
          approverId: 'user_approver',
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ApprovalStateConflictError,
      );
    });

    it('OUTCOME_UNKNOWN is recorded distinctly from FAILED and never blindly retried with a new key', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-4:seller-4');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedPlanVersion: plan!.version,
        actorId: 'user_investigator',
      });
      const caseRow = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseRow!.version,
        expectedPlanVersion: (await getCurrentPlan(db, ctx, caseId))!.version,
        requesterId: 'user_investigator',
      });
      await decideApproval(db, ctx, {
        caseId,
        approvalId: approval.approval_id,
        decisionBasisHash: approval.decision_basis_hash,
        decision: 'approve',
        approverId: 'user_approver',
      });
      const authorizedPlan = await getCurrentPlan(db, ctx, caseId);
      const expiresAt = await resolveBasisExpiry(db, ctx, authorizedPlan!.id);
      const rebuilt = await rebuildDecisionBasis(
        db,
        ctx,
        { caseId, planId: authorizedPlan!.id },
        expiresAt,
      );
      const action = await reserveAction(db, ctx, {
        caseId,
        planId: authorizedPlan!.id,
        decisionBasisHash: computeDecisionBasisHash(rebuilt!),
        actorId: 'user_operator',
      });

      await dispatchAction(db, ctx, action.action_id, { forcedOutcome: 'OUTCOME_UNKNOWN' });
      const row1 = await db.query.actions.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, action.action_id),
      });
      expect(row1?.status).toBe('VERIFICATION_PENDING');
      expect(row1?.outcomeStatus).toBe('OUTCOME_UNKNOWN');

      // Redelivery must not retry as a new attempt/new key — it is a no-op once resolved.
      await dispatchAction(db, ctx, action.action_id);
      const row2 = await db.query.actions.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, action.action_id),
      });
      expect(row2?.attemptCount).toBe(1);
      const attempts = await db.query.actionAttempts.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.actionId, action.action_id),
      });
      expect(attempts).toHaveLength(1);
    });
  });

  describe('Scenario: duplicate recovery -> automatic policy -> execute', () => {
    it('allows automatic execution once the finding is complete and uncontested', async () => {
      const caseId = await openDuplicateRecoveryCase('order:b3-case-5:seller-5');
      const result = await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      expect(result.resultType).toBe('FINDING');
      const plan = await getCurrentPlan(db, ctx, caseId);
      expect(plan?.templateId).toBe('SUPPRESS_DUPLICATE_RECOVERY');

      const policyResult = await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedPlanVersion: plan!.version,
        actorId: 'user_investigator',
      });
      expect(policyResult.record.decision).toBe('ALLOW_AUTOMATIC');
      expect(policyResult.plan.status).toBe('AUTHORIZED');
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('recommendation_ready');

      const authorizedPlan = await getCurrentPlan(db, ctx, caseId);
      const expiresAt = await resolveBasisExpiry(db, ctx, authorizedPlan!.id);
      const rebuilt = await rebuildDecisionBasis(
        db,
        ctx,
        { caseId, planId: authorizedPlan!.id },
        expiresAt,
      );
      const action = await reserveAction(db, ctx, {
        caseId,
        planId: authorizedPlan!.id,
        decisionBasisHash: computeDecisionBasisHash(rebuilt!),
        actorId: 'user_operator',
      });
      expect(action.status).toBe('RESERVED');

      await dispatchAction(db, ctx, action.action_id);
      const row = await db.query.actions.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, action.action_id),
      });
      expect(row?.status).toBe('VERIFICATION_PENDING');
      expect(row?.externalReference).toBe(`synthetic_recovery_${action.action_id}`);
    });

    it('the idempotency key is stable across a re-evaluated (different-hash) authorization -> body conflict is detected', async () => {
      const caseId = await openDuplicateRecoveryCase('order:b3-case-6:seller-6');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedPlanVersion: plan!.version,
        actorId: 'user_investigator',
      });
      const authorizedPlan = await getCurrentPlan(db, ctx, caseId);
      const expiresAt1 = await resolveBasisExpiry(db, ctx, authorizedPlan!.id);
      const rebuilt1 = await rebuildDecisionBasis(
        db,
        ctx,
        { caseId, planId: authorizedPlan!.id },
        expiresAt1,
      );
      const hash1 = computeDecisionBasisHash(rebuilt1!);
      const action1 = await reserveAction(db, ctx, {
        caseId,
        planId: authorizedPlan!.id,
        decisionBasisHash: hash1,
        actorId: 'user_operator',
      });
      expect(action1.status).toBe('RESERVED');

      // Re-evaluate policy again: a NEW policy_decision_id changes the fresh
      // basis hash even though plan content/idempotency key are unchanged.
      const rePlan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: rePlan!.id,
        expectedPlanVersion: rePlan!.version,
        actorId: 'user_investigator',
      });
      const rePlan2 = await getCurrentPlan(db, ctx, caseId);
      const expiresAt2 = await resolveBasisExpiry(db, ctx, rePlan2!.id);
      const rebuilt2 = await rebuildDecisionBasis(
        db,
        ctx,
        { caseId, planId: rePlan2!.id },
        expiresAt2,
      );
      const hash2 = computeDecisionBasisHash(rebuilt2!);
      expect(hash2).not.toBe(hash1);

      await expect(
        reserveAction(db, ctx, {
          caseId,
          planId: rePlan2!.id,
          decisionBasisHash: hash2,
          actorId: 'user_operator',
        }),
      ).rejects.toThrow(ActionIdempotencyBodyConflictError);
    });
  });

  describe('Investigation abstention (conflicting / insufficient evidence)', () => {
    it('conflicting transfer evidence abstains and creates no plan', async () => {
      const subjectKey = 'order:b3-case-7:seller-7';
      const caseId = await openMissingTransferCase(subjectKey);

      const transferA = baseEvent({
        event_id: `evt_transfer_a_${subjectKey}`,
        event_type: 'TransferCreated',
        source_system: 'SYNTHETIC_ROUTE',
        economic_subject_hint: subjectKey,
        amount_minor: '45500000',
        entity_references: { recipient_account_id: 'seller_A' },
        payload_hash: `sha256:${'6'.repeat(64)}`,
      });
      const transferB = baseEvent({
        event_id: `evt_transfer_b_${subjectKey}`,
        event_type: 'TransferCreated',
        source_system: 'SYNTHETIC_ROUTE',
        economic_subject_hint: subjectKey,
        amount_minor: '45500000',
        entity_references: { recipient_account_id: 'seller_B' },
        payload_hash: `sha256:${'7'.repeat(64)}`,
      });
      for (const e of [transferA, transferB]) {
        await ingestAndProject(db, ctx, {
          event: e,
          rawBytes: JSON.stringify(e),
          signatureStatus: 'verified',
        });
      }

      const result = await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      expect(result.resultType).toBe('ABSTENTION');
      expect(await getCurrentPlan(db, ctx, caseId)).toBeNull();
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('abstained');
    });
  });

  describe('Investigation retry repair', () => {
    it('repairs audit, plan, and lifecycle artifacts exactly once after an insert-time crash', async () => {
      const caseId = await openMissingTransferCase('order:b3-repair:seller-12');
      await expect(
        runInvestigation(db, ctx, env, {
          caseId,
          actorId: 'user_investigator',
          failAfterInsertForTest: true,
        }),
      ).rejects.toThrow('simulated post-investigation-insert crash');

      const persisted = await db.query.investigations.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.caseId, caseId),
      });
      expect(persisted).toHaveLength(1);
      expect(await getCurrentPlan(db, ctx, caseId)).toBeNull();
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('open');

      const repaired = await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      expect(repaired.investigationId).toBe(persisted[0]!.id);
      expect(await getCurrentPlan(db, ctx, caseId)).not.toBeNull();
      expect((await getCase(db, ctx, caseId))?.lifecycleState).toBe('recommendation_ready');

      await runInvestigation(db, ctx, env, { caseId, actorId: 'user_investigator' });
      const plans = await db.query.plans.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.caseId, caseId),
      });
      const transitions = await db.query.caseTransitions.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.caseId, caseId),
      });
      const audits = await db.query.auditEntries.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.artifactId, persisted[0]!.id),
      });
      expect(plans).toHaveLength(1);
      expect(transitions.map((row) => row.toState)).toEqual([
        'open',
        'investigating',
        'recommendation_ready',
      ]);
      expect(audits).toHaveLength(1);
    });
  });

  describe('Cross-tenant isolation', () => {
    it('a case in ten_demo is invisible to ten_other for investigation/policy/approval/action', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-8:seller-8');
      await expect(
        runInvestigation(db, otherCtx, env, {
          caseId,
          actorId: 'user_other_viewer',
        }),
      ).rejects.toThrow();

      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      expect(await getCurrentPlan(db, otherCtx, caseId)).toBeNull();

      await expect(
        evaluateCasePolicy(db, otherCtx, {
          caseId,
          planId: plan!.id,
          expectedPlanVersion: plan!.version,
          actorId: 'user_other_viewer',
        }),
      ).rejects.toThrow();
    });

    it('approvals and actions for a ten_demo case are invisible/inoperable from ten_other', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-9:seller-9');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const proposedPlan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: proposedPlan!.id,
        expectedPlanVersion: proposedPlan!.version,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId); // re-fetch: evaluate-policy bumped plan.version

      // ten_other cannot request approval against ten_demo's plan (rebuild fails: not found).
      await expect(
        requestApproval(db, otherCtx, {
          caseId,
          planId: plan!.id,
          expectedCaseVersion: 0,
          expectedPlanVersion: plan!.version,
          requesterId: 'user_other_viewer',
        }),
      ).rejects.toThrow();

      const caseRow = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseRow!.version,
        expectedPlanVersion: plan!.version,
        requesterId: 'user_investigator',
      });

      // ten_other cannot see or decide ten_demo's approval.
      expect(
        await (
          await import('../../../src/modules/approvals/approval-service.js')
        ).getApprovalById(db, otherCtx, approval.approval_id),
      ).toBeNull();
      await expect(
        decideApproval(db, otherCtx, {
          caseId,
          approvalId: approval.approval_id,
          decisionBasisHash: approval.decision_basis_hash,
          decision: 'approve',
          approverId: 'user_other_viewer',
        }),
      ).rejects.toThrow();

      await decideApproval(db, ctx, {
        caseId,
        approvalId: approval.approval_id,
        decisionBasisHash: approval.decision_basis_hash,
        decision: 'approve',
        approverId: 'user_approver',
      });
      const authorizedPlan = await getCurrentPlan(db, ctx, caseId);
      const expiresAt = await resolveBasisExpiry(db, ctx, authorizedPlan!.id);
      const rebuilt = await rebuildDecisionBasis(
        db,
        ctx,
        { caseId, planId: authorizedPlan!.id },
        expiresAt,
      );
      const hash = computeDecisionBasisHash(rebuilt!);

      // ten_other cannot execute against ten_demo's authorized plan.
      await expect(
        reserveAction(db, otherCtx, {
          caseId,
          planId: authorizedPlan!.id,
          decisionBasisHash: hash,
          actorId: 'user_other_viewer',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Approval expiry and role loss', () => {
    it('rejects a basis change that commits after reservation starts but before its case lock', async () => {
      const caseId = await openMissingTransferCase('order:b3-interleaved-basis:seller-12');
      await runInvestigation(db, ctx, env, { caseId, actorId: 'user_investigator' });
      const proposedPlan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: proposedPlan!.id,
        expectedPlanVersion: proposedPlan!.version,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      const caseRow = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseRow!.version,
        expectedPlanVersion: plan!.version,
        requesterId: 'user_investigator',
      });
      await decideApproval(db, ctx, {
        caseId,
        approvalId: approval.approval_id,
        decisionBasisHash: approval.decision_basis_hash,
        decision: 'approve',
        approverId: 'user_approver',
      });
      const expiresAt = await resolveBasisExpiry(db, ctx, plan!.id);
      const basis = await rebuildDecisionBasis(db, ctx, { caseId, planId: plan!.id }, expiresAt);
      const suppliedHash = computeDecisionBasisHash(basis!);
      const dispatchBefore = await db.query.outbox.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.topic, 'dispatch-action.v1'), eqOp(t.tenantId, ctx.tenantId)),
      });

      const blocker = await pool.connect();
      try {
        await blocker.query('begin');
        await blocker.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${ctx.tenantId}|control-loop|${caseId}`,
        ]);
        await blocker.query(
          'update cases set contradiction_count = contradiction_count + 1, version = version + 1 where tenant_id = $1 and id = $2',
          [ctx.tenantId, caseId],
        );

        const reservation = reserveAction(db, ctx, {
          caseId,
          planId: plan!.id,
          decisionBasisHash: suppliedHash,
          actorId: 'user_operator',
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        await blocker.query('commit');

        await expect(reservation).rejects.toBeInstanceOf(ActionBasisStaleError);
      } finally {
        try {
          await blocker.query('rollback');
        } finally {
          blocker.release();
        }
      }

      const actionRows = await db.query.actions.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.caseId, caseId),
      });
      const dispatchRows = await db.query.outbox.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.topic, 'dispatch-action.v1'), eqOp(t.tenantId, ctx.tenantId)),
      });
      expect(actionRows).toHaveLength(0);
      expect(dispatchRows).toHaveLength(dispatchBefore.length);
    });

    it('an expired REQUESTED approval can no longer be decided and lazily transitions to EXPIRED', async () => {
      const caseId = await openMissingTransferCase('order:b3-case-10:seller-10');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const proposedPlan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: proposedPlan!.id,
        expectedPlanVersion: proposedPlan!.version,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId); // re-fetch: evaluate-policy bumped plan.version
      const caseRow = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseRow!.version,
        expectedPlanVersion: plan!.version,
        requesterId: 'user_investigator',
      });

      // Force the stored expiry into the past (simulating TTL elapsing).
      await db.execute(
        `update approvals set expires_at = now() - interval '1 hour' where id = '${approval.approval_id}'`,
      );

      await expect(
        decideApproval(db, ctx, {
          caseId,
          approvalId: approval.approval_id,
          decisionBasisHash: approval.decision_basis_hash,
          decision: 'approve',
          approverId: 'user_approver',
        }),
      ).rejects.toThrow();

      const row = await db.query.approvals.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, approval.approval_id),
      });
      expect(row?.state).toBe('EXPIRED');
    });

    it('denies execution when the approving role is revoked after approval', async () => {
      const caseId = await openMissingTransferCase('order:b3-role-loss:seller-11');
      await runInvestigation(db, ctx, env, {
        caseId,
        actorId: 'user_investigator',
      });
      const proposedPlan = await getCurrentPlan(db, ctx, caseId);
      await evaluateCasePolicy(db, ctx, {
        caseId,
        planId: proposedPlan!.id,
        expectedPlanVersion: proposedPlan!.version,
        actorId: 'user_investigator',
      });
      const plan = await getCurrentPlan(db, ctx, caseId);
      const caseRow = await getCase(db, ctx, caseId);
      const approval = await requestApproval(db, ctx, {
        caseId,
        planId: plan!.id,
        expectedCaseVersion: caseRow!.version,
        expectedPlanVersion: plan!.version,
        requesterId: 'user_investigator',
      });
      await decideApproval(db, ctx, {
        caseId,
        approvalId: approval.approval_id,
        decisionBasisHash: approval.decision_basis_hash,
        decision: 'approve',
        approverId: 'user_approver',
      });
      const expiresAt = await resolveBasisExpiry(db, ctx, plan!.id);
      const basis = await rebuildDecisionBasis(db, ctx, { caseId, planId: plan!.id }, expiresAt);

      await db.execute(
        `delete from memberships where user_id = 'user_approver' and role = 'finance_approver'`,
      );
      try {
        await expect(
          reserveAction(db, ctx, {
            caseId,
            planId: plan!.id,
            decisionBasisHash: computeDecisionBasisHash(basis!),
            actorId: 'user_operator',
          }),
        ).rejects.toThrow();
        const actions = await db.query.actions.findMany({
          where: (t, { eq: eqOp }) => eqOp(t.caseId, caseId),
        });
        expect(actions).toHaveLength(0);
      } finally {
        await db.execute(
          `insert into memberships (id, tenant_id, user_id, role) values ('mem_user_approver_finance_approver', 'ten_demo', 'user_approver', 'finance_approver') on conflict do nothing`,
        );
      }
    });

    it('revoking finance_approver mid-flight is enforced on the very next identity resolution (no caching/trust of a prior role check)', async () => {
      // Roles are resolved FRESH from DB membership rows on every request
      // (modules/identity/identity-repository.ts), never cached — so revoking
      // a role takes effect immediately without any approval-specific code.
      const { resolveIdentity } =
        await import('../../../src/modules/identity/identity-repository.js');
      const before = await resolveIdentity(db, 'user_approver');
      expect(before?.roles).toContain('finance_approver');

      await db.execute(
        `delete from memberships where user_id = 'user_approver' and role = 'finance_approver'`,
      );
      try {
        const after = await resolveIdentity(db, 'user_approver');
        expect(after?.roles).not.toContain('finance_approver');
      } finally {
        // Restore the seeded membership so later tests/scenarios are unaffected.
        await db.execute(
          `insert into memberships (id, tenant_id, user_id, role) values ('mem_user_approver_finance_approver', 'ten_demo', 'user_approver', 'finance_approver') on conflict do nothing`,
        );
      }
    });
  });

  describe('Replay safety', () => {
    it('replay cannot publish dispatch-action.v1', () => {
      expect(() => assertReplayTopicAllowed('dispatch-action.v1', true)).toThrow(
        ReplayTopicForbiddenError,
      );
      expect(() => assertReplayTopicAllowed('run-investigation.v1', true)).not.toThrow();
      expect(() => assertReplayTopicAllowed('dispatch-action.v1', false)).not.toThrow();
    });
  });
});
