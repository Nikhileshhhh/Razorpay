import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../config/db.js';
import { actions, cases, economicSubjects, invariantEvaluations } from '../config/db-schema.js';
import type { TenantContext } from '../modules/identity/tenant-context.js';
import { dispatchAction } from '../modules/actions/action-dispatch.js';
import { ingestSyntheticEvidence } from '../modules/demo/evidence-builder.js';
import { evaluateActionVerification } from '../modules/verification/verification-service.js';

export class DuplicateRecoveryCompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateRecoveryCompletionError';
  }
}

/**
 * WORKER-ONLY completion of the dataset's one CTRL-04 duplicate-recovery-
 * prevention record (backend PRD §16.1 `duplicate_collection_prevented`,
 * §12.4). This module — and therefore `action-dispatch.ts`/the adapter
 * registry it imports — must NEVER be imported by anything reachable from
 * the API process (`src/api/**`): dataset generation
 * (`src/modules/demo/dataset-flows.ts`) only ingests evidence, investigates,
 * evaluates policy, and RESERVES the action (which durably enqueues a
 * `dispatch-action.v1` outbox row and, separately, a
 * `complete-duplicate-recovery-prevention.v1` row) — it never dispatches.
 * Only this worker-side handler (registered in `job-handlers-b4.ts`, which
 * only `worker.ts` imports) actually calls the adapter, injects the signed
 * completion evidence, and evaluates verification — mirroring exactly how a
 * real running worker would complete any other action asynchronously.
 *
 * The prevented amount is re-derived from the persisted CTRL-04
 * `invariant_evaluations` row (never trusted from the job payload), so a
 * worker restart or redelivery recomputes it identically from durable state.
 */
export async function completeDuplicateRecoveryPrevention(
  db: Database,
  ctx: TenantContext,
  actionId: string,
  now = new Date(),
): Promise<void> {
  const actionRows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.id, actionId)))
    .limit(1);
  const action = actionRows[0];
  if (!action || action.toolId !== 'SUPPRESS_SIMULATED_RECOVERY') {
    throw new DuplicateRecoveryCompletionError(
      `action ${actionId} is not a duplicate-recovery-prevention action`,
    );
  }
  const caseRows = await db
    .select({ subjectId: cases.subjectId })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, action.caseId)))
    .limit(1);
  const subjectId = caseRows[0]?.subjectId;
  if (!subjectId)
    throw new DuplicateRecoveryCompletionError(`case not found for action ${actionId}`);
  const subjectRows = await db
    .select({ subjectKey: economicSubjects.subjectKey })
    .from(economicSubjects)
    .where(and(eq(economicSubjects.tenantId, ctx.tenantId), eq(economicSubjects.id, subjectId)))
    .limit(1);
  const subjectKey = subjectRows[0]?.subjectKey;
  if (!subjectKey) {
    throw new DuplicateRecoveryCompletionError(`economic subject not found for action ${actionId}`);
  }
  const evaluationRows = await db
    .select({ amountMinor: invariantEvaluations.amountMinor })
    .from(invariantEvaluations)
    .where(
      and(
        eq(invariantEvaluations.tenantId, ctx.tenantId),
        eq(invariantEvaluations.controlId, 'CTRL-04'),
        eq(invariantEvaluations.subjectId, subjectId),
        eq(invariantEvaluations.result, 'violated'),
      ),
    )
    .orderBy(desc(invariantEvaluations.evaluatedAt))
    .limit(1);
  const preventedAmountMinor = evaluationRows[0]?.amountMinor;
  if (preventedAmountMinor === null || preventedAmountMinor === undefined) {
    throw new DuplicateRecoveryCompletionError(
      `no CTRL-04 violation recorded for action ${actionId}`,
    );
  }

  await dispatchAction(db, ctx, actionId);
  await ingestSyntheticEvidence(db, ctx, {
    key: `duprec_suppressed_${actionId}`,
    subject: subjectKey,
    type: 'RecoverySuppressed',
    source: 'SYNTHETIC_RECOVERY',
    occurredAt: now,
    ingestedAt: now,
    amountMinor: preventedAmountMinor,
    references: { recovery_id: `recovery_${actionId}` },
  });
  await evaluateActionVerification(db, ctx, actionId, undefined, now);
}
