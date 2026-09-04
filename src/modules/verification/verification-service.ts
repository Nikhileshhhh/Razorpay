import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction, DbExecutor } from '../../config/db.js';
import {
  actions,
  cases,
  economicSubjects,
  financialOutcomes,
  ingestEvents,
  outbox,
  receivableClosures,
  reconciliationAllocations,
  reconciliationReversals,
  verificationContracts,
  verificationRunHeads,
  verificationRuns,
} from '../../config/db-schema.js';
import { CanonicalEvent } from '../../contracts/events/canonical-event.js';
import type { SourceSystem } from '../../contracts/events/event-types.js';
import type { EvidenceType } from '../../contracts/evidence.js';
import { VerificationContract, type VerificationResult } from '../../contracts/verification.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { VERIFICATION_CONTRACT_BY_TOOL } from '../approvals/decision-basis.js';
import { transitionCaseInTransaction } from '../cases/case-service.js';
import { appendAuditEntry } from '../audit/audit-writer.js';
import { MONEYTRACE_WORKER_ACTOR } from '../identity/worker-actor.js';
import { evaluateContractAuthority, type AuthorityFact } from './authority-evaluator.js';
import {
  assertFinancialOutcomeTransition,
  type FinancialOutcomeState,
} from '../../domain/state-machines/financial-outcome.js';

export class VerificationNotFoundError extends Error {
  constructor() {
    super('action or verification was not found');
    this.name = 'VerificationNotFoundError';
  }
}

export class VerificationVersionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`verification version conflict: expected ${expected}, actual ${actual}`);
    this.name = 'VerificationVersionConflictError';
  }
}

type VerificationRow = typeof verificationRuns.$inferSelect;

export function toVerificationResult(row: VerificationRow): VerificationResult {
  const base = {
    schema_version: '1.0' as const,
    verification_id: row.id,
    action_id: row.actionId,
    contract_version: row.contractVersion,
  };
  switch (row.status) {
    case 'VERIFICATION_PENDING':
      return { ...base, status: 'VERIFICATION_PENDING' };
    case 'EFFECT_VERIFIED':
      return {
        ...base,
        status: 'EFFECT_VERIFIED',
        evidence_ids: row.evidenceIds as string[],
        verified_amount: {
          amount_minor: (row.verifiedAmountMinor ?? 0n).toString(),
          currency: row.currency as 'INR',
        },
        verified_at: row.verifiedAt!.toISOString(),
      };
    case 'EFFECT_FAILED':
      return {
        ...base,
        status: 'EFFECT_FAILED',
        failure_reason: row.failureReason!,
        failed_at: row.verifiedAt!.toISOString(),
      };
    case 'TIMED_OUT':
      return { ...base, status: 'TIMED_OUT', timed_out_at: row.verifiedAt!.toISOString() };
    case 'EFFECT_REVERSED':
      return {
        ...base,
        status: 'EFFECT_REVERSED',
        evidence_ids: row.evidenceIds as string[],
        reversed_at: row.verifiedAt!.toISOString(),
      };
    default:
      throw new Error('unknown verification status');
  }
}

async function loadContract(db: DbExecutor, toolId: keyof typeof VERIFICATION_CONTRACT_BY_TOOL) {
  const binding = VERIFICATION_CONTRACT_BY_TOOL[toolId];
  const rows = await db
    .select({ definition: verificationContracts.definition })
    .from(verificationContracts)
    .where(
      and(
        eq(verificationContracts.contractKey, binding.key),
        eq(verificationContracts.version, binding.version),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new VerificationNotFoundError();
  return VerificationContract.parse(rows[0].definition);
}

/** Create the first pending history/head and its worker job exactly once. */
export async function ensurePendingVerificationInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  actionId: string,
  now = new Date(),
): Promise<VerificationResult | null> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|verification|${actionId}`}, 0))`,
  );
  await tx.execute(
    sql`select id from actions where tenant_id = ${ctx.tenantId} and id = ${actionId} for update`,
  );
  const actionRows = await tx
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.id, actionId)))
    .limit(1);
  const action = actionRows[0];
  if (!action) throw new VerificationNotFoundError();
  if (action.toolId === 'REQUEST_MORE_EVIDENCE') return null;
  const existingHeads = await tx
    .select()
    .from(verificationRunHeads)
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(verificationRunHeads.actionId, actionId),
      ),
    )
    .limit(1);
  if (existingHeads[0]) {
    const rows = await tx
      .select()
      .from(verificationRuns)
      .where(
        and(
          eq(verificationRuns.tenantId, ctx.tenantId),
          eq(verificationRuns.id, existingHeads[0].currentRunId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new VerificationNotFoundError();
    return toVerificationResult(rows[0]);
  }
  const contract = await loadContract(
    tx,
    action.toolId as keyof typeof VERIFICATION_CONTRACT_BY_TOOL,
  );
  const runId = `verification_${randomUUID()}`;
  await tx.insert(verificationRuns).values({
    id: runId,
    tenantId: ctx.tenantId,
    actionId,
    contractKey: contract.contract_key,
    contractVersion: contract.version,
    status: 'VERIFICATION_PENDING',
    evidenceIds: [],
    version: 0,
    createdAt: now,
  });
  await tx.insert(verificationRunHeads).values({
    tenantId: ctx.tenantId,
    actionId,
    currentRunId: runId,
    contractKey: contract.contract_key,
    contractVersion: contract.version,
    status: 'VERIFICATION_PENDING',
    version: 0,
    updatedAt: now,
  });
  await tx
    .insert(outbox)
    .values({
      id: `outbox_verification_${actionId}`,
      tenantId: ctx.tenantId,
      topic: 'check-verification.v1',
      domainEventId: actionId,
      payload: { tenant_id: ctx.tenantId, action_id: actionId },
      status: 'pending',
    })
    .onConflictDoNothing();
  const caseRows = await tx
    .select({ lifecycleState: cases.lifecycleState, version: cases.version })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, action.caseId)))
    .limit(1);
  if (caseRows[0]?.lifecycleState === 'executing') {
    await transitionCaseInTransaction(tx, ctx, {
      caseId: action.caseId,
      toState: 'verification_pending',
      reason: 'action_acknowledged_verification_required',
      expectedVersion: caseRows[0].version,
      actorId: null,
      actorRole: MONEYTRACE_WORKER_ACTOR.role,
    });
  }
  await appendAuditEntry(tx, ctx, {
    artifactType: 'VERIFICATION',
    artifactId: runId,
    actorId: null,
    actorRole: MONEYTRACE_WORKER_ACTOR.role,
    deterministicId: `audit_verification_${runId}`,
    details: {
      operation: 'verification_evaluated',
      case_id: action.caseId,
      action_id: actionId,
      status: 'VERIFICATION_PENDING',
      version: 0,
    },
  });
  const rows = await tx
    .select()
    .from(verificationRuns)
    .where(and(eq(verificationRuns.tenantId, ctx.tenantId), eq(verificationRuns.id, runId)))
    .limit(1);
  return toVerificationResult(rows[0]!);
}

export async function ensurePendingVerification(
  db: Database,
  ctx: TenantContext,
  actionId: string,
  now = new Date(),
): Promise<VerificationResult | null> {
  return db.transaction((tx) => ensurePendingVerificationInTransaction(tx, ctx, actionId, now));
}

interface EvaluationFacts {
  readonly status: 'VERIFICATION_PENDING' | 'EFFECT_VERIFIED' | 'EFFECT_REVERSED';
  readonly evidenceIds: readonly string[];
  readonly verifiedAmountMinor: bigint | null;
  readonly blockers: readonly string[];
}

async function collectEvaluationFacts(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  action: typeof actions.$inferSelect,
  contract: VerificationContract,
): Promise<EvaluationFacts> {
  const caseRows = await tx
    .select({ subjectKey: economicSubjects.subjectKey })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, action.caseId)))
    .limit(1);
  if (!caseRows[0]) throw new VerificationNotFoundError();
  const allocations = await tx
    .select()
    .from(reconciliationAllocations)
    .where(
      and(
        eq(reconciliationAllocations.tenantId, ctx.tenantId),
        eq(reconciliationAllocations.caseId, action.caseId),
      ),
    )
    .limit(2);
  const allocation = allocations.length === 1 ? allocations[0]! : null;
  const closures = allocation
    ? await tx
        .select()
        .from(receivableClosures)
        .where(
          and(
            eq(receivableClosures.tenantId, ctx.tenantId),
            eq(receivableClosures.allocationId, allocation.id),
          ),
        )
        .limit(1)
    : [];
  const reversals = allocation
    ? await tx
        .select()
        .from(reconciliationReversals)
        .where(
          and(
            eq(reconciliationReversals.tenantId, ctx.tenantId),
            eq(reconciliationReversals.allocationId, allocation.id),
          ),
        )
        .limit(1)
    : [];
  if (reversals[0]) {
    return {
      status: 'EFFECT_REVERSED',
      evidenceIds: [reversals[0].reversalEvidenceId],
      verifiedAmountMinor: null,
      blockers: [],
    };
  }
  const explicitIds = [allocation?.bankLineEvidenceId, closures[0]?.closureEvidenceId].filter(
    (id): id is string => Boolean(id),
  );
  const evidenceWhere =
    explicitIds.length > 0
      ? or(
          eq(ingestEvents.economicSubjectHint, caseRows[0].subjectKey),
          inArray(ingestEvents.id, explicitIds),
        )
      : eq(ingestEvents.economicSubjectHint, caseRows[0].subjectKey);
  const rows = await tx
    .select()
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.quarantineStatus, 'none'),
        eq(ingestEvents.signatureStatus, 'verified'),
        evidenceWhere,
      ),
    );
  const parsed: Array<{
    row: (typeof rows)[number];
    event: ReturnType<typeof CanonicalEvent.parse>;
  }> = [];
  for (const row of rows) {
    const event = CanonicalEvent.safeParse(row.rawPayload);
    if (event.success) parsed.push({ row, event: event.data });
  }
  const present = new Set<EvidenceType>();
  const evidenceIds = new Set<string>();
  const facts: AuthorityFact[] = [];
  const add = (
    row: (typeof parsed)[number]['row'],
    evidenceType: EvidenceType,
    source: SourceSystem,
    fields: AuthorityFact['field'][],
  ) => {
    present.add(evidenceType);
    evidenceIds.add(row.id);
    for (const field of fields)
      facts.push({ field, sourceSystem: source, authorityClass: 'AUTHORITATIVE' });
  };

  if (action.toolId === 'SIMULATE_TRANSFER_REMEDIATION' && allocation && closures[0]) {
    const bank = parsed.find(
      ({ row, event }) =>
        row.id === allocation.bankLineEvidenceId &&
        event.event_type === 'BankCreditObserved' &&
        row.amountMinor === allocation.amountMinor &&
        row.currency === allocation.currency,
    );
    const bankRecipient = bank?.event.entity_references.recipient_account_id ?? null;
    const bankData = (bank?.event.data ?? {}) as Record<string, unknown>;
    const bankUtr = typeof bankData.utr === 'string' ? bankData.utr : null;
    const bankDate = typeof bankData.value_date === 'string' ? bankData.value_date : null;
    const settlement = parsed.find(({ event, row }) => {
      const data = event.data as Record<string, unknown>;
      if (event.event_type !== 'SettlementObserved' || data.settlement_scope !== 'RECIPIENT') {
        return false;
      }
      return (
        row.amountMinor === allocation.amountMinor &&
        row.currency === allocation.currency &&
        event.entity_references.recipient_account_id === bankRecipient &&
        data.utr === bankUtr &&
        data.value_date === bankDate
      );
    });
    const transfer = parsed.find(
      ({ event, row }) =>
        ['TransferCreated', 'TransferProcessed'].includes(event.event_type) &&
        row.amountMinor === allocation.amountMinor &&
        row.currency === allocation.currency &&
        event.entity_references.recipient_account_id === bankRecipient,
    );
    const opened = parsed.find(({ event }) => event.event_type === 'SellerReceivableOpened');
    const closed = parsed.find(
      ({ row, event }) =>
        row.id === closures[0]!.closureEvidenceId && event.event_type === 'SellerReceivableClosed',
    );
    if (transfer)
      add(transfer.row, 'authoritative_transfer_record', transfer.event.source_system, []);
    if (settlement) add(settlement.row, 'recipient_settlement', settlement.event.source_system, []);
    if (opened) add(opened.row, 'seller_receivable', opened.event.source_system, []);
    if (closed) add(closed.row, 'seller_receivable_closed', closed.event.source_system, []);
    if (bank && settlement && transfer && bankRecipient && bankUtr && bankDate) {
      add(bank.row, 'bank_credit', bank.event.source_system, [
        'amount',
        'currency',
        'recipient',
        'value_date',
      ]);
    }
  } else if (
    action.toolId === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION' &&
    allocation &&
    closures[0]
  ) {
    const closed = parsed.find(
      ({ row, event }) =>
        row.id === closures[0]!.closureEvidenceId &&
        closures[0]!.closeActionId === action.id &&
        event.event_type === 'SellerReceivableClosed' &&
        row.amountMinor === 0n &&
        row.currency === 'INR',
    );
    if (closed) {
      add(closed.row, 'seller_receivable_closed', closed.event.source_system, [
        'amount',
        'currency',
        'identity',
        'time',
      ]);
    }
  }
  let suppressedRecoveryAmountMinor: bigint | null = null;
  if (action.toolId === 'SUPPRESS_SIMULATED_RECOVERY') {
    const suppressed = parsed.find(({ event }) => event.event_type === 'RecoverySuppressed');
    if (suppressed) {
      add(suppressed.row, 'recovery_action', suppressed.event.source_system, [
        'amount',
        'currency',
        'identity',
        'time',
      ]);
      suppressedRecoveryAmountMinor = suppressed.row.amountMinor;
    }
  }
  const blockers = new Set<string>();
  if (parsed.some(({ event }) => ['RefundCreated', 'RefundProcessed'].includes(event.event_type))) {
    blockers.add('refund_pending');
  }
  const decision = evaluateContractAuthority({
    contract,
    presentEvidenceTypes: present,
    presentBlockers: blockers,
    facts,
  });
  return {
    status: decision.status,
    evidenceIds: [...evidenceIds].sort(),
    verifiedAmountMinor:
      decision.status === 'EFFECT_VERIFIED'
        ? action.toolId === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'
          ? 0n
          : action.toolId === 'SIMULATE_TRANSFER_REMEDIATION'
            ? (allocation?.amountMinor ?? null)
            : action.toolId === 'SUPPRESS_SIMULATED_RECOVERY'
              ? suppressedRecoveryAmountMinor
              : null
        : null,
    blockers: decision.status === 'VERIFICATION_PENDING' ? decision.blockers : [],
  };
}

/** Append a new immutable evaluation version and atomically move the head. */
export async function evaluateActionVerificationInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  actionId: string,
  expectedVersion?: number,
  now = new Date(),
): Promise<{ result: VerificationResult; blockers: readonly string[] }> {
  await ensurePendingVerificationInTransaction(tx, ctx, actionId, now);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|verification|${actionId}`}, 0))`,
  );
  const heads = await tx
    .select()
    .from(verificationRunHeads)
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(verificationRunHeads.actionId, actionId),
      ),
    )
    .limit(1);
  const head = heads[0];
  if (!head) throw new VerificationNotFoundError();
  if (expectedVersion !== undefined && expectedVersion !== head.version) {
    throw new VerificationVersionConflictError(expectedVersion, head.version);
  }
  const actionRows = await tx
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.id, actionId)))
    .limit(1);
  const action = actionRows[0];
  if (!action) throw new VerificationNotFoundError();
  const contract = await loadContract(
    tx,
    action.toolId as keyof typeof VERIFICATION_CONTRACT_BY_TOOL,
  );
  const facts = await collectEvaluationFacts(tx, ctx, action, contract);
  const nextVersion = head.version + 1;
  const runId = `verification_${randomUUID()}`;
  await tx.insert(verificationRuns).values({
    id: runId,
    tenantId: ctx.tenantId,
    actionId,
    contractKey: contract.contract_key,
    contractVersion: contract.version,
    status: facts.status,
    evidenceIds: facts.evidenceIds,
    verifiedAmountMinor: facts.verifiedAmountMinor,
    currency: facts.status === 'EFFECT_VERIFIED' ? 'INR' : null,
    verifiedAt: facts.status === 'VERIFICATION_PENDING' ? null : now,
    version: nextVersion,
    createdAt: now,
  });
  const updated = await tx
    .update(verificationRunHeads)
    .set({
      currentRunId: runId,
      status: facts.status,
      version: nextVersion,
      updatedAt: now,
    })
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(verificationRunHeads.actionId, actionId),
        eq(verificationRunHeads.version, head.version),
      ),
    )
    .returning({ actionId: verificationRunHeads.actionId });
  if (updated.length !== 1) throw new VerificationVersionConflictError(head.version, nextVersion);
  await appendAuditEntry(tx, ctx, {
    artifactType: 'VERIFICATION',
    artifactId: runId,
    actorId: null,
    actorRole: MONEYTRACE_WORKER_ACTOR.role,
    deterministicId: `audit_verification_${runId}`,
    details: {
      operation: 'verification_evaluated',
      case_id: action.caseId,
      action_id: actionId,
      status: facts.status,
      version: nextVersion,
    },
  });
  if (facts.status === 'EFFECT_VERIFIED') {
    const effectActions = await tx
      .select({ id: actions.id, toolId: actions.toolId })
      .from(actions)
      .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.caseId, action.caseId)));
    const effectActionIds = effectActions
      .filter((candidate) => candidate.toolId !== 'REQUEST_MORE_EVIDENCE')
      .map((candidate) => candidate.id);
    const currentHeads =
      effectActionIds.length > 0
        ? await tx
            .select({
              actionId: verificationRunHeads.actionId,
              status: verificationRunHeads.status,
            })
            .from(verificationRunHeads)
            .where(
              and(
                eq(verificationRunHeads.tenantId, ctx.tenantId),
                inArray(verificationRunHeads.actionId, effectActionIds),
              ),
            )
        : [];
    const statusByAction = new Map(
      currentHeads.map((candidate) => [candidate.actionId, candidate.status]),
    );
    const allEffectsVerified = effectActionIds.every(
      (candidateId) => statusByAction.get(candidateId) === 'EFFECT_VERIFIED',
    );
    const caseRows = await tx
      .select({ lifecycleState: cases.lifecycleState, version: cases.version })
      .from(cases)
      .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, action.caseId)))
      .limit(1);
    if (allEffectsVerified && caseRows[0]?.lifecycleState === 'verification_pending') {
      const caseExpectation = await tx
        .select({ expectationId: cases.expectationId })
        .from(cases)
        .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, action.caseId)))
        .limit(1);
      const currentOutcomes = await tx
        .select()
        .from(financialOutcomes)
        .where(
          and(
            eq(financialOutcomes.tenantId, ctx.tenantId),
            eq(financialOutcomes.expectationId, caseExpectation[0]!.expectationId),
            eq(financialOutcomes.isCurrent, true),
          ),
        )
        .limit(1);
      const currentOutcome = currentOutcomes[0];
      if (currentOutcome && currentOutcome.status !== 'VERIFIED') {
        const verifiedAllocations = await tx
          .select({ amountMinor: reconciliationAllocations.amountMinor })
          .from(reconciliationAllocations)
          .where(
            and(
              eq(reconciliationAllocations.tenantId, ctx.tenantId),
              eq(reconciliationAllocations.caseId, action.caseId),
            ),
          )
          .limit(1);
        assertFinancialOutcomeTransition(
          currentOutcome.status as FinancialOutcomeState,
          'VERIFIED',
        );
        await tx
          .update(financialOutcomes)
          .set({ isCurrent: false })
          .where(
            and(
              eq(financialOutcomes.tenantId, ctx.tenantId),
              eq(financialOutcomes.id, currentOutcome.id),
            ),
          );
        await tx.insert(financialOutcomes).values({
          id: `outcome_${randomUUID()}`,
          tenantId: ctx.tenantId,
          expectationId: currentOutcome.expectationId,
          status: 'VERIFIED',
          version: currentOutcome.version + 1,
          observedAmountMinor: verifiedAllocations[0]?.amountMinor ?? facts.verifiedAmountMinor,
          currency: 'INR',
          isCurrent: true,
          createdAt: now,
        });
      }
      await transitionCaseInTransaction(tx, ctx, {
        caseId: action.caseId,
        toState: 'reconciled',
        reason: 'effect_verified',
        expectedVersion: caseRows[0].version,
        actorId: null,
        actorRole: MONEYTRACE_WORKER_ACTOR.role,
        evidenceIds: facts.evidenceIds,
      });
    }
  }
  const rows = await tx
    .select()
    .from(verificationRuns)
    .where(and(eq(verificationRuns.tenantId, ctx.tenantId), eq(verificationRuns.id, runId)))
    .limit(1);
  return { result: toVerificationResult(rows[0]!), blockers: facts.blockers };
}

export async function evaluateActionVerification(
  db: Database,
  ctx: TenantContext,
  actionId: string,
  expectedVersion?: number,
  now = new Date(),
) {
  return db.transaction((tx) =>
    evaluateActionVerificationInTransaction(tx, ctx, actionId, expectedVersion, now),
  );
}

export async function getCurrentVerification(
  db: DbExecutor,
  ctx: TenantContext,
  actionId: string,
): Promise<VerificationResult | null> {
  const rows = await db
    .select({ run: verificationRuns })
    .from(verificationRunHeads)
    .innerJoin(
      verificationRuns,
      and(
        eq(verificationRuns.tenantId, verificationRunHeads.tenantId),
        eq(verificationRuns.id, verificationRunHeads.currentRunId),
      ),
    )
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(verificationRunHeads.actionId, actionId),
      ),
    )
    .limit(1);
  return rows[0] ? toVerificationResult(rows[0].run) : null;
}

export async function getVerificationHeadVersion(
  db: DbExecutor,
  ctx: TenantContext,
  actionId: string,
): Promise<number | null> {
  const rows = await db
    .select({ version: verificationRunHeads.version })
    .from(verificationRunHeads)
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(verificationRunHeads.actionId, actionId),
      ),
    )
    .limit(1);
  return rows[0]?.version ?? null;
}

export async function getCaseVerificationView(db: DbExecutor, ctx: TenantContext, caseId: string) {
  const actionRows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.caseId, caseId)));
  const action =
    actionRows.find((candidate) => candidate.toolId === 'SIMULATE_TRANSFER_REMEDIATION') ??
    actionRows[0] ??
    null;
  if (!action) {
    return {
      contract: null,
      result: null,
      action_status: null,
      blockers: [],
      allocation: null,
      closure: null,
      reversal: null,
    };
  }
  const contract = await loadContract(
    db,
    action.toolId as keyof typeof VERIFICATION_CONTRACT_BY_TOOL,
  );
  const result = await getCurrentVerification(db, ctx, action.id);
  const allocations = await db
    .select()
    .from(reconciliationAllocations)
    .where(
      and(
        eq(reconciliationAllocations.tenantId, ctx.tenantId),
        eq(reconciliationAllocations.caseId, caseId),
      ),
    )
    .limit(1);
  const allocation = allocations[0] ?? null;
  const closures = allocation
    ? await db
        .select()
        .from(receivableClosures)
        .where(
          and(
            eq(receivableClosures.tenantId, ctx.tenantId),
            eq(receivableClosures.allocationId, allocation.id),
          ),
        )
        .limit(1)
    : [];
  const reversals = allocation
    ? await db
        .select()
        .from(reconciliationReversals)
        .where(
          and(
            eq(reconciliationReversals.tenantId, ctx.tenantId),
            eq(reconciliationReversals.allocationId, allocation.id),
          ),
        )
        .limit(1)
    : [];
  return {
    contract,
    result,
    action_status: action.status,
    blockers: result?.status === 'VERIFICATION_PENDING' ? ['AWAITING_AUTHORITATIVE_EVIDENCE'] : [],
    allocation: allocation
      ? {
          allocation_id: allocation.id,
          bank_line_evidence_id: allocation.bankLineEvidenceId,
          expectation_id: allocation.expectationId,
          amount: { amount_minor: allocation.amountMinor.toString(), currency: 'INR' as const },
        }
      : null,
    closure: closures[0]
      ? {
          closure_evidence_id: closures[0].closureEvidenceId,
          closed_at: closures[0].closedAt.toISOString(),
        }
      : null,
    reversal: reversals[0]
      ? {
          reversal_evidence_id: reversals[0].reversalEvidenceId,
          reversed_amount: {
            amount_minor: reversals[0].reversedAmountMinor.toString(),
            currency: 'INR' as const,
          },
          reversed_at: reversals[0].reversedAt.toISOString(),
        }
      : null,
  };
}
