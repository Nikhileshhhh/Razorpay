import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
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
import {
  assertCaseLifecycleTransition,
  type CaseLifecycleState,
} from '../../domain/state-machines/case-lifecycle.js';

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
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  const basis = await rebuildDecisionBasis(
    db,
    ctx,
    { caseId: input.caseId, planId: input.planId },
    expiresAt,
  );
  if (!basis) throw new ApprovalPreconditionError('plan/policy/investigation state is incomplete');
  if (
    basis.case_version !== input.expectedCaseVersion ||
    basis.plan_version !== input.expectedPlanVersion
  ) {
    throw new ApprovalStaleError();
  }

  const planRows = await db
    .select({ status: plansTable.status })
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, input.planId)))
    .limit(1);
  if (planRows[0]?.status !== 'APPROVAL_REQUIRED') {
    throw new ApprovalPreconditionError('plan is not in APPROVAL_REQUIRED status');
  }

  const hash = computeDecisionBasisHash(basis);

  const existing = await db
    .select()
    .from(approvalsTable)
    .where(
      and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.decisionBasisHash, hash)),
    )
    .limit(1);
  if (existing[0]) return toApprovalRecord(existing[0]);

  const id = `approval_${randomUUID()}`;
  const requestedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(approvalsTable).values({
      id,
      tenantId: ctx.tenantId,
      caseId: input.caseId,
      planId: input.planId,
      decisionBasisHash: hash,
      decisionBasis: basis,
      requiredRole: basis.required_role,
      requesterId: input.requesterId,
      state: 'REQUESTED',
      requestedAt,
      expiresAt: new Date(expiresAt),
    });
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'APPROVAL',
      artifactId: id,
      artifactHash: hash,
      actorId: input.requesterId,
      actorRole: 'case_manager',
      details: { operation: 'approval_requested', case_id: input.caseId, plan_id: input.planId },
    });
  });

  return {
    schema_version: '1.0',
    approval_id: id,
    decision_basis_hash: hash,
    requester_id: input.requesterId,
    requested_at: requestedAt.toISOString(),
    expires_at: expiresAt,
    state: 'REQUESTED',
    approver_id: null,
    approver_role: null,
    decision: null,
    reason: input.reason ?? null,
    decided_at: null,
  };
}

async function loadApproval(db: Database, ctx: TenantContext, approvalId: string) {
  const rows = await db
    .select()
    .from(approvalsTable)
    .where(and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.id, approvalId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Lazily expire a REQUESTED approval whose TTL has passed. */
async function expireIfPast(
  db: Database,
  ctx: TenantContext,
  approval: NonNullable<Awaited<ReturnType<typeof loadApproval>>>,
): Promise<ApprovalState> {
  if (approval.state !== 'REQUESTED' || approval.expiresAt.getTime() > Date.now()) {
    return approval.state as ApprovalState;
  }
  await db
    .update(approvalsTable)
    .set({ state: 'EXPIRED', decidedAt: new Date() })
    .where(
      and(
        eq(approvalsTable.tenantId, ctx.tenantId),
        eq(approvalsTable.id, approval.id),
        eq(approvalsTable.state, 'REQUESTED'),
      ),
    );
  return 'EXPIRED';
}

export interface DecideApprovalInput {
  readonly caseId: string;
  readonly approvalId: string;
  readonly decisionBasisHash: string;
  readonly decision: 'approve' | 'reject' | 'request_more_evidence';
  readonly reason?: string | null;
  readonly approverId: string;
  readonly approverRole: string;
}

export async function decideApproval(
  db: Database,
  ctx: TenantContext,
  input: DecideApprovalInput,
): Promise<ApprovalRecord> {
  const approval = await loadApproval(db, ctx, input.approvalId);
  if (!approval || approval.caseId !== input.caseId) throw new ApprovalNotFoundError();

  const liveState = await expireIfPast(db, ctx, approval);
  if (liveState !== 'REQUESTED') throw new ApprovalStateConflictError(`approval is ${liveState}`);
  if (approval.decisionBasisHash !== input.decisionBasisHash) throw new ApprovalStaleError();
  if (input.decision === 'approve' && approval.requesterId === input.approverId) {
    throw new ApprovalSelfApprovalError();
  }

  const storedBasis = approval.decisionBasis as ApprovalDecisionBasis;
  const rebuilt = await rebuildDecisionBasis(
    db,
    ctx,
    { caseId: approval.caseId, planId: approval.planId },
    storedBasis.expires_at,
  );
  if (!rebuilt || computeDecisionBasisHash(rebuilt) !== approval.decisionBasisHash) {
    await db
      .update(approvalsTable)
      .set({ state: 'INVALIDATED', decidedAt: new Date() })
      .where(
        and(
          eq(approvalsTable.tenantId, ctx.tenantId),
          eq(approvalsTable.id, approval.id),
          eq(approvalsTable.state, 'REQUESTED'),
        ),
      );
    throw new ApprovalStaleError();
  }

  const targetState = input.decision === 'approve' ? 'APPROVED' : 'REJECTED';
  assertApprovalTransition(approval.state as ApprovalState, targetState);

  const decidedAt = new Date();
  const updated = await db
    .update(approvalsTable)
    .set({
      state: targetState,
      approverId: input.approverId,
      decision: input.decision,
      reason: input.reason ?? null,
      decidedAt,
    })
    .where(
      and(
        eq(approvalsTable.tenantId, ctx.tenantId),
        eq(approvalsTable.id, approval.id),
        eq(approvalsTable.state, 'REQUESTED'),
      ),
    )
    .returning({ id: approvalsTable.id });
  if (updated.length !== 1)
    throw new ApprovalStateConflictError('approval was decided concurrently');

  await db.insert(auditEntries).values({
    id: `audit_${randomUUID()}`,
    tenantId: ctx.tenantId,
    artifactType: 'APPROVAL',
    artifactId: approval.id,
    artifactHash: approval.decisionBasisHash,
    actorId: input.approverId,
    actorRole: input.approverRole,
    details: {
      operation: 'approval_decided',
      decision: input.decision,
      reason: input.reason ?? null,
    },
  });

  if (targetState === 'APPROVED') {
    const planRows = await db
      .select({ status: plansTable.status, version: plansTable.version })
      .from(plansTable)
      .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, approval.planId)))
      .limit(1);
    if (planRows[0]) {
      // Deliberately does NOT bump `plan.version`: `plan_version` is one of
      // the 17 decision-basis fields the approval was granted against, and
      // action reservation must be able to rebuild that SAME basis and match
      // it against this approval afterward. Bumping it here would make every
      // approval instantly stale against its own resulting authorization.
      await db
        .update(plansTable)
        .set({ status: 'AUTHORIZED' })
        .where(
          and(
            eq(plansTable.tenantId, ctx.tenantId),
            eq(plansTable.id, approval.planId),
            eq(plansTable.version, planRows[0].version),
          ),
        );
    }
  }

  // APPROVE deliberately does NOT transition the case here: `case_version` is
  // one of the 17 decision-basis fields this SAME approval was just granted
  // against, and action reservation must rebuild-and-compare that identical
  // basis afterward (backend PRD §12.4). Bumping case_version as a direct side
  // effect of granting the approval would make every approval permanently
  // stale the instant it is issued. `reserveAction` performs the
  // `approval_required -> approved -> executing` chain atomically instead,
  // AFTER the basis comparison has already succeeded. REJECT and
  // REQUEST_MORE_EVIDENCE are terminal for this cycle (no later execute needs
  // this basis to stay stable), so they transition the case immediately.
  const caseTargetState = targetState === 'APPROVED' ? 'approved' : 'rejected';
  const caseRows = await db
    .select({ lifecycleState: cases.lifecycleState, version: cases.version })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, approval.caseId)))
    .limit(1);
  if (
    targetState !== 'APPROVED' &&
    caseRows[0] &&
    caseRows[0].lifecycleState !== caseTargetState &&
    (caseRows[0].lifecycleState === 'approval_required' || input.decision !== 'approve')
  ) {
    try {
      const targetCaseState: CaseLifecycleState =
        input.decision === 'request_more_evidence'
          ? 'abstained'
          : (caseTargetState as CaseLifecycleState);
      assertCaseLifecycleTransition(
        caseRows[0].lifecycleState as CaseLifecycleState,
        targetCaseState,
      );
      await db
        .update(cases)
        .set({ lifecycleState: targetCaseState, version: caseRows[0].version + 1 })
        .where(
          and(
            eq(cases.tenantId, ctx.tenantId),
            eq(cases.id, approval.caseId),
            eq(cases.version, caseRows[0].version),
          ),
        );
    } catch {
      // A raced/forbidden case transition never rolls back the already
      // committed, append-only approval decision.
    }
  }

  const fresh = await loadApproval(db, ctx, approval.id);
  return toApprovalRecord(fresh!);
}

export async function getApprovalById(
  db: Database,
  ctx: TenantContext,
  approvalId: string,
): Promise<ApprovalRecord | null> {
  const approval = await loadApproval(db, ctx, approvalId);
  if (!approval) return null;
  await expireIfPast(db, ctx, approval);
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
  await expireIfPast(db, ctx, row);
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

  for (const row of rows) await expireIfPast(db, ctx, row.approval);

  const page = rows.slice(0, filter.limit);
  const hasMore = rows.length > filter.limit;
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
      return {
        ...base,
        state: row.state,
        approver_id: null,
        approver_role: null,
        decision: null,
        reason: row.reason,
        decided_at: (row.decidedAt ?? new Date()).toISOString(),
      };
    default:
      throw new Error(`unknown approval state: ${row.state}`);
  }
}
