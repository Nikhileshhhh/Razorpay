import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  actions as actionsTable,
  approvals as approvalsTable,
  auditEntries,
  cases,
  outbox,
  plans as plansTable,
} from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { ActionRecord } from '../../contracts/actions.js';
import type { ToolActionId } from '../../contracts/plans.js';
import { isUniqueViolation } from '../../config/errors.js';
import {
  computeDecisionBasisHash,
  rebuildDecisionBasis,
  resolveBasisExpiry,
} from '../approvals/decision-basis.js';
import { computeActionIdempotencyKey, computeActionRequestHash } from './idempotency.js';
import {
  assertCaseLifecycleTransition,
  type CaseLifecycleState,
} from '../../domain/state-machines/case-lifecycle.js';

export class ActionPlanNotFoundError extends Error {
  constructor() {
    super('plan not found or not AUTHORIZED');
    this.name = 'ActionPlanNotFoundError';
  }
}
export class ActionBasisStaleError extends Error {
  constructor() {
    super('the decision basis for this plan is stale');
    this.name = 'ActionBasisStaleError';
  }
}
export class ActionApprovalMissingError extends Error {
  constructor() {
    super('this plan requires a current APPROVED approval and none exists');
    this.name = 'ActionApprovalMissingError';
  }
}
export class ActionIdempotencyBodyConflictError extends Error {
  constructor() {
    super('same idempotency key, different request body');
    this.name = 'ActionIdempotencyBodyConflictError';
  }
}

export interface ReserveActionInput {
  readonly caseId: string;
  readonly planId: string;
  readonly decisionBasisHash: string;
  readonly actorId: string;
  readonly actorRole: string;
}

/**
 * Reserve a simulated action (backend PRD §12.4). Rebuilds and compares the
 * COMPLETE decision basis inside THIS transaction (never trusting the
 * approval as recorded earlier), derives the stable idempotency key/request
 * hash, and commits the reservation + audit entry + `dispatch-action.v1`
 * outbox row atomically. Same key/same body returns the existing action; same
 * key/different body is a `409 IDEMPOTENCY_BODY_CONFLICT`.
 */
export async function reserveAction(
  db: Database,
  ctx: TenantContext,
  input: ReserveActionInput,
): Promise<ActionRecord> {
  const planRows = await db
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, input.planId)))
    .limit(1);
  const plan = planRows[0];
  if (!plan || plan.caseId !== input.caseId || plan.status !== 'AUTHORIZED') {
    throw new ActionPlanNotFoundError();
  }

  const toolId = (plan.parameters as { tool_id: ToolActionId }).tool_id;
  // `target` is stable, immutable plan content — no need for a live rebuild
  // to compute it, so the idempotency lookup below never depends on freshness.
  const target =
    (plan.parameters as { economic_subject?: string }).economic_subject ?? input.caseId;
  const idempotencyKey = computeActionIdempotencyKey({
    tenantId: ctx.tenantId,
    caseId: input.caseId,
    planHash: plan.planHash,
    toolId,
    target,
  });
  const requestHash = computeActionRequestHash({
    planId: input.planId,
    decisionBasisHash: input.decisionBasisHash,
  });

  // A REPEATED request (same key/same body) is idempotent and returns the
  // EXISTING reservation without re-validating freshness against live state —
  // the reservation's own prior success (and any case/plan transitions it
  // caused) must never retroactively invalidate itself on redelivery.
  const existing = await db
    .select()
    .from(actionsTable)
    .where(
      and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.idempotencyKey, idempotencyKey)),
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].requestHash !== requestHash) throw new ActionIdempotencyBodyConflictError();
    return toActionRecord(existing[0]);
  }

  // No existing reservation: this is a NEW authorization to act on, so it
  // MUST rebuild and compare the complete decision basis against live state
  // (backend PRD §12.4) before ever reserving anything.
  const expiresAt = await resolveBasisExpiry(db, ctx, input.planId);
  const rebuilt = await rebuildDecisionBasis(
    db,
    ctx,
    { caseId: input.caseId, planId: input.planId },
    expiresAt,
  );
  if (!rebuilt) throw new ActionBasisStaleError();
  const freshHash = computeDecisionBasisHash(rebuilt);
  if (freshHash !== input.decisionBasisHash) throw new ActionBasisStaleError();
  if (new Date(rebuilt.expires_at).getTime() <= Date.now()) throw new ActionBasisStaleError();

  if (toolId === 'SIMULATE_TRANSFER_REMEDIATION') {
    const approvalRows = await db
      .select({ state: approvalsTable.state, decisionBasisHash: approvalsTable.decisionBasisHash })
      .from(approvalsTable)
      .where(
        and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.planId, input.planId)),
      )
      .limit(1);
    const approved = approvalRows.find((row) => row.state === 'APPROVED');
    if (!approved || approved.decisionBasisHash !== freshHash) {
      throw new ActionApprovalMissingError();
    }
  }

  const actionId = `action_${randomUUID()}`;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(actionsTable).values({
        id: actionId,
        tenantId: ctx.tenantId,
        caseId: input.caseId,
        planId: input.planId,
        toolId,
        toolVersion: 'v1',
        idempotencyKey,
        requestHash,
        status: 'RESERVED',
        attemptCount: 0,
        version: 0,
      });
      await tx.insert(auditEntries).values({
        id: `audit_${randomUUID()}`,
        tenantId: ctx.tenantId,
        artifactType: 'ACTION',
        artifactId: actionId,
        artifactHash: requestHash,
        actorId: input.actorId,
        actorRole: input.actorRole,
        details: { operation: 'action_reserved', tool_id: toolId, case_id: input.caseId },
      });
      await tx.insert(outbox).values({
        id: `outbox_${randomUUID()}`,
        tenantId: ctx.tenantId,
        topic: 'dispatch-action.v1',
        domainEventId: actionId,
        payload: { tenant_id: ctx.tenantId, action_id: actionId },
        status: 'pending',
      });

      const caseRows = await tx
        .select({ lifecycleState: cases.lifecycleState, version: cases.version })
        .from(cases)
        .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
        .limit(1);
      let caseRow = caseRows[0];
      // The `approve` decision deliberately left the case at `approval_required`
      // (to keep the decision basis stable through this exact reservation —
      // see approval-service.ts) — chain the `-> approved -> executing` hop
      // here, now that the basis comparison above has already succeeded.
      if (caseRow && caseRow.lifecycleState === 'approval_required') {
        try {
          assertCaseLifecycleTransition(caseRow.lifecycleState as CaseLifecycleState, 'approved');
          const updated = await tx
            .update(cases)
            .set({ lifecycleState: 'approved', version: caseRow.version + 1 })
            .where(
              and(
                eq(cases.tenantId, ctx.tenantId),
                eq(cases.id, input.caseId),
                eq(cases.version, caseRow.version),
              ),
            )
            .returning({ lifecycleState: cases.lifecycleState, version: cases.version });
          if (updated[0]) caseRow = updated[0];
        } catch {
          // A forbidden/raced case transition never blocks reservation.
        }
      }
      if (caseRow && caseRow.lifecycleState !== 'executing') {
        try {
          assertCaseLifecycleTransition(caseRow.lifecycleState as CaseLifecycleState, 'executing');
          await tx
            .update(cases)
            .set({ lifecycleState: 'executing', version: caseRow.version + 1 })
            .where(
              and(
                eq(cases.tenantId, ctx.tenantId),
                eq(cases.id, input.caseId),
                eq(cases.version, caseRow.version),
              ),
            );
        } catch {
          // A forbidden/raced case transition never blocks reservation.
        }
      }
    });
  } catch (error) {
    if (isUniqueViolation(error, 'actions_idempotency_uq')) {
      const raced = await db
        .select()
        .from(actionsTable)
        .where(
          and(
            eq(actionsTable.tenantId, ctx.tenantId),
            eq(actionsTable.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (raced[0]) {
        if (raced[0].requestHash !== requestHash) throw new ActionIdempotencyBodyConflictError();
        return toActionRecord(raced[0]);
      }
    }
    throw error;
  }

  const inserted = await db
    .select()
    .from(actionsTable)
    .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.id, actionId)))
    .limit(1);
  return toActionRecord(inserted[0]!);
}

export async function getAction(
  db: Database,
  ctx: TenantContext,
  actionId: string,
): Promise<ActionRecord | null> {
  const rows = await db
    .select()
    .from(actionsTable)
    .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.id, actionId)))
    .limit(1);
  return rows[0] ? toActionRecord(rows[0]) : null;
}

export async function getCurrentActionForCase(
  db: Database,
  ctx: TenantContext,
  caseId: string,
): Promise<ActionRecord | null> {
  const rows = await db
    .select()
    .from(actionsTable)
    .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.caseId, caseId)))
    .limit(1);
  return rows[0] ? toActionRecord(rows[0]) : null;
}

export function toActionRecord(row: typeof actionsTable.$inferSelect): ActionRecord {
  const base = {
    schema_version: '1.0' as const,
    action_id: row.id,
    case_id: row.caseId,
    plan_id: row.planId,
    tool_id: row.toolId as ToolActionId,
    tool_version: row.toolVersion,
    idempotency_key: row.idempotencyKey,
    request_hash: row.requestHash,
  };
  switch (row.status) {
    case 'AUTHORIZED':
    case 'RESERVED':
      return {
        ...base,
        status: row.status,
        attempt_count: 0,
        external_reference: null,
        submitted_at: null,
        acknowledged_at: null,
        outcome_status: null,
      };
    case 'DISPATCHING':
      return {
        ...base,
        status: 'DISPATCHING',
        attempt_count: row.attemptCount,
        external_reference: row.externalReference,
        submitted_at: row.submittedAt!.toISOString(),
        acknowledged_at: null,
        outcome_status: null,
      };
    case 'ACKNOWLEDGED':
      return {
        ...base,
        status: 'ACKNOWLEDGED',
        attempt_count: row.attemptCount,
        external_reference: row.externalReference,
        submitted_at: row.submittedAt!.toISOString(),
        acknowledged_at: row.acknowledgedAt!.toISOString(),
        outcome_status: 'ACKNOWLEDGED',
      };
    case 'OUTCOME_UNKNOWN':
      return {
        ...base,
        status: 'OUTCOME_UNKNOWN',
        attempt_count: row.attemptCount,
        external_reference: row.externalReference,
        submitted_at: row.submittedAt!.toISOString(),
        acknowledged_at: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
        outcome_status: 'OUTCOME_UNKNOWN',
      };
    case 'FAILED':
      return {
        ...base,
        status: 'FAILED',
        attempt_count: row.attemptCount,
        external_reference: row.externalReference,
        submitted_at: row.submittedAt ? row.submittedAt.toISOString() : null,
        acknowledged_at: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
        outcome_status: 'FAILED',
      };
    case 'VERIFICATION_PENDING':
      return {
        ...base,
        status: 'VERIFICATION_PENDING',
        attempt_count: row.attemptCount,
        external_reference: row.externalReference,
        submitted_at: row.submittedAt!.toISOString(),
        acknowledged_at: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
        outcome_status: row.outcomeStatus as 'ACKNOWLEDGED' | 'OUTCOME_UNKNOWN',
      };
    default:
      throw new Error(`unknown action status: ${row.status}`);
  }
}
