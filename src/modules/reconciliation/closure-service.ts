import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../../config/db.js';
import {
  actions,
  ingestEvents,
  plans,
  receivableClosures,
  reconciliationAllocations,
  reconciliationReversals,
} from '../../config/db-schema.js';
import { CanonicalEvent } from '../../contracts/events/canonical-event.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { appendAuditEntry } from '../audit/audit-writer.js';
import { MONEYTRACE_WORKER_ACTOR } from '../identity/worker-actor.js';
import { evaluateActionVerificationInTransaction } from '../verification/verification-service.js';

export class ReceivableClosureInvalidError extends Error {
  constructor() {
    super('receivable closure evidence is not valid for an active allocation');
    this.name = 'ReceivableClosureInvalidError';
  }
}

export interface ObserveClosureResult {
  readonly closureId: string;
  readonly idempotentReplay: boolean;
}

export async function observeReceivableClosureInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  evidenceId: string,
  now = new Date(),
): Promise<ObserveClosureResult> {
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
    parsed.data.event_type !== 'SellerReceivableClosed' ||
    parsed.data.source_system !== 'SYNTHETIC_ERP' ||
    evidence.signatureStatus !== 'verified' ||
    evidence.quarantineStatus !== 'none' ||
    evidence.amountMinor !== 0n ||
    evidence.currency !== 'INR' ||
    !parsed.data.causation_id
  ) {
    throw new ReceivableClosureInvalidError();
  }
  const closeActionId = parsed.data.causation_id;
  const actionRows = await tx
    .select({ action: actions, plan: plans })
    .from(actions)
    .innerJoin(plans, and(eq(plans.tenantId, actions.tenantId), eq(plans.id, actions.planId)))
    .where(
      and(
        eq(actions.tenantId, ctx.tenantId),
        eq(actions.id, closeActionId),
        eq(actions.toolId, 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'),
      ),
    )
    .limit(1);
  const action = actionRows[0]?.action;
  const plan = actionRows[0]?.plan;
  const expectationId = (plan?.parameters as { expectation_id?: string } | undefined)
    ?.expectation_id;
  if (!action || !expectationId || action.status !== 'VERIFICATION_PENDING') {
    throw new ReceivableClosureInvalidError();
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|reconciliation|${expectationId}`}, 0))`,
  );
  const allocationRows = await tx
    .select()
    .from(reconciliationAllocations)
    .where(
      and(
        eq(reconciliationAllocations.tenantId, ctx.tenantId),
        eq(reconciliationAllocations.expectationId, expectationId),
      ),
    )
    .limit(1);
  const allocation = allocationRows[0];
  if (!allocation || allocation.caseId !== action.caseId) throw new ReceivableClosureInvalidError();
  const existing = await tx
    .select()
    .from(receivableClosures)
    .where(
      and(
        eq(receivableClosures.tenantId, ctx.tenantId),
        eq(receivableClosures.allocationId, allocation.id),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (
      existing[0].closureEvidenceId !== evidenceId ||
      existing[0].closeActionId !== closeActionId
    ) {
      throw new ReceivableClosureInvalidError();
    }
    return { closureId: existing[0].id, idempotentReplay: true };
  }
  const reversal = await tx
    .select({ id: reconciliationReversals.id })
    .from(reconciliationReversals)
    .where(
      and(
        eq(reconciliationReversals.tenantId, ctx.tenantId),
        eq(reconciliationReversals.allocationId, allocation.id),
      ),
    )
    .limit(1);
  if (reversal[0]) throw new ReceivableClosureInvalidError();
  const closureId = `closure_${randomUUID()}`;
  await tx.insert(receivableClosures).values({
    id: closureId,
    tenantId: ctx.tenantId,
    allocationId: allocation.id,
    expectationId,
    caseId: action.caseId,
    closeActionId,
    closureEvidenceId: evidenceId,
    closedAt: parsed.data.event_time ? new Date(parsed.data.event_time) : now,
    createdAt: now,
  });
  await appendAuditEntry(tx, ctx, {
    artifactType: 'RECONCILIATION',
    artifactId: closureId,
    actorId: null,
    actorRole: MONEYTRACE_WORKER_ACTOR.role,
    deterministicId: `audit_closure_${closureId}`,
    details: {
      operation: 'receivable_closed',
      case_id: action.caseId,
      allocation_id: allocation.id,
      closure_evidence_id: evidenceId,
    },
  });
  const transferActions = await tx
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.tenantId, ctx.tenantId),
        eq(actions.caseId, action.caseId),
        eq(actions.toolId, 'SIMULATE_TRANSFER_REMEDIATION'),
      ),
    );
  for (const transfer of transferActions) {
    await evaluateActionVerificationInTransaction(tx, ctx, transfer.id, undefined, now);
  }
  await evaluateActionVerificationInTransaction(tx, ctx, closeActionId, undefined, now);
  return { closureId, idempotentReplay: false };
}

export async function observeReceivableClosure(
  db: Database,
  ctx: TenantContext,
  evidenceId: string,
  now = new Date(),
): Promise<ObserveClosureResult> {
  return db.transaction((tx) => observeReceivableClosureInTransaction(tx, ctx, evidenceId, now));
}
