import type { Database } from '../../config/db.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { ControlLoopCommand, ControlLoopView } from '../../contracts/api-endpoints.js';
import type { Plan } from '../../contracts/plans.js';
import { getCase } from './case-service.js';
import { getLatestInvestigation } from '../investigation/investigation-repository.js';
import { getCurrentPlan, type PlanRow } from '../policy/plan-service.js';
import { getLatestPolicyDecision } from '../policy/policy-service.js';
import { getCurrentApprovalForPlan } from '../approvals/approval-service.js';
import { getCurrentActionForCase } from '../actions/action-service.js';
import {
  computeDecisionBasisHash,
  rebuildDecisionBasis,
  resolveBasisExpiry,
} from '../approvals/decision-basis.js';

function planRowToContract(plan: PlanRow): Plan {
  return {
    schema_version: '1.0',
    plan_id: plan.id,
    case_id: plan.caseId,
    template_id: plan.templateId,
    version: plan.version,
    parameters: plan.parameters,
    plan_hash: plan.planHash,
    authority_level: plan.authorityLevel,
    maximum_amount_impact: {
      amount_minor: plan.maximumAmountImpactMinor.toString(),
      currency: plan.currency as 'INR',
    },
    status: plan.status,
  } as Plan;
}

/**
 * Real persisted control-loop summary (backend PRD §14.2): current finding/
 * abstention, plan, policy, approval, action, and the commands genuinely
 * valid to invoke next given live state — never a UI-only hard-coded copy.
 */
export async function buildControlLoopView(
  db: Database,
  ctx: TenantContext,
  caseId: string,
): Promise<ControlLoopView | null> {
  const caseRow = await getCase(db, ctx, caseId);
  if (!caseRow) return null;

  const investigation = await getLatestInvestigation(db, ctx, caseId);
  const plan = await getCurrentPlan(db, ctx, caseId);
  const policyDecision = plan ? await getLatestPolicyDecision(db, ctx, caseId) : null;
  const approval = plan ? await getCurrentApprovalForPlan(db, ctx, plan.id) : null;
  const action = await getCurrentActionForCase(db, ctx, caseId);

  let currentDecisionBasisHash: string | null = null;
  if (plan && policyDecision) {
    const expiresAt = await resolveBasisExpiry(db, ctx, plan.id);
    const rebuilt = await rebuildDecisionBasis(db, ctx, { caseId, planId: plan.id }, expiresAt);
    currentDecisionBasisHash = rebuilt ? computeDecisionBasisHash(rebuilt) : null;
  }

  const allowedNextCommands: ControlLoopCommand[] = [];
  if (!action) {
    if (!investigation && ['candidate', 'open', 'abstained'].includes(caseRow.lifecycleState)) {
      allowedNextCommands.push('request_investigation');
    } else if (plan?.status === 'PROPOSED') {
      allowedNextCommands.push('evaluate_policy');
    } else if (plan?.status === 'APPROVAL_REQUIRED') {
      if (approval?.state === 'REQUESTED') {
        allowedNextCommands.push('approve', 'reject', 'request_more_evidence');
      } else {
        allowedNextCommands.push('request_approval');
      }
    } else if (plan?.status === 'AUTHORIZED' && currentDecisionBasisHash) {
      allowedNextCommands.push('execute');
    }
  }

  return {
    schema_version: '1.0',
    case_id: caseId,
    finding: investigation?.finding ?? null,
    abstention_reason: investigation?.abstentionReason ?? null,
    plan: plan ? planRowToContract(plan) : null,
    policy_decision: policyDecision,
    current_decision_basis_hash: currentDecisionBasisHash,
    approval,
    action,
    allowed_next_commands: allowedNextCommands,
  };
}
