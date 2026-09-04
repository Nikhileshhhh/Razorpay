import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database, DatabaseTransaction, DbExecutor } from '../../config/db.js';
import { plans as plansTable } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type {
  AuthorityLevel,
  PlanStatus,
  PlanTemplateId,
  ToolParameters,
} from '../../contracts/plans.js';
import type { Money } from '../../domain/money/money.js';
import { lockControlLoopCase } from '../cases/case-service.js';

export interface ProposePlanInput {
  readonly caseId: string;
  readonly templateId: PlanTemplateId;
  readonly parameters: ToolParameters;
  readonly authorityLevel: AuthorityLevel;
  readonly maximumAmountImpact: Money;
}

export interface PlanRow {
  readonly id: string;
  readonly tenantId: string;
  readonly caseId: string;
  readonly templateId: string;
  readonly version: number;
  readonly parameters: ToolParameters;
  readonly planHash: string;
  readonly authorityLevel: AuthorityLevel;
  readonly maximumAmountImpactMinor: bigint;
  readonly currency: string;
  readonly status: PlanStatus;
  readonly isCurrent: boolean;
}

/**
 * Propose (or idempotently reuse) the CURRENT plan for a case (backend PRD
 * §12.1, architecture §7.1 "one current selected plan per case"). Plan
 * content — template, parameters, authority level, amount impact — is
 * canonically hashed and immutable once created; only `status`/`is_current`
 * (lifecycle metadata, never content) change afterward. Re-proposing the
 * IDENTICAL content is a no-op that returns the existing row.
 */
export async function proposePlan(
  db: Database,
  ctx: TenantContext,
  input: ProposePlanInput,
): Promise<PlanRow> {
  return db.transaction(async (tx) => {
    await lockControlLoopCase(tx, ctx, input.caseId);
    return proposePlanInTransaction(tx, ctx, input);
  });
}

/** Idempotent plan proposal that joins an existing case-scoped transaction. */
export async function proposePlanInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  input: ProposePlanInput,
): Promise<PlanRow> {
  const planHash = contentHash({
    templateId: input.templateId,
    parameters: input.parameters,
    authorityLevel: input.authorityLevel,
    maximumAmountImpactMinor: input.maximumAmountImpact.amountMinor.toString(),
    currency: input.maximumAmountImpact.currency,
  });

  const demoteCurrent = () =>
    tx
      .update(plansTable)
      .set({ isCurrent: false })
      .where(
        and(
          eq(plansTable.tenantId, ctx.tenantId),
          eq(plansTable.caseId, input.caseId),
          eq(plansTable.isCurrent, true),
        ),
      );

  const existing = await tx
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.planHash, planHash)))
    .limit(1);
  if (existing[0]) {
    if (!existing[0].isCurrent) {
      await demoteCurrent();
      await tx
        .update(plansTable)
        .set({ isCurrent: true })
        .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, existing[0].id)));
    }
    return toPlanRow({ ...existing[0], isCurrent: true });
  }

  await demoteCurrent();
  const id = `plan_${randomUUID()}`;
  await tx.insert(plansTable).values({
    id,
    tenantId: ctx.tenantId,
    caseId: input.caseId,
    templateId: input.templateId,
    version: 1,
    parameters: input.parameters,
    planHash,
    authorityLevel: input.authorityLevel,
    maximumAmountImpactMinor: input.maximumAmountImpact.amountMinor,
    currency: input.maximumAmountImpact.currency,
    status: 'PROPOSED',
    isCurrent: true,
  });
  const inserted = await tx
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, id)))
    .limit(1);
  return toPlanRow(inserted[0]!);
}

export async function getCurrentPlan(
  db: DbExecutor,
  ctx: TenantContext,
  caseId: string,
): Promise<PlanRow | null> {
  const rows = await db
    .select()
    .from(plansTable)
    .where(
      and(
        eq(plansTable.tenantId, ctx.tenantId),
        eq(plansTable.caseId, caseId),
        eq(plansTable.isCurrent, true),
      ),
    )
    .limit(1);
  return rows[0] ? toPlanRow(rows[0]) : null;
}

export async function getPlanById(
  db: DbExecutor,
  ctx: TenantContext,
  planId: string,
): Promise<PlanRow | null> {
  const rows = await db
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, planId)))
    .limit(1);
  return rows[0] ? toPlanRow(rows[0]) : null;
}

export class PlanNotFoundError extends Error {
  constructor() {
    super('plan not found');
    this.name = 'PlanNotFoundError';
  }
}

export class PlanVersionConflictError extends Error {
  constructor(planId: string, expected: number, actual: number) {
    super(`plan ${planId} version conflict: expected ${expected}, actual ${actual}`);
    this.name = 'PlanVersionConflictError';
  }
}

/**
 * Advance plan `status` and bump `version` (content fields — template,
 * parameters, hash, authority, amount — are immutable after creation; `status`
 * and `version` are lifecycle metadata). The version bump gives the approval
 * decision-basis hash a real, independently-changing `plan_version` signal.
 */
export async function setPlanStatus(
  db: Database,
  ctx: TenantContext,
  planId: string,
  status: PlanStatus,
  expectedVersion: number,
): Promise<number> {
  const nextVersion = expectedVersion + 1;
  const updated = await db
    .update(plansTable)
    .set({ status, version: nextVersion })
    .where(
      and(
        eq(plansTable.tenantId, ctx.tenantId),
        eq(plansTable.id, planId),
        eq(plansTable.version, expectedVersion),
      ),
    )
    .returning({ id: plansTable.id });
  if (updated.length !== 1)
    throw new PlanVersionConflictError(planId, expectedVersion, nextVersion);
  return nextVersion;
}

export function toPlanRow(row: typeof plansTable.$inferSelect): PlanRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    caseId: row.caseId,
    templateId: row.templateId,
    version: row.version,
    parameters: row.parameters as ToolParameters,
    planHash: row.planHash,
    authorityLevel: row.authorityLevel as AuthorityLevel,
    maximumAmountImpactMinor: row.maximumAmountImpactMinor,
    currency: row.currency,
    status: row.status as PlanStatus,
    isCurrent: row.isCurrent,
  };
}
