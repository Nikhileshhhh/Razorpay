import type { PolicyDecision, PolicyInputProjection } from '../../contracts/policy.js';
import type { Role } from '../../contracts/common/roles.js';

export interface PolicyEvaluationResult {
  readonly decision: PolicyDecision;
  readonly matchedRules: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly requiredRole: Role | null;
}

const ALLOWED_ENVIRONMENTS = new Set(['demo', 'buildathon', 'test']);
const OPERATIONAL_ROLES: ReadonlySet<Role> = new Set([
  'investigator',
  'case_manager',
  'finance_approver',
  'policy_administrator',
  'platform_operator',
  'executor',
  'worker',
  'demo_operator',
]);

/**
 * Pure, deterministic, default-deny policy decision (backend PRD §12.2). Given
 * the EXACT typed {@link PolicyInputProjection}, returns exactly one decision.
 * Rules are evaluated in a FIXED order and the first match wins — there is no
 * implicit "allow" fallthrough; the final rule in the list is an exhaustive
 * deny, so every unanticipated combination denies rather than defaulting open.
 */
export function evaluatePolicy(input: PolicyInputProjection): PolicyEvaluationResult {
  if (input.authority_level === 'L4') {
    return deny(['REAL_MONEY_AUTHORITY_DENIED']);
  }

  if (input.amount_impact !== null && input.amount_impact.currency !== 'INR') {
    return deny(['CURRENCY_MISMATCH']);
  }

  if (!ALLOWED_ENVIRONMENTS.has(input.environment)) {
    return deny(['ENVIRONMENT_NOT_ALLOWED']);
  }

  if (!OPERATIONAL_ROLES.has(input.actor_role)) {
    return deny(['ACTOR_ROLE_NOT_PERMITTED']);
  }

  if (input.contradiction_count > 0) {
    return {
      decision: 'REQUIRE_MORE_EVIDENCE',
      matchedRules: ['CONTRADICTING_EVIDENCE'],
      reasonCodes: ['CONTRADICTING_EVIDENCE'],
      requiredRole: null,
    };
  }

  if (input.evidence_coverage !== 'complete') {
    return {
      decision: 'REQUIRE_MORE_EVIDENCE',
      matchedRules: ['INCOMPLETE_EVIDENCE_COVERAGE'],
      reasonCodes: ['INCOMPLETE_EVIDENCE_COVERAGE'],
      requiredRole: null,
    };
  }

  switch (input.action_type) {
    case 'SUPPRESS_SIMULATED_RECOVERY':
      // No approval gate, but the decision basis still names the role
      // authorized to invoke `execute` directly (backend PRD §14.1 minimum
      // role `executor`) so the basis hash remains well-formed even for an
      // automatic plan.
      return {
        decision: 'ALLOW_AUTOMATIC',
        matchedRules: ['COMPLETE_DUPLICATE_RECOVERY_EVIDENCE'],
        reasonCodes: ['COMPLETE_DUPLICATE_RECOVERY_EVIDENCE'],
        requiredRole: 'executor',
      };
    case 'SIMULATE_TRANSFER_REMEDIATION':
      return {
        decision: 'REQUIRE_APPROVAL',
        matchedRules: ['TRANSFER_REMEDIATION_REQUIRES_APPROVAL'],
        reasonCodes: ['TRANSFER_REMEDIATION_REQUIRES_APPROVAL'],
        requiredRole: 'finance_approver',
      };
    case 'REQUEST_MORE_EVIDENCE':
      return {
        decision: 'ADVISE',
        matchedRules: ['INFORMATIONAL_TOOL'],
        reasonCodes: ['INFORMATIONAL_TOOL'],
        requiredRole: null,
      };
    case 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION':
      // Registered as a tool (policy/action allowlist), but its dispatch is
      // Gate B4's reconciliation-triggered closure. Default-deny rather than
      // fake availability B3 does not yet provide.
      return deny(['RECONCILIATION_CLOSURE_NOT_YET_AVAILABLE']);
    default:
      // Unreachable given ToolActionId's exhaustive enum; kept as the
      // structural default-deny fallback the PRD requires.
      return deny(['UNREGISTERED_ACTION']);
  }
}

function deny(reasonCodes: readonly string[]): PolicyEvaluationResult {
  return { decision: 'DENY', matchedRules: reasonCodes, reasonCodes, requiredRole: null };
}
