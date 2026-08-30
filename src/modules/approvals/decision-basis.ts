import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  approvals as approvalsTable,
  cases,
  investigations,
  plans as plansTable,
  policyDecisions,
} from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { ApprovalDecisionBasis } from '../../contracts/approvals.js';
import type { ToolActionId } from '../../contracts/plans.js';
import { DECISION_BASIS_FIELDS } from '../../domain/state-machines/approval.js';
import { POLICY_BUNDLE_VERSION } from '../policy/policy-bundle.js';

/**
 * Verification-contract key/version each tool binds to (backend PRD §12.3):
 * the decision basis must name a `verification_contract_key`/`version` even
 * though the actual `verification_contracts` rows are Gate B4 work — these
 * are the stable identifiers B4 will seed under.
 */
export const VERIFICATION_CONTRACT_BY_TOOL: Record<
  ToolActionId,
  { readonly key: string; readonly version: string }
> = {
  SIMULATE_TRANSFER_REMEDIATION: { key: 'TRANSFER_REMEDIATION_VERIFICATION', version: 'v1' },
  SUPPRESS_SIMULATED_RECOVERY: { key: 'SUPPRESS_RECOVERY_VERIFICATION', version: 'v1' },
  REQUEST_MORE_EVIDENCE: { key: 'NO_EFFECT_VERIFICATION', version: 'v1' },
  CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION: {
    key: 'RECEIVABLE_CLOSURE_VERIFICATION',
    version: 'v1',
  },
};

/** Fixed approval time-to-live (backend PRD §12.3 "expiring"). */
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

/**
 * Canonical `decision_basis_hash` (architecture §9.4, backend PRD §12.3):
 * `SHA256(canonical_json(ApprovalDecisionBasis))`. {@link DECISION_BASIS_FIELDS}
 * (owned by the domain state-machine module, Gate B1) is the single shared
 * definition of "every hashed field" — this module and its tests reuse it so
 * the two can never silently drift apart.
 */
export function computeDecisionBasisHash(basis: ApprovalDecisionBasis): string {
  const canonical: Record<string, unknown> = {};
  for (const field of DECISION_BASIS_FIELDS) canonical[field] = basis[field];
  return contentHash(canonical);
}

/** Field-by-field diff — used by invalidation checks and adversarial tests. */
export function changedBasisFields(
  previous: ApprovalDecisionBasis,
  current: ApprovalDecisionBasis,
): string[] {
  return DECISION_BASIS_FIELDS.filter((field) => previous[field] !== current[field]);
}

export interface LiveBasisInputs {
  readonly caseId: string;
  readonly planId: string;
}

/**
 * A plan with NO approval (`ALLOW_AUTOMATIC`) has no expiring approval window,
 * so its decision basis uses this fixed, deterministic sentinel instead of a
 * "now + TTL" value that would make the hash unstable between when a client
 * reads it (e.g. `control-loop`) and when it submits `execute`.
 */
export const AUTOMATIC_PLAN_BASIS_EXPIRY = '9999-12-31T23:59:59.000Z';

/**
 * The `expires_at` a fresh basis rebuild should use for this plan RIGHT NOW:
 * the most recent approval's stored expiry if one exists, otherwise the fixed
 * non-expiring sentinel for an automatic plan. Both the control-loop read
 * model and action reservation call this so they always compute the SAME hash
 * for the SAME live state.
 */
export async function resolveBasisExpiry(
  db: Database,
  ctx: TenantContext,
  planId: string,
): Promise<string> {
  const rows = await db
    .select({ expiresAt: approvalsTable.expiresAt })
    .from(approvalsTable)
    .where(and(eq(approvalsTable.tenantId, ctx.tenantId), eq(approvalsTable.planId, planId)))
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(1);
  return rows[0] ? rows[0].expiresAt.toISOString() : AUTOMATIC_PLAN_BASIS_EXPIRY;
}

/**
 * Rebuild the decision basis from LIVE state (backend PRD §12.3, architecture
 * §9.4). Shared by approval request/decide (approvals module) AND action
 * reservation (actions module, which MUST "rebuild and compare the basis in
 * the same transaction" per §12.4) — one definition of "current basis" for
 * both. Returns `null` when the case/plan/investigation/policy state needed
 * to build a complete basis does not yet exist.
 */
export async function rebuildDecisionBasis(
  db: Database,
  ctx: TenantContext,
  input: LiveBasisInputs,
  expiresAt: string,
): Promise<ApprovalDecisionBasis | null> {
  const planRows = await db
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.tenantId, ctx.tenantId), eq(plansTable.id, input.planId)))
    .limit(1);
  const plan = planRows[0];
  if (!plan || plan.caseId !== input.caseId) return null;

  const caseRows = await db
    .select({ version: cases.version })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
    .limit(1);
  const caseRow = caseRows[0];
  if (!caseRow) return null;

  const investigationRows = await db
    .select({ evidenceSetHash: investigations.evidenceSetHash })
    .from(investigations)
    .where(and(eq(investigations.tenantId, ctx.tenantId), eq(investigations.caseId, input.caseId)))
    .orderBy(desc(investigations.createdAt))
    .limit(1);
  const evidenceSetHash = investigationRows[0]?.evidenceSetHash;
  if (!evidenceSetHash) return null;

  const policyRows = await db
    .select({ id: policyDecisions.id, requiredRole: policyDecisions.requiredRole })
    .from(policyDecisions)
    .where(
      and(eq(policyDecisions.tenantId, ctx.tenantId), eq(policyDecisions.planId, input.planId)),
    )
    .orderBy(desc(policyDecisions.createdAt))
    .limit(1);
  const policyDecision = policyRows[0];
  if (!policyDecision || !policyDecision.requiredRole) return null;

  const planParameters = plan.parameters as { tool_id: ToolActionId; economic_subject?: string };
  const toolId = planParameters.tool_id;
  const verificationContract = VERIFICATION_CONTRACT_BY_TOOL[toolId];

  return {
    schema_version: '1.0',
    tenant_id: ctx.tenantId,
    case_id: input.caseId,
    case_version: caseRow.version,
    plan_id: input.planId,
    plan_version: plan.version,
    plan_hash: plan.planHash,
    evidence_set_hash: evidenceSetHash,
    policy_bundle_version: POLICY_BUNDLE_VERSION,
    policy_decision_id: policyDecision.id,
    action_type: toolId,
    target: planParameters.economic_subject ?? plan.caseId,
    amount_impact_minor: plan.maximumAmountImpactMinor.toString(),
    currency: plan.currency as 'INR',
    verification_contract_key: verificationContract.key,
    verification_contract_version: verificationContract.version,
    required_role: policyDecision.requiredRole as ApprovalDecisionBasis['required_role'],
    expires_at: expiresAt,
  };
}
