import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../../config/db.js';
import {
  actions as actionsTable,
  approvals as approvalsTable,
  auditEntries,
  cases,
  ingestEvents,
  outbox,
  plans as plansTable,
  policyDecisions,
  receivableClosures,
  reconciliationAllocations,
  reconciliationReversals,
} from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { ActionRecord } from '../../contracts/actions.js';
import type { ToolActionId } from '../../contracts/plans.js';
import {
  computeDecisionBasisHash,
  rebuildDecisionBasis,
  resolveBasisExpiry,
} from '../approvals/decision-basis.js';
import { computeActionIdempotencyKey, computeActionRequestHash } from './idempotency.js';
import { lockControlLoopCase, transitionCaseInTransaction } from '../cases/case-service.js';
import { authorizeTenantActorForUpdate } from '../identity/identity-repository.js';
import type { Role } from '../identity/roles.js';
import {
  persistedApplicationActorId,
  projectApplicationActor,
  resolvedUserApplicationActor,
  type ApplicationActor,
} from '../identity/application-actor.js';

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
export class ActionEnvironmentDeniedError extends Error {
  constructor() {
    super('actions are disabled in this environment');
    this.name = 'ActionEnvironmentDeniedError';
  }
}

export interface ReserveActionInput {
  readonly caseId: string;
  readonly planId: string;
  readonly decisionBasisHash: string;
  readonly actorId: string;
}

export type ReserveActionInTransactionInput = Omit<ReserveActionInput, 'actorId'>;

/**
 * Reserve a simulated action (backend PRD §12.4). Rebuilds and compares the
 * COMPLETE decision basis inside THIS transaction (never trusting the
 * approval as recorded earlier), derives the stable idempotency key/request
 * hash, and commits the reservation + audit entry + `dispatch-action.v1`
 * outbox row atomically. Same key/same body returns the existing action; same
 * key/different body is a `409 IDEMPOTENCY_BODY_CONFLICT`.
 */
export async function reserveActionInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  input: ReserveActionInTransactionInput,
  actor: ApplicationActor,
): Promise<ActionRecord> {
  await lockControlLoopCase(tx, ctx, input.caseId);
  const actorProjection = projectApplicationActor(actor, ctx);
  const persistedActorId = persistedApplicationActorId(actor);
  if (!['demo', 'buildathon', 'test'].includes(actorProjection.environment)) {
    throw new ActionEnvironmentDeniedError();
  }
  await tx.execute(
    sql`select id from plans where tenant_id = ${ctx.tenantId} and id = ${input.planId} for update`,
  );
  const planRows = await tx
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, input.planId)))
    .limit(1);
  const plan = planRows[0];
  if (!plan || plan.caseId !== input.caseId || plan.status !== 'AUTHORIZED' || !plan.isCurrent) {
    throw new ActionPlanNotFoundError();
  }
  const toolId = (plan.parameters as { tool_id: ToolActionId }).tool_id;
  if (
    actor.kind === 'trusted_worker' &&
    toolId !== 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'
  ) {
    throw new ActionEnvironmentDeniedError();
  }
  if (toolId === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION') {
    if (actor.kind !== 'trusted_worker') throw new ActionEnvironmentDeniedError();
    const expectationId = (plan.parameters as { expectation_id?: string }).expectation_id;
    if (!expectationId) throw new ActionBasisStaleError();
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|reconciliation|${expectationId}`}, 0))`,
    );
    await tx.execute(sql`
          select id from reconciliation_allocations
          where tenant_id = ${ctx.tenantId} and expectation_id = ${expectationId}
          for update
        `);
    const allocations = await tx
      .select()
      .from(reconciliationAllocations)
      .where(
        and(
          eq(reconciliationAllocations.tenantId, ctx.tenantId),
          eq(reconciliationAllocations.expectationId, expectationId),
        ),
      )
      .limit(1);
    const allocation = allocations[0];
    if (!allocation || allocation.caseId !== input.caseId || allocation.status !== 'ALLOCATED') {
      throw new ActionBasisStaleError();
    }
    // A Drizzle transaction is backed by a single pinned node-postgres
    // connection, which cannot execute concurrent queries. These locked reads
    // must therefore run sequentially, not via Promise.all (that path triggers
    // pg's "already executing a query" deprecation and is removed in pg@9).
    const closures = await tx
      .select({ id: receivableClosures.id })
      .from(receivableClosures)
      .where(
        and(
          eq(receivableClosures.tenantId, ctx.tenantId),
          eq(receivableClosures.allocationId, allocation.id),
        ),
      )
      .limit(1);
    const reversals = await tx
      .select({ id: reconciliationReversals.id })
      .from(reconciliationReversals)
      .where(
        and(
          eq(reconciliationReversals.tenantId, ctx.tenantId),
          eq(reconciliationReversals.allocationId, allocation.id),
        ),
      )
      .limit(1);
    const evidence = await tx
      .select({
        signatureStatus: ingestEvents.signatureStatus,
        quarantineStatus: ingestEvents.quarantineStatus,
      })
      .from(ingestEvents)
      .where(
        and(
          eq(ingestEvents.tenantId, ctx.tenantId),
          eq(ingestEvents.id, allocation.bankLineEvidenceId),
        ),
      )
      .limit(1);
    if (
      closures[0] ||
      reversals[0] ||
      evidence[0]?.signatureStatus !== 'verified' ||
      evidence[0]?.quarantineStatus !== 'none'
    ) {
      throw new ActionBasisStaleError();
    }
  }
  const target =
    (plan.parameters as { economic_subject?: string; expectation_id?: string }).economic_subject ??
    (plan.parameters as { expectation_id?: string }).expectation_id ??
    input.caseId;
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
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|action|${idempotencyKey}`}, 0))`,
  );
  const existing = await tx
    .select()
    .from(actionsTable)
    .where(
      and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.idempotencyKey, idempotencyKey)),
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].requestHash !== requestHash) {
      throw new ActionIdempotencyBodyConflictError();
    }
    return toActionRecord(existing[0]);
  }

  // Lock every mutable or append-only row that comprises the live basis.
  // The case advisory lock prevents application-level phantom inserts for
  // this case; these row locks additionally prevent direct concurrent
  // mutation/revocation until reservation commits.
  await tx.execute(sql`
        select i.id, es.id
        from investigations i
        join evidence_sets es
          on es.tenant_id = i.tenant_id and es.evidence_set_hash = i.evidence_set_hash
        where i.tenant_id = ${ctx.tenantId} and i.case_id = ${input.caseId}
        order by i.created_at desc, i.id desc
        limit 1
        for update of i, es
      `);
  await tx.execute(sql`
        select id from policy_decisions
        where tenant_id = ${ctx.tenantId} and plan_id = ${input.planId}
        order by created_at desc, id desc
        limit 1
        for update
      `);

  const expiresAt = await resolveBasisExpiry(tx, ctx, input.planId);
  const rebuilt = await rebuildDecisionBasis(
    tx,
    ctx,
    { caseId: input.caseId, planId: input.planId },
    expiresAt,
  );
  if (!rebuilt) throw new ActionBasisStaleError();
  const freshHash = computeDecisionBasisHash(rebuilt);
  if (
    freshHash !== input.decisionBasisHash ||
    new Date(rebuilt.expires_at).getTime() <= Date.now()
  ) {
    throw new ActionBasisStaleError();
  }
  const policyRows = await tx
    .select({ id: policyDecisions.id, decision: policyDecisions.decision })
    .from(policyDecisions)
    .where(
      and(
        eq(policyDecisions.tenantId, ctx.tenantId),
        eq(policyDecisions.id, rebuilt.policy_decision_id),
        eq(policyDecisions.planId, input.planId),
      ),
    )
    .limit(1);
  if (!['ALLOW_AUTOMATIC', 'REQUIRE_APPROVAL'].includes(policyRows[0]?.decision ?? '')) {
    throw new ActionBasisStaleError();
  }

  if (toolId === 'SIMULATE_TRANSFER_REMEDIATION') {
    await tx.execute(sql`
          select id from approvals
          where tenant_id = ${ctx.tenantId} and plan_id = ${input.planId} and state = 'APPROVED'
          order by requested_at desc, id desc
          limit 1
          for update
        `);
    const approvalRows = await tx
      .select()
      .from(approvalsTable)
      .where(
        and(
          eq(approvalsTable.tenantId, ctx.tenantId),
          eq(approvalsTable.planId, input.planId),
          eq(approvalsTable.state, 'APPROVED'),
        ),
      )
      .orderBy(desc(approvalsTable.requestedAt))
      .limit(1);
    const approval = approvalRows[0];
    if (
      !approval ||
      approval.decisionBasisHash !== freshHash ||
      approval.expiresAt.getTime() <= Date.now() ||
      !approval.approverId
    ) {
      throw new ActionApprovalMissingError();
    }
    await authorizeTenantActorForUpdate(tx, ctx, approval.approverId, [
      approval.requiredRole as Role,
    ]);
  }

  const actionId = `action_${randomUUID()}`;
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
    actorId: persistedActorId,
    actorRole: actorProjection.actorRole,
    details: {
      operation: 'action_reserved',
      tool_id: toolId,
      case_id: input.caseId,
      resource_version: 0,
    },
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
  if (!caseRow) throw new ActionBasisStaleError();
  // CLOSE is the secondary, reconciliation-triggered effect for a case whose
  // transfer action is already awaiting verification. It must not rewind or
  // duplicate that case lifecycle; observed ERP closure completes both runs.
  if (
    toolId === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION' &&
    caseRow.lifecycleState === 'verification_pending'
  ) {
    const inserted = await tx
      .select()
      .from(actionsTable)
      .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.id, actionId)))
      .limit(1);
    return toActionRecord(inserted[0]!);
  }
  if (caseRow.lifecycleState === 'approval_required') {
    const nextVersion = await transitionCaseInTransaction(tx, ctx, {
      caseId: input.caseId,
      toState: 'approved',
      reason: 'approved_action_reserved',
      expectedVersion: caseRow.version,
      actorId: persistedActorId,
      actorRole: actorProjection.actorRole,
    });
    caseRow = { lifecycleState: 'approved', version: nextVersion };
  }
  await transitionCaseInTransaction(tx, ctx, {
    caseId: input.caseId,
    toState: 'executing',
    reason: 'action_reserved',
    expectedVersion: caseRow.version,
    actorId: persistedActorId,
    actorRole: actorProjection.actorRole,
  });
  const inserted = await tx
    .select()
    .from(actionsTable)
    .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.id, actionId)))
    .limit(1);
  return toActionRecord(inserted[0]!);
}

/** Public user path: current membership is locked and the worker cannot be supplied. */
export async function reserveAction(
  db: Database,
  ctx: TenantContext,
  input: ReserveActionInput,
): Promise<ActionRecord> {
  return db.transaction(async (tx) => {
    const identity = await authorizeTenantActorForUpdate(tx, ctx, input.actorId, ['executor']);
    return reserveActionInTransaction(
      tx,
      ctx,
      {
        caseId: input.caseId,
        planId: input.planId,
        decisionBasisHash: input.decisionBasisHash,
      },
      resolvedUserApplicationActor(identity, 'executor'),
    );
  });
}

export async function getActionResourceVersion(
  db: Database,
  ctx: TenantContext,
  actionId: string,
): Promise<number | null> {
  const rows = await db
    .select({ version: actionsTable.version })
    .from(actionsTable)
    .where(and(eq(actionsTable.tenantId, ctx.tenantId), eq(actionsTable.id, actionId)))
    .limit(1);
  return rows[0]?.version ?? null;
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
