import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../config/db.js';
import {
  approvals as approvalsTable,
  auditEntries,
  cases,
  plans as plansTable,
} from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type {
  ApprovalDecisionBasis,
  ApprovalRecord,
  ApprovalState,
} from '../../contracts/approvals.js';
import {
  computeDecisionBasisHash,
  rebuildDecisionBasis,
  APPROVAL_TTL_MS,
} from './decision-basis.js';
import { assertApprovalTransition } from '../../domain/state-machines/approval.js';
import { lockControlLoopCase, transitionCaseInTransaction } from '../cases/case-service.js';
import { authorizeTenantActorForUpdate } from '../identity/identity-repository.js';
import { assertHasAnyRole, type Role } from '../identity/roles.js';
import { isUniqueViolation } from '../../config/errors.js';

export class ApprovalNotFoundError extends Error {
  constructor() {
    super('approval not found');
    this.name = 'ApprovalNotFoundError';
  }
}
export class ApprovalPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalPreconditionError';
  }
}
export class ApprovalStaleError extends Error {
  constructor() {
    super('approval decision basis is stale');
    this.name = 'ApprovalStaleError';
  }
}
export class ApprovalSelfApprovalError extends Error {
  constructor() {
    super('the preparer of a plan cannot approve it');
    this.name = 'ApprovalSelfApprovalError';
  }
}
export class ApprovalStateConflictError extends Error {
  constructor(message = 'approval is not in a decidable state') {
    super(message);
    this.name = 'ApprovalStateConflictError';
  }
}

export interface RequestApprovalInput {
  readonly caseId: string;
  readonly planId: string;
  readonly expectedCaseVersion: number;
  readonly expectedPlanVersion: number;
  readonly reason?: string | null;
  readonly requesterId: string;
}

export async function requestApproval(
  db: Database,
  ctx: TenantContext,
  input: RequestApprovalInput,
): Promise<ApprovalRecord> {
  let basisHash: string | null = null;
  try {
    return await db.transaction(async (tx) => {
      await lockControlLoopCase(tx, ctx, input.caseId);
      const requester = await authorizeTenantActorForUpdate(tx, ctx, input.requesterId, [
        'case_manager',
      ]);
      const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
      const basis = await rebuildDecisionBasis(
        tx,
        ctx,
        { caseId: input.caseId, planId: input.planId },
        expiresAt,
      );
      if (!basis) {
        throw new ApprovalPreconditionError('plan/policy/investigation state is incomplete');
      }
      if (
        basis.case_version !== input.expectedCaseVersion ||
        basis.plan_version !== input.expectedPlanVersion
      ) {
        throw new ApprovalStaleError();
      }
      const planRows = await tx
        .select({ status: plansTable.status })
        .from(plansTable)
        .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, input.planId)))
        .limit(1);
      if (planRows[0]?.status !== 'APPROVAL_REQUIRED') {
        throw new ApprovalPreconditionError('plan is not in APPROVAL_REQUIRED status');
      }
      const hash = computeDecisionBasisHash(basis);
      basisHash = hash;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|approval|${hash}`}, 0))`,
      );
      const existing = await tx
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.tenantId, ctx.tenantId),
            eq(approvalsTable.decisionBasisHash, hash),
            eq(approvalsTable.state, 'REQUESTED'),
          ),
        )
        .limit(1);
      if (existing[0]) return toApprovalRecord(existing[0]);

      const id = `approval_${randomUUID()}`;
      const requestedAt = new Date();
      await tx.insert(approvalsTable).values({
        id,
        tenantId: ctx.tenantId,
        caseId: input.caseId,
        planId: input.planId,
        decisionBasisHash: hash,
        decisionBasis: basis,
        requiredRole: basis.required_role,
        requesterId: requester.userId,
        reason: input.reason ?? null,
        state: 'REQUESTED',
        requestedAt,
        expiresAt: new Date(expiresAt),
        version: 0,
      });
      await tx.insert(auditEntries).values({
        id: `audit_${randomUUID()}`,
        tenantId: ctx.tenantId,
        artifactType: 'APPROVAL',
        artifactId: id,
        artifactHash: hash,
        actorId: requester.userId,
        actorRole: 'case_manager',
        details: {
          operation: 'approval_requested',
          case_id: input.caseId,
          plan_id: input.planId,
          resource_version: 0,
        },
      });
      const inserted = await loadApproval(tx, ctx, id);
      return toApprovalRecord(inserted!);
    });
  } catch (error) {
    if (basisHash && isUniqueViolation(error, 'approvals_effective_basis_uq')) {
      const existing = await db
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.tenantId, ctx.tenantId),
            eq(approvalsTable.decisionBasisHash, basisHash),
            eq(approvalsTable.state, 'REQUESTED'),
          ),
        )
        .limit(1);
      if (existing[0]) return toApprovalRecord(existing[0]);
    }
    throw error;
  }
}

async function loadApproval(db: DbExecutor, ctx: TenantContext, approvalId: string) {
  const rows = await db
    .select()
    .from(approvalsTable)
    .where(and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.id, approvalId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface DecideApprovalInput {
  readonly caseId: string;
  readonly approvalId: string;
  readonly decisionBasisHash: string;
  readonly decision: 'approve' | 'reject' | 'request_more_evidence';
  readonly reason?: string | null;
  readonly approverId: string;
}

export async function decideApproval(
  db: Database,
  ctx: TenantContext,
  input: DecideApprovalInput,
): Promise<ApprovalRecord> {
  if (input.decision !== 'approve' && !input.reason) {
    throw new ApprovalPreconditionError('a reason is required for this approval decision');
  }
  const outcome = await db.transaction(async (tx) => {
    await lockControlLoopCase(tx, ctx, input.caseId);
    await tx.execute(
      sql`select id from approvals where tenant_id = ${ctx.tenantId} and id = ${input.approvalId} for update`,
    );
    const approval = await loadApproval(tx, ctx, input.approvalId);
    if (!approval || approval.caseId !== input.caseId) throw new ApprovalNotFoundError();

    const approver = await authorizeTenantActorForUpdate(tx, ctx, input.approverId, [
      'finance_approver',
    ]);
    assertHasAnyRole(approver.roles, [approval.requiredRole as Role]);
    if (approval.state !== 'REQUESTED') {
      return { conflict: approval.state as ApprovalState } as const;
    }
    const decidedAt = new Date();
    if (approval.expiresAt.getTime() <= decidedAt.getTime()) {
      const expired = await tx
        .update(approvalsTable)
        .set({ state: 'EXPIRED', decidedAt, version: approval.version + 1 })
        .where(
          and(
            eq(approvalsTable.tenantId, ctx.tenantId),
            eq(approvalsTable.id, approval.id),
            eq(approvalsTable.state, 'REQUESTED'),
            eq(approvalsTable.version, approval.version),
          ),
        )
        .returning();
      if (expired.length !== 1) return { conflict: 'REQUESTED' as ApprovalState } as const;
      await insertApprovalAudit(tx, ctx, expired[0]!, null, null, 'approval_expired');
      return { conflict: 'EXPIRED' as ApprovalState } as const;
    }
    if (approval.decisionBasisHash !== input.decisionBasisHash) {
      return { stale: true } as const;
    }
    if (input.decision === 'approve' && approval.requesterId === approver.userId) {
      throw new ApprovalSelfApprovalError();
    }

    const storedBasis = approval.decisionBasis as ApprovalDecisionBasis;
    const rebuilt = await rebuildDecisionBasis(
      tx,
      ctx,
      { caseId: approval.caseId, planId: approval.planId },
      storedBasis.expires_at,
    );
    if (!rebuilt || computeDecisionBasisHash(rebuilt) !== approval.decisionBasisHash) {
      const invalidated = await tx
        .update(approvalsTable)
        .set({ state: 'INVALIDATED', decidedAt, version: approval.version + 1 })
        .where(
          and(
            eq(approvalsTable.tenantId, ctx.tenantId),
            eq(approvalsTable.id, approval.id),
            eq(approvalsTable.state, 'REQUESTED'),
            eq(approvalsTable.version, approval.version),
          ),
        )
        .returning();
      if (invalidated.length !== 1) return { conflict: 'REQUESTED' as ApprovalState } as const;
      await insertApprovalAudit(tx, ctx, invalidated[0]!, null, null, 'approval_invalidated');
      return { stale: true } as const;
    }

    const targetState = input.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    assertApprovalTransition(approval.state as ApprovalState, targetState);
    const updated = await tx
      .update(approvalsTable)
      .set({
        state: targetState,
        approverId: approver.userId,
        decision: input.decision,
        reason: input.reason ?? null,
        decidedAt,
        version: approval.version + 1,
      })
      .where(
        and(
          eq(approvalsTable.tenantId, ctx.tenantId),
          eq(approvalsTable.id, approval.id),
          eq(approvalsTable.state, 'REQUESTED'),
          eq(approvalsTable.version, approval.version),
        ),
      )
      .returning();
    if (updated.length !== 1) return { conflict: 'REQUESTED' as ApprovalState } as const;
    await insertApprovalAudit(
      tx,
      ctx,
      updated[0]!,
      approver.userId,
      approval.requiredRole,
      'approval_decided',
      { decision: input.decision, reason: input.reason ?? null },
    );

    if (targetState === 'APPROVED') {
      const planUpdated = await tx
        .update(plansTable)
        .set({ status: 'AUTHORIZED' })
        .where(
          and(
            eq(plansTable.tenantId, ctx.tenantId),
            eq(plansTable.id, approval.planId),
            eq(plansTable.status, 'APPROVAL_REQUIRED'),
            eq(plansTable.version, storedBasis.plan_version),
          ),
        )
        .returning({ id: plansTable.id });
      if (planUpdated.length !== 1) throw new ApprovalStaleError();
    } else {
      const caseRows = await tx
        .select({ lifecycleState: cases.lifecycleState, version: cases.version })
        .from(cases)
        .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, approval.caseId)))
        .limit(1);
      const caseRow = caseRows[0];
      if (!caseRow) throw new ApprovalNotFoundError();
      await transitionCaseInTransaction(tx, ctx, {
        caseId: approval.caseId,
        toState: input.decision === 'request_more_evidence' ? 'abstained' : 'rejected',
        reason: `approval_decision:${input.decision}`,
        expectedVersion: caseRow.version,
        actorId: approver.userId,
        actorRole: approval.requiredRole,
      });
    }
    return { record: toApprovalRecord(updated[0]!) } as const;
  });

  if ('record' in outcome && outcome.record) return outcome.record;
  if ('stale' in outcome) throw new ApprovalStaleError();
  throw new ApprovalStateConflictError(`approval is ${outcome.conflict}`);
}

async function insertApprovalAudit(
  db: DbExecutor,
  ctx: TenantContext,
  approval: typeof approvalsTable.$inferSelect,
  actorId: string | null,
  actorRole: string | null,
  operation: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEntries).values({
    id: `audit_${randomUUID()}`,
    tenantId: ctx.tenantId,
    artifactType: 'APPROVAL',
    artifactId: approval.id,
    artifactHash: approval.decisionBasisHash,
    actorId,
    actorRole,
    details: { operation, resource_version: approval.version, ...details },
  });
}

/** Atomically expire and audit one approval if its persisted TTL has elapsed. */
async function expireApprovalIfPast(
  db: Database,
  ctx: TenantContext,
  approvalId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from approvals where tenant_id = ${ctx.tenantId} and id = ${approvalId} for update`,
    );
    const approval = await loadApproval(tx, ctx, approvalId);
    if (!approval || approval.state !== 'REQUESTED' || approval.expiresAt.getTime() > Date.now()) {
      return;
    }
    const decidedAt = new Date();
    const updated = await tx
      .update(approvalsTable)
      .set({ state: 'EXPIRED', decidedAt, version: approval.version + 1 })
      .where(
        and(
          eq(approvalsTable.tenantId, ctx.tenantId),
          eq(approvalsTable.id, approval.id),
          eq(approvalsTable.state, 'REQUESTED'),
          eq(approvalsTable.version, approval.version),
        ),
      )
      .returning();
    if (updated[0]) {
      await insertApprovalAudit(tx, ctx, updated[0], null, null, 'approval_expired');
    }
  });
}

export async function getApprovalById(
  db: Database,
  ctx: TenantContext,
  approvalId: string,
): Promise<ApprovalRecord | null> {
  const approval = await loadApproval(db, ctx, approvalId);
  if (!approval) return null;
  await expireApprovalIfPast(db, ctx, approval.id);
  const fresh = await loadApproval(db, ctx, approvalId);
  return fresh ? toApprovalRecord(fresh) : null;
}

export async function getCurrentApprovalForPlan(
  db: Database,
  ctx: TenantContext,
  planId: string,
): Promise<ApprovalRecord | null> {
  const rows = await db
    .select()
    .from(approvalsTable)
    .where(and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.planId, planId)))
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await expireApprovalIfPast(db, ctx, row.id);
  const fresh = await loadApproval(db, ctx, row.id);
  return fresh ? toApprovalRecord(fresh) : null;
}

export interface ListApprovalsFilter {
  readonly state?: ApprovalState;
  readonly caseId?: string;
  readonly cursor?: string;
  readonly limit: number;
}
export interface ApprovalListPage {
  readonly items: readonly {
    readonly approval: ApprovalRecord;
    readonly caseId: string;
    readonly amountImpactMinor: string;
  }[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export class InvalidApprovalCursorError extends Error {
  constructor() {
    super('invalid approval cursor');
    this.name = 'InvalidApprovalCursorError';
  }
}

export async function listApprovals(
  db: Database,
  ctx: TenantContext,
  filter: ListApprovalsFilter,
): Promise<ApprovalListPage> {
  const conditions: SQL<unknown>[] = [eq(approvalsTable.tenantId, ctx.tenantId)];
  if (filter.state) conditions.push(eq(approvalsTable.state, filter.state));
  if (filter.caseId) conditions.push(eq(approvalsTable.caseId, filter.caseId));

  let cursorDate: Date | null = null;
  let cursorId: string | null = null;
  if (filter.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(filter.cursor)) throw new Error();
      const parsed = JSON.parse(Buffer.from(filter.cursor, 'base64url').toString('utf8')) as {
        time?: string;
        id?: string;
      };
      if (!parsed.time || !parsed.id) throw new Error();
      cursorDate = new Date(parsed.time);
      if (Number.isNaN(cursorDate.getTime())) throw new Error();
      cursorId = parsed.id;
    } catch {
      throw new InvalidApprovalCursorError();
    }
  }
  if (cursorDate && cursorId) {
    const d = cursorDate;
    const i = cursorId;
    conditions.push(
      or(
        lt(approvalsTable.requestedAt, d),
        and(eq(approvalsTable.requestedAt, d), gt(approvalsTable.id, i)),
      )!,
    );
  }

  const rows = await db
    .select({ approval: approvalsTable, planAmount: plansTable.maximumAmountImpactMinor })
    .from(approvalsTable)
    .innerJoin(
      plansTable,
      and(
        eq(plansTable.tenantId, approvalsTable.tenantId),
        eq(plansTable.id, approvalsTable.planId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(approvalsTable.requestedAt), asc(approvalsTable.id))
    .limit(filter.limit + 1);

  for (const row of rows) await expireApprovalIfPast(db, ctx, row.approval.id);

  const refreshedRows = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      approval: (await loadApproval(db, ctx, row.approval.id))!,
    })),
  );

  const page = refreshedRows.slice(0, filter.limit);
  const hasMore = refreshedRows.length > filter.limit;
  const last = page.at(-1)?.approval;
  return {
    items: page.map((row) => ({
      approval: toApprovalRecord(row.approval),
      caseId: row.approval.caseId,
      amountImpactMinor: row.planAmount.toString(),
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ time: last.requestedAt.toISOString(), id: last.id }),
            'utf8',
          ).toString('base64url')
        : null,
  };
}

/** Persisted optimistic-concurrency version for API mutation envelopes. */
export async function getApprovalResourceVersion(
  db: Database,
  ctx: TenantContext,
  approvalId: string,
): Promise<number | null> {
  const rows = await db
    .select({ version: approvalsTable.version })
    .from(approvalsTable)
    .where(and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.id, approvalId)))
    .limit(1);
  return rows[0]?.version ?? null;
}

/**
 * The `approvals` table has no separate "actual approver role" column — the
 * approver must have held `required_role` to pass route authorization, so
 * `required_role` doubles as the recorded approver role once decided.
 */
function toApprovalRecord(row: typeof approvalsTable.$inferSelect): ApprovalRecord {
  const base = {
    schema_version: '1.0' as const,
    approval_id: row.id,
    decision_basis_hash: row.decisionBasisHash,
    requester_id: row.requesterId,
    requested_at: row.requestedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
  };
  switch (row.state) {
    case 'REQUESTED':
      return {
        ...base,
        state: 'REQUESTED',
        approver_id: null,
        approver_role: null,
        decision: null,
        reason: row.reason,
        decided_at: null,
      };
    case 'APPROVED':
      return {
        ...base,
        state: 'APPROVED',
        approver_id: row.approverId!,
        approver_role: row.requiredRole as ApprovalRecord['approver_role'] & string,
        decision: 'approve',
        reason: row.reason,
        decided_at: row.decidedAt!.toISOString(),
      };
    case 'REJECTED':
      return {
        ...base,
        state: 'REJECTED',
        approver_id: row.approverId!,
        approver_role: row.requiredRole as ApprovalRecord['approver_role'] & string,
        decision: row.decision as 'reject' | 'request_more_evidence',
        reason: row.reason!,
        decided_at: row.decidedAt!.toISOString(),
      };
    case 'EXPIRED':
    case 'INVALIDATED':
      if (!row.decidedAt) throw new Error('terminal approval is missing decided_at');
      return {
        ...base,
        state: row.state,
        approver_id: null,
        approver_role: null,
        decision: null,
        reason: row.reason,
        decided_at: row.decidedAt.toISOString(),
      };
    default:
      throw new Error(`unknown approval state: ${row.state}`);
  }
}
