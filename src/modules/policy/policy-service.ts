import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database, DatabaseTransaction, DbExecutor } from '../../config/db.js';
import {
  approvals as approvalsTable,
  auditEntries,
  cases,
  financialOutcomes,
  plans as plansTable,
  policyDecisions,
} from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type {
  PolicyDecisionRecord,
  PolicyInputProjection,
  ReconciliationState,
} from '../../contracts/policy.js';
import type { CustomerImpact } from '../../contracts/common/roles.js';
import { evaluatePolicy } from './policy-engine.js';
import { ensurePolicyBundleExists, POLICY_BUNDLE_VERSION } from './policy-bundle.js';
import { PlanNotFoundError, toPlanRow, type PlanRow } from './plan-service.js';
import { lockControlLoopCase, transitionCaseInTransaction } from '../cases/case-service.js';
import { authorizeTenantActorForUpdate } from '../identity/identity-repository.js';
import {
  persistedApplicationActorId,
  projectApplicationActor,
  resolvedUserApplicationActor,
  type ApplicationActor,
} from '../identity/application-actor.js';

export class PolicyPlanVersionConflictError extends Error {
  constructor(planId: string, expected: number, actual: number) {
    super(`plan ${planId} version conflict: expected ${expected}, actual ${actual}`);
    this.name = 'PolicyPlanVersionConflictError';
  }
}

export interface EvaluatePolicyInput {
  readonly caseId: string;
  readonly planId: string;
  readonly expectedPlanVersion: number;
  readonly actorId: string;
}

export interface EvaluatePolicyResult {
  readonly record: PolicyDecisionRecord;
  readonly plan: PlanRow;
}

export type EvaluatePolicyInTransactionInput = Omit<EvaluatePolicyInput, 'actorId'>;

function classifyCustomerImpact(exposureAmountMinor: bigint): CustomerImpact {
  if (exposureAmountMinor <= 0n) return 'none';
  if (exposureAmountMinor < 100_000n) return 'low';
  if (exposureAmountMinor < 10_000_000n) return 'medium';
  return 'high';
}

/**
 * Evaluate the exact structured default-deny policy for a case's current plan
 * (backend PRD §12.2). Persists the exact input, its canonical hash, matched
 * rules, decision, reason codes, bundle version, and actor context — then
 * advances the (immutable-content) plan's lifecycle `status` and, for the two
 * decisions that have a documented case-lifecycle edge from
 * `recommendation_ready` (`ALLOW_AUTOMATIC` -> `executing`,
 * `REQUIRE_APPROVAL` -> `approval_required`), the case itself.
 */
export async function evaluateCasePolicyInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  input: EvaluatePolicyInTransactionInput,
  actor: ApplicationActor,
  reconciliationState: ReconciliationState | null = null,
): Promise<EvaluatePolicyResult> {
  await lockControlLoopCase(tx, ctx, input.caseId);
  const actorProjection = projectApplicationActor(actor, ctx);
  const persistedActorId = persistedApplicationActorId(actor);
  const planRows = await tx
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, input.planId)))
    .limit(1);
  const planDb = planRows[0];
  if (!planDb || planDb.caseId !== input.caseId || !planDb.isCurrent) {
    throw new PlanNotFoundError();
  }
  const plan = toPlanRow(planDb);
  if (plan.version !== input.expectedPlanVersion) {
    throw new PolicyPlanVersionConflictError(input.planId, input.expectedPlanVersion, plan.version);
  }
  const caseRows = await tx
    .select()
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
    .limit(1);
  const caseRow = caseRows[0];
  if (!caseRow) throw new PlanNotFoundError();

  const currentOutcomeRows = await tx
    .select({ version: financialOutcomes.version })
    .from(financialOutcomes)
    .where(
      and(
        eq(financialOutcomes.tenantId, ctx.tenantId),
        eq(financialOutcomes.expectationId, caseRow.expectationId),
        eq(financialOutcomes.isCurrent, true),
      ),
    )
    .limit(1);
  const currentApprovalRows = await tx
    .select({ state: approvalsTable.state })
    .from(approvalsTable)
    .where(and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.planId, input.planId)))
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(1);
  const target =
    (plan.parameters as { economic_subject?: string }).economic_subject ?? caseRow.subjectId;
  const projection: PolicyInputProjection = {
    schema_version: '1.0',
    tenant_id: ctx.tenantId,
    environment: actorProjection.environment,
    actor_id: actorProjection.actorId,
    actor_role: actorProjection.actorRole,
    action_type: plan.parameters.tool_id,
    authority_level: plan.authorityLevel,
    amount_impact:
      plan.maximumAmountImpactMinor > 0n ||
      plan.parameters.tool_id === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'
        ? {
            amount_minor: plan.maximumAmountImpactMinor.toString(),
            currency: plan.currency as 'INR',
          }
        : null,
    target,
    merchant_tier: null,
    customer_impact: classifyCustomerImpact(caseRow.exposureAmountMinor),
    evidence_coverage: caseRow.evidenceCoverage as PolicyInputProjection['evidence_coverage'],
    contradiction_count: caseRow.contradictionCount,
    case_version: caseRow.version,
    outcome_version: currentOutcomeRows[0]?.version ?? 0,
    approval_status:
      (currentApprovalRows[0]?.state as PolicyInputProjection['approval_status']) ?? null,
    policy_bundle_version: POLICY_BUNDLE_VERSION,
    reconciliation_state: reconciliationState,
  };
  const result = evaluatePolicy(projection);
  const inputHash = contentHash(projection);
  const decisionId = `policy_decision_${randomUUID()}`;
  const createdAt = new Date();

  await tx.insert(policyDecisions).values({
    id: decisionId,
    tenantId: ctx.tenantId,
    caseId: input.caseId,
    planId: input.planId,
    policyBundleVersion: POLICY_BUNDLE_VERSION,
    decision: result.decision,
    matchedRules: result.matchedRules,
    requiredRole: result.requiredRole,
    reasonCodes: result.reasonCodes,
    inputHash,
    actorId: persistedActorId,
    createdAt,
  });

  const nextPlanStatus =
    result.decision === 'ALLOW_AUTOMATIC'
      ? 'AUTHORIZED'
      : result.decision === 'REQUIRE_APPROVAL'
        ? 'APPROVAL_REQUIRED'
        : result.decision === 'DENY'
          ? 'POLICY_DENIED'
          : plan.status; // ADVISE / REQUIRE_MORE_EVIDENCE do not advance plan status
  if (nextPlanStatus !== plan.status) {
    const updated = await tx
      .update(plansTable)
      .set({ status: nextPlanStatus, version: plan.version + 1 })
      .where(
        and(
          eq(plansTable.tenantId, ctx.tenantId),
          eq(plansTable.id, input.planId),
          eq(plansTable.version, plan.version),
        ),
      )
      .returning();
    if (updated.length !== 1) {
      throw new PolicyPlanVersionConflictError(
        input.planId,
        input.expectedPlanVersion,
        input.expectedPlanVersion + 1,
      );
    }
    planRows[0] = updated[0]!;
  }

  await tx.insert(auditEntries).values({
    id: `audit_${randomUUID()}`,
    tenantId: ctx.tenantId,
    artifactType: 'POLICY_DECISION',
    artifactId: decisionId,
    artifactHash: inputHash,
    actorId: persistedActorId,
    actorRole: actorProjection.actorRole,
    policyBundleVersion: POLICY_BUNDLE_VERSION,
    details: {
      decision: result.decision,
      reason_codes: result.reasonCodes,
      case_id: input.caseId,
    },
  });
  if (result.decision === 'REQUIRE_APPROVAL' && caseRow.lifecycleState !== 'approval_required') {
    await transitionCaseInTransaction(tx, ctx, {
      caseId: input.caseId,
      toState: 'approval_required',
      reason: 'policy_decision:REQUIRE_APPROVAL',
      expectedVersion: caseRow.version,
      actorId: persistedActorId,
      actorRole: actorProjection.actorRole,
    });
  }

  const record: PolicyDecisionRecord = {
    schema_version: '1.0',
    decision_id: decisionId,
    case_id: input.caseId,
    plan_id: input.planId,
    policy_bundle_version: POLICY_BUNDLE_VERSION,
    decision: result.decision,
    matched_rules: [...result.matchedRules],
    required_role: result.requiredRole,
    reason_codes: [...result.reasonCodes],
    created_at: createdAt.toISOString(),
  };
  return { record, plan: toPlanRow(planRows[0]!) };
}

/** Public user path. It can never supply the worker or reconciliation facts. */
export async function evaluateCasePolicy(
  db: Database,
  ctx: TenantContext,
  input: EvaluatePolicyInput,
): Promise<EvaluatePolicyResult> {
  await ensurePolicyBundleExists(db);
  return db.transaction(async (tx) => {
    const identity = await authorizeTenantActorForUpdate(tx, ctx, input.actorId, ['case_manager']);
    return evaluateCasePolicyInTransaction(
      tx,
      ctx,
      {
        caseId: input.caseId,
        planId: input.planId,
        expectedPlanVersion: input.expectedPlanVersion,
      },
      resolvedUserApplicationActor(identity, 'case_manager'),
      null,
    );
  });
}

export async function getLatestPolicyDecision(
  db: DbExecutor,
  ctx: TenantContext,
  caseId: string,
): Promise<PolicyDecisionRecord | null> {
  const rows = await db
    .select()
    .from(policyDecisions)
    .where(and(eq(policyDecisions.tenantId, ctx.tenantId), eq(policyDecisions.caseId, caseId)))
    .orderBy(desc(policyDecisions.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    schema_version: '1.0',
    decision_id: row.id,
    case_id: row.caseId,
    plan_id: row.planId,
    policy_bundle_version: row.policyBundleVersion,
    decision: row.decision as PolicyDecisionRecord['decision'],
    matched_rules: row.matchedRules as string[],
    required_role: row.requiredRole as PolicyDecisionRecord['required_role'],
    reason_codes: row.reasonCodes as string[],
    created_at: row.createdAt.toISOString(),
  };
}
