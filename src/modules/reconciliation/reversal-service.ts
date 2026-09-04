import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../../config/db.js';
import {
  actions,
  cases,
  economicSubjects,
  expectations,
  financialOutcomes,
  ingestEvents,
  invariantEvaluations,
  reconciliationAllocations,
  reconciliationReversals,
} from '../../config/db-schema.js';
import { CanonicalEvent } from '../../contracts/events/canonical-event.js';
import { money } from '../../domain/money/money.js';
import {
  assertFinancialOutcomeTransition,
  type FinancialOutcomeState,
} from '../../domain/state-machines/financial-outcome.js';
import { appendAuditEntry } from '../audit/audit-writer.js';
import { openOrGetCaseInTransaction } from '../cases/case-service.js';
import { MONEYTRACE_WORKER_ACTOR } from '../identity/worker-actor.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { evaluateActionVerificationInTransaction } from '../verification/verification-service.js';

export class ReconciliationReversalInvalidError extends Error {
  constructor() {
    super('authoritative reversal evidence is invalid or unrelated');
    this.name = 'ReconciliationReversalInvalidError';
  }
}

export async function reverseReconciliationInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  evidenceId: string,
  now = new Date(),
) {
  const evidenceRows = await tx
    .select()
    .from(ingestEvents)
    .where(and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, evidenceId)))
    .limit(1);
  const evidence = evidenceRows[0];
  const parsed = evidence ? CanonicalEvent.safeParse(evidence.rawPayload) : null;
  if (
    !evidence ||
    !parsed?.success ||
    !['RefundCreated', 'RefundProcessed'].includes(parsed.data.event_type) ||
    evidence.signatureStatus !== 'verified' ||
    evidence.quarantineStatus !== 'none' ||
    evidence.currency !== 'INR' ||
    !evidence.amountMinor ||
    !parsed.data.economic_subject_hint
  ) {
    throw new ReconciliationReversalInvalidError();
  }
  const candidateCases = await tx
    .select({ case: cases, subjectKey: economicSubjects.subjectKey })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .where(
      and(
        eq(cases.tenantId, ctx.tenantId),
        eq(economicSubjects.subjectKey, parsed.data.economic_subject_hint),
      ),
    )
    .orderBy(desc(cases.epoch));
  const caseRow = candidateCases[0]?.case;
  if (!caseRow) throw new ReconciliationReversalInvalidError();
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|reconciliation|${caseRow.expectationId}`}, 0))`,
  );
  const allocations = await tx
    .select()
    .from(reconciliationAllocations)
    .where(
      and(
        eq(reconciliationAllocations.tenantId, ctx.tenantId),
        eq(reconciliationAllocations.expectationId, caseRow.expectationId),
      ),
    )
    .limit(1);
  const allocation = allocations[0];
  if (!allocation || allocation.amountMinor !== evidence.amountMinor) {
    throw new ReconciliationReversalInvalidError();
  }
  const existing = await tx
    .select()
    .from(reconciliationReversals)
    .where(
      and(
        eq(reconciliationReversals.tenantId, ctx.tenantId),
        eq(reconciliationReversals.allocationId, allocation.id),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].reversalEvidenceId !== evidenceId)
      throw new ReconciliationReversalInvalidError();
    return { reversalId: existing[0].id, newCaseEpoch: existing[0].newCaseEpoch, replay: true };
  }
  const outcomes = await tx
    .select()
    .from(financialOutcomes)
    .where(
      and(
        eq(financialOutcomes.tenantId, ctx.tenantId),
        eq(financialOutcomes.expectationId, allocation.expectationId),
        eq(financialOutcomes.isCurrent, true),
      ),
    )
    .limit(1);
  const currentOutcome = outcomes[0];
  if (!currentOutcome) throw new ReconciliationReversalInvalidError();
  assertFinancialOutcomeTransition(currentOutcome.status as FinancialOutcomeState, 'REVERSED');
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
    expectationId: allocation.expectationId,
    status: 'REVERSED',
    version: currentOutcome.version + 1,
    observedAmountMinor: 0n,
    currency: 'INR',
    isCurrent: true,
    createdAt: now,
  });
  const expectationRows = await tx
    .select()
    .from(expectations)
    .where(
      and(eq(expectations.tenantId, ctx.tenantId), eq(expectations.id, allocation.expectationId)),
    )
    .limit(1);
  const expectation = expectationRows[0]!;
  const evaluations = await tx
    .select({ evaluationWindow: invariantEvaluations.evaluationWindow })
    .from(invariantEvaluations)
    .where(
      and(
        eq(invariantEvaluations.tenantId, ctx.tenantId),
        eq(invariantEvaluations.controlId, caseRow.controlId),
        eq(invariantEvaluations.subjectId, caseRow.subjectId),
      ),
    )
    .orderBy(desc(invariantEvaluations.evaluatedAt))
    .limit(1);
  const reopened = await openOrGetCaseInTransaction(tx, ctx, {
    controlId: caseRow.controlId,
    subjectId: caseRow.subjectId,
    expectationId: caseRow.expectationId,
    expectationVersion: expectation.version,
    evaluationWindow: evaluations[0]?.evaluationWindow ?? caseRow.openedAt.toISOString(),
    exposure: money(allocation.amountMinor),
    priority: {
      exposure: money(allocation.amountMinor),
      evidenceCoverage: 'complete',
      customerHarmRisk: 'high',
      ageSeconds: 0,
    },
  });
  const reopenedRows = await tx
    .select({ epoch: cases.epoch })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, reopened.caseId)))
    .limit(1);
  const reversalId = `reversal_${randomUUID()}`;
  await tx.insert(reconciliationReversals).values({
    id: reversalId,
    tenantId: ctx.tenantId,
    allocationId: allocation.id,
    expectationId: allocation.expectationId,
    caseId: caseRow.id,
    reversalEvidenceId: evidenceId,
    reversedAmountMinor: allocation.amountMinor,
    currency: 'INR',
    reversedAt: new Date(parsed.data.event_time),
    newCaseEpoch: reopenedRows[0]?.epoch ?? null,
    createdAt: now,
  });
  await appendAuditEntry(tx, ctx, {
    artifactType: 'RECONCILIATION_REVERSAL',
    artifactId: reversalId,
    actorId: null,
    actorRole: MONEYTRACE_WORKER_ACTOR.role,
    deterministicId: `audit_reversal_${reversalId}`,
    details: {
      operation: 'reconciliation_reversed',
      case_id: caseRow.id,
      allocation_id: allocation.id,
      new_case_epoch: reopenedRows[0]?.epoch ?? null,
    },
  });
  const affectedActions = await tx
    .select({ id: actions.id })
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.caseId, caseRow.id)));
  for (const action of affectedActions) {
    await evaluateActionVerificationInTransaction(tx, ctx, action.id, undefined, now);
  }
  return { reversalId, newCaseEpoch: reopenedRows[0]?.epoch ?? null, replay: false };
}

export async function reverseReconciliation(
  db: Database,
  ctx: TenantContext,
  evidenceId: string,
  now = new Date(),
) {
  return db.transaction((tx) => reverseReconciliationInTransaction(tx, ctx, evidenceId, now));
}
