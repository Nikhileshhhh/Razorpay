import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
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
import type { PolicyDecisionRecord, PolicyInputProjection } from '../../contracts/policy.js';
import type { CustomerImpact } from '../../contracts/common/roles.js';
import { evaluatePolicy } from './policy-engine.js';
import { ensurePolicyBundleExists, POLICY_BUNDLE_VERSION } from './policy-bundle.js';
import { getPlanById, PlanNotFoundError, type PlanRow } from './plan-service.js';
import { getCase } from '../cases/case-service.js';
import { assertCaseLifecycleTransition } from '../../domain/state-machines/case-lifecycle.js';

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
  readonly actorRole: string;
}

export interface EvaluatePolicyResult {
  readonly record: PolicyDecisionRecord;
  readonly plan: PlanRow;
}

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
export async function evaluateCasePolicy(
  db: Database,
  ctx: TenantContext,
  input: EvaluatePolicyInput,
): Promise<EvaluatePolicyResult> {
  await ensurePolicyBundleExists(db);

  const plan = await getPlanById(db, ctx, input.planId);
  if (!plan || plan.caseId !== input.caseId) throw new PlanNotFoundError();
  if (plan.version !== input.expectedPlanVersion) {
    throw new PolicyPlanVersionConflictError(input.planId, input.expectedPlanVersion, plan.version);
  }

  const caseRow = await getCase(db, ctx, input.caseId);
  if (!caseRow) throw new PlanNotFoundError();

  const currentOutcomeRows = await db
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

  const currentApprovalRows = await db
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
    environment: ctx.environment as PolicyInputProjection['environment'],
    actor_id: input.actorId,
    actor_role: input.actorRole as PolicyInputProjection['actor_role'],
    action_type: plan.parameters.tool_id,
    authority_level: plan.authorityLevel,
    amount_impact:
      plan.maximumAmountImpactMinor > 0n
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
  };

  const result = evaluatePolicy(projection);
  const inputHash = contentHash(projection);
  const decisionId = `policy_decision_${randomUUID()}`;
  const createdAt = new Date();

  await db.transaction(async (tx) => {
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
      actorId: input.actorId,
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
      await tx
        .update(plansTable)
        .set({ status: nextPlanStatus, version: plan.version + 1 })
        .where(
          and(
            eq(plansTable.tenantId, ctx.tenantId),
            eq(plansTable.id, input.planId),
            eq(plansTable.version, plan.version),
          ),
        );
    }

    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'POLICY_DECISION',
      artifactId: decisionId,
      artifactHash: inputHash,
      actorId: input.actorId,
      actorRole: input.actorRole,
      policyBundleVersion: POLICY_BUNDLE_VERSION,
      details: {
        decision: result.decision,
        reason_codes: result.reasonCodes,
        case_id: input.caseId,
      },
    });
  });

  const caseTargetState =
    result.decision === 'ALLOW_AUTOMATIC'
      ? 'executing'
      : result.decision === 'REQUIRE_APPROVAL'
        ? 'approval_required'
        : null;
  if (caseTargetState && caseRow.lifecycleState !== caseTargetState) {
    try {
      assertCaseLifecycleTransition(
        caseRow.lifecycleState as Parameters<typeof assertCaseLifecycleTransition>[0],
        caseTargetState,
      );
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(cases)
          .set({ lifecycleState: caseTargetState, version: caseRow.version + 1 })
          .where(
            and(
              eq(cases.tenantId, ctx.tenantId),
              eq(cases.id, input.caseId),
              eq(cases.version, caseRow.version),
            ),
          )
          .returning({ id: cases.id });
        if (updated.length === 1) {
          await tx.insert(auditEntries).values({
            id: `audit_${randomUUID()}`,
            tenantId: ctx.tenantId,
            artifactType: 'CASE_TRANSITION',
            artifactId: input.caseId,
            actorId: input.actorId,
            actorRole: input.actorRole,
            details: {
              from_state: caseRow.lifecycleState,
              to_state: caseTargetState,
              reason: `policy_decision:${result.decision}`,
            },
          });
        }
      });
    } catch {
      // A forbidden/raced case transition never blocks the (already
      // committed) policy decision itself — it is the authoritative,
      // append-only record either way.
    }
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

  const updatedPlan = await getPlanById(db, ctx, input.planId);
  return { record, plan: updatedPlan! };
}

export async function getLatestPolicyDecision(
  db: Database,
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
