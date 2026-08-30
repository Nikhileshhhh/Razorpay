import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import { CaseId, OpaqueId, PlanId } from './common/identifiers.js';
import { Money } from './common/money.js';
import { CustomerImpact, Role, RuntimeEnvironment } from './common/roles.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ContractVersion, ResourceVersion, SchemaVersion } from './common/versions.js';
import { EvidenceCoverage } from './cases.js';
import { AuthorityLevel, ToolActionId } from './plans.js';
import { ApprovalState } from './approvals.js';

/**
 * Deterministic default-deny policy contracts (FR-POL, handoff §13).
 *
 * `PolicyInputProjection` is the EXACT, typed set of inputs a decision is made
 * from — no free-form fields. Missing input or an unregistered action denies at
 * runtime (MT-013); MT-002 defines the shapes only.
 */
/**
 * `ALLOW_AUTOMATIC` is the canonical PRD §14.2 value and is retained deliberately.
 * The MT-013 task card uses the shorthand `ALLOW`; we keep the more precise PRD
 * value and treat `ALLOW` as an alias to be normalized in MT-013, not a separate
 * decision. (Resolved terminology difference — recorded, not silently ignored.)
 */
export const PolicyDecision = z.enum([
  'ALLOW_AUTOMATIC',
  'REQUIRE_APPROVAL',
  'ADVISE',
  'DENY',
  'REQUIRE_MORE_EVIDENCE',
]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

/**
 * The EXACT, typed set of policy inputs (handoff §13). Every documented input is
 * a REQUIRED key. Where a value is genuinely not applicable it may be explicitly
 * `null`, but OMITTING a key rejects so a safety input can never silently vanish.
 */
export const PolicyInputProjection = z
  .object({
    schema_version: SchemaVersion,
    tenant_id: OpaqueId,
    environment: RuntimeEnvironment,
    actor_id: OpaqueId,
    actor_role: Role,
    action_type: ToolActionId,
    authority_level: AuthorityLevel,
    amount_impact: Money.nullable(),
    target: boundedString(LIMITS.TARGET_MAX),
    // Merchant-tier values are not enumerated in the docs; kept as a bounded
    // string (seed) rather than inventing an enum. Required key, nullable value.
    merchant_tier: boundedString(LIMITS.CODE_MAX).nullable(),
    customer_impact: CustomerImpact,
    evidence_coverage: EvidenceCoverage,
    contradiction_count: z.number().int().min(0),
    case_version: ResourceVersion,
    outcome_version: ResourceVersion,
    approval_status: ApprovalState.nullable(),
    policy_bundle_version: ContractVersion,
  })
  .strict();
export type PolicyInputProjection = z.infer<typeof PolicyInputProjection>;

export const PolicyDecisionRecord = z
  .object({
    schema_version: SchemaVersion,
    decision_id: OpaqueId,
    case_id: CaseId,
    plan_id: PlanId,
    policy_bundle_version: ContractVersion,
    decision: PolicyDecision,
    matched_rules: boundedArray(boundedString(LIMITS.CODE_MAX), LIMITS.RULES_MAX),
    required_role: Role.nullable(),
    reason_codes: boundedArray(boundedString(LIMITS.CODE_MAX), LIMITS.RULES_MAX),
    created_at: Rfc3339Utc,
  })
  .strict();
export type PolicyDecisionRecord = z.infer<typeof PolicyDecisionRecord>;
