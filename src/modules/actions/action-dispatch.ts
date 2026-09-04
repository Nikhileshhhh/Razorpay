import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { actionAttempts, actions as actionsTable, auditEntries } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { ToolActionId } from '../../contracts/plans.js';
import { dispatchThroughAdapter, type AdapterOutcome } from './adapter-registry.js';
import { MONEYTRACE_WORKER_ACTOR, type TrustedWorkerActor } from '../identity/worker-actor.js';
import { ensurePendingVerificationInTransaction } from '../verification/verification-service.js';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'ACKNOWLEDGED',
  'FAILED',
  'OUTCOME_UNKNOWN',
  'VERIFICATION_PENDING',
]);

export class ActionNotFoundError extends Error {
  constructor() {
    super('action not found');
    this.name = 'ActionNotFoundError';
  }
}

/**
 * Worker-only dispatch handler for `dispatch-action.v1` (backend PRD §12.4,
 * §15). Never runs in the API process. Idempotent under redelivery/crash: an
 * action already past `RESERVED`/`DISPATCHING` (ACK/FAIL/UNKNOWN/
 * VERIFICATION_PENDING) is a no-op — the SAME stable idempotency key/action
 * row is reused, never a new one, and the simulated adapters return a
 * deterministic `external_reference` derived from `actionId` alone, so even a
 * crash-and-retry mid-dispatch produces exactly one simulated effect
 * reference. `OUTCOME_UNKNOWN` is recorded distinctly from `FAILED` and is
 * never retried as a new attempt beyond this same idempotent redelivery path.
 */
export async function dispatchAction(
  db: Database,
  ctx: TenantContext,
  actionId: string,
  opts: {
    readonly forcedOutcome?: AdapterOutcome;
    /** Deterministic crash injection used to prove DISPATCHING redelivery safety. */
    readonly failAfterAdapterForTest?: boolean;
  } = {},
  workerActor: TrustedWorkerActor = MONEYTRACE_WORKER_ACTOR,
): Promise<void> {
  const rows = await db
    .select()
    .from(actionsTable)
    .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.id, actionId)))
    .limit(1);
  const action = rows[0];
  if (!action) throw new ActionNotFoundError();
  if (TERMINAL_STATUSES.has(action.status)) return; // already resolved — no-op, no new attempt

  const dispatchingRows = await db
    .update(actionsTable)
    .set({ status: 'DISPATCHING', submittedAt: action.submittedAt ?? new Date() })
    .where(
      and(
        eq(actionsTable.tenantId, ctx.tenantId),
        eq(actionsTable.id, actionId),
        eq(actionsTable.status, action.status), // 'RESERVED' or already 'DISPATCHING'
      ),
    )
    .returning({ status: actionsTable.status });
  if (dispatchingRows.length !== 1) return; // raced with another dispatcher; it owns this attempt

  const result = dispatchThroughAdapter(action.toolId as ToolActionId, {
    actionId,
    ...(opts.forcedOutcome ? { forcedOutcome: opts.forcedOutcome } : {}),
  });
  if (opts.failAfterAdapterForTest) {
    throw new Error('simulated post-adapter crash');
  }

  const attemptNumber = action.attemptCount + 1;
  const acknowledgedAt = result.outcome === 'ACKNOWLEDGED' ? new Date() : null;

  await db.transaction(async (tx) => {
    await tx.insert(actionAttempts).values({
      id: `action_attempt_${randomUUID()}`,
      tenantId: ctx.tenantId,
      actionId,
      attemptNumber,
      requestPayload: { tool_id: action.toolId, tool_version: action.toolVersion },
      responsePayload: { outcome: result.outcome, external_reference: result.externalReference },
      errorClass: result.outcome === 'FAILED' ? 'ADAPTER_FAILED' : null,
    });

    const nextStatus = result.outcome === 'FAILED' ? 'FAILED' : 'VERIFICATION_PENDING';
    const updated = await tx
      .update(actionsTable)
      .set({
        status: nextStatus,
        attemptCount: attemptNumber,
        externalReference: result.externalReference,
        acknowledgedAt,
        outcomeStatus: result.outcome,
        version: action.version + 1,
      })
      .where(
        and(
          eq(actionsTable.tenantId, ctx.tenantId),
          eq(actionsTable.id, actionId),
          eq(actionsTable.status, 'DISPATCHING'),
        ),
      )
      .returning({ id: actionsTable.id });
    if (updated.length !== 1) return;

    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'ACTION',
      artifactId: actionId,
      actorId: null,
      actorRole: workerActor.role,
      details: {
        operation: 'action_dispatched',
        outcome: result.outcome,
        attempt_number: attemptNumber,
        external_reference: result.externalReference,
      },
    });
    if (nextStatus === 'VERIFICATION_PENDING') {
      await ensurePendingVerificationInTransaction(tx, ctx, actionId);
    }
  });
}
