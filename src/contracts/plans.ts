import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import { CaseId, ExpectationId, OpaqueId, PlanId, Sha256Hash } from './common/identifiers.js';
import { Money } from './common/money.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';
import { EvidenceType } from './evidence.js';

/**
 * Registered plan templates and tools.
 *
 * A plan-template id and a tool/action id are DISTINCT namespaces. The Buildathon
 * tool allowlist is exactly four ids; the only documented plan template is
 * OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL, which binds ONLY to
 * SIMULATE_TRANSFER_REMEDIATION parameters (see PLAN_TEMPLATE_TOOL_MAP). There is
 * no generic HTTP/API/SQL tool and no free-form parameter record.
 */
export const ToolActionId = z.enum([
  'SUPPRESS_SIMULATED_RECOVERY',
  'SIMULATE_TRANSFER_REMEDIATION',
  'REQUEST_MORE_EVIDENCE',
  'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
]);
export type ToolActionId = z.infer<typeof ToolActionId>;

/**
 * `SUPPRESS_DUPLICATE_RECOVERY` is a Gate B3 addition (backend PRD §12.1/§12.2,
 * scenario 4): a complete duplicate-recovery finding needs its OWN plan
 * template bound to `SUPPRESS_SIMULATED_RECOVERY` so policy's `ALLOW_AUTOMATIC`
 * path and the action/outbox pipeline have a real plan row to reference — every
 * `actions`/`policy_decisions` row requires a non-null `plan_id` (backend PRD
 * §8). `REQUEST_MORE_EVIDENCE` and `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION`
 * stay registered TOOLS (policy/action allowlist) without their own plan
 * template in Gate B3: the former is realized through the standalone
 * `request-more-evidence` approval decision, and the latter is Gate B4's
 * reconciliation-triggered closure — out of B3 scope by explicit instruction.
 */
export const PlanTemplateId = z.enum([
  'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL',
  'SUPPRESS_DUPLICATE_RECOVERY',
]);
export type PlanTemplateId = z.infer<typeof PlanTemplateId>;

export const AuthorityLevel = z.enum(['L0', 'L1', 'L2', 'L3', 'L4']);
export type AuthorityLevel = z.infer<typeof AuthorityLevel>;

export const PlanStatus = z.enum([
  'DRAFT',
  'PROPOSED',
  'POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'AUTHORIZED',
]);
export type PlanStatus = z.infer<typeof PlanStatus>;

// ---- typed, non-authoritative tool parameters (no amounts, no free-form) ----
export const SuppressRecoveryParams = z
  .object({
    tool_id: z.literal('SUPPRESS_SIMULATED_RECOVERY'),
    economic_subject: OpaqueId,
    recovery_id: OpaqueId.nullish(),
  })
  .strict();

export const SimulateTransferParams = z
  .object({
    tool_id: z.literal('SIMULATE_TRANSFER_REMEDIATION'),
    economic_subject: OpaqueId,
    expectation_id: ExpectationId,
  })
  .strict();

export const RequestMoreEvidenceParams = z
  .object({
    tool_id: z.literal('REQUEST_MORE_EVIDENCE'),
    // Must name at least one missing evidence type.
    missing_evidence_types: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX).min(1),
  })
  .strict();

export const CloseReceivableParams = z
  .object({
    tool_id: z.literal('CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'),
    expectation_id: ExpectationId,
  })
  .strict();

export const ToolParameters = z.discriminatedUnion('tool_id', [
  SuppressRecoveryParams,
  SimulateTransferParams,
  RequestMoreEvidenceParams,
  CloseReceivableParams,
]);
export type ToolParameters = z.infer<typeof ToolParameters>;

/** Registered tool request envelope — versioned; tool_id matches its parameters. */
const toolRequestVariant = <TId extends ToolActionId, T extends z.ZodTypeAny>(
  toolId: TId,
  params: T,
) =>
  z
    .object({
      schema_version: SchemaVersion,
      tool_id: z.literal(toolId),
      tool_version: boundedString(LIMITS.CODE_MAX),
      parameters: params,
    })
    .strict();

export const RegisteredToolRequest = z.discriminatedUnion('tool_id', [
  toolRequestVariant('SUPPRESS_SIMULATED_RECOVERY', SuppressRecoveryParams),
  toolRequestVariant('SIMULATE_TRANSFER_REMEDIATION', SimulateTransferParams),
  toolRequestVariant('REQUEST_MORE_EVIDENCE', RequestMoreEvidenceParams),
  toolRequestVariant('CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION', CloseReceivableParams),
]);
export type RegisteredToolRequest = z.infer<typeof RegisteredToolRequest>;

/**
 * Non-authoritative tool dispatch acknowledgement. It distinguishes ACKNOWLEDGED,
 * FAILED, and OUTCOME_UNKNOWN and carries NO verified-effect fields — a tool ack
 * never means the financial effect is verified (that is the Verification domain).
 */
export const ToolResultStatus = z.enum(['ACKNOWLEDGED', 'FAILED', 'OUTCOME_UNKNOWN']);
export type ToolResultStatus = z.infer<typeof ToolResultStatus>;

const toolResultBase = {
  schema_version: SchemaVersion,
  tool_id: ToolActionId,
  tool_version: boundedString(LIMITS.CODE_MAX),
  external_reference: boundedString(LIMITS.SHORT_TEXT).nullable(),
  submitted_at: Rfc3339Utc,
};

const AcknowledgedToolResult = z
  .object({
    ...toolResultBase,
    status: z.literal('ACKNOWLEDGED'),
    acknowledged_at: Rfc3339Utc,
  })
  .strict();

const FailedToolResult = z
  .object({
    ...toolResultBase,
    status: z.literal('FAILED'),
    acknowledged_at: Rfc3339Utc.nullable(),
  })
  .strict();

const UnknownToolResult = z
  .object({
    ...toolResultBase,
    status: z.literal('OUTCOME_UNKNOWN'),
    acknowledged_at: Rfc3339Utc.nullable(),
  })
  .strict();

export const RegisteredToolResult = z.discriminatedUnion('status', [
  AcknowledgedToolResult,
  FailedToolResult,
  UnknownToolResult,
]);
export type RegisteredToolResult = z.infer<typeof RegisteredToolResult>;

/** Plan template -> permitted tool ids. Each template binds exactly one tool. */
export const PLAN_TEMPLATE_TOOL_MAP: Record<
  z.infer<typeof PlanTemplateId>,
  readonly z.infer<typeof ToolActionId>[]
> = {
  OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL: ['SIMULATE_TRANSFER_REMEDIATION'],
  SUPPRESS_DUPLICATE_RECOVERY: ['SUPPRESS_SIMULATED_RECOVERY'],
};

/** FindingCode -> the ONE plan template the model may recommend for that finding
 * (backend PRD §11.1). Investigation output validation rejects any other
 * combination as an invented/mismatched plan recommendation. */
export const FINDING_PLAN_TEMPLATE_MAP: Record<
  'MISSING_EXPECTED_TRANSFER' | 'DUPLICATE_RECOVERY_RISK',
  z.infer<typeof PlanTemplateId>
> = {
  MISSING_EXPECTED_TRANSFER: 'OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL',
  DUPLICATE_RECOVERY_RISK: 'SUPPRESS_DUPLICATE_RECOVERY',
};

export function permittedToolsForTemplate(
  templateId: z.infer<typeof PlanTemplateId>,
): readonly z.infer<typeof ToolActionId>[] {
  return PLAN_TEMPLATE_TOOL_MAP[templateId];
}

/**
 * Plan template variant: structurally binds a template to its permitted
 * parameters. The sole template OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL binds
 * ONLY SimulateTransferParams, so any other tool's parameters are rejected by
 * the schema (and thus by the generated OpenAPI component). Future templates add
 * further variants under a `z.union`.
 */
const OpenTransferRemediationPlan = z
  .object({
    schema_version: SchemaVersion,
    plan_id: PlanId,
    case_id: CaseId,
    template_id: z.literal('OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL'),
    version: ResourceVersion,
    parameters: SimulateTransferParams,
    plan_hash: Sha256Hash,
    authority_level: AuthorityLevel,
    maximum_amount_impact: Money,
    status: PlanStatus,
  })
  .strict();

/** Gate B3 addition — see {@link PlanTemplateId} doc comment. */
const SuppressDuplicateRecoveryPlan = z
  .object({
    schema_version: SchemaVersion,
    plan_id: PlanId,
    case_id: CaseId,
    template_id: z.literal('SUPPRESS_DUPLICATE_RECOVERY'),
    version: ResourceVersion,
    parameters: SuppressRecoveryParams,
    plan_hash: Sha256Hash,
    authority_level: AuthorityLevel,
    maximum_amount_impact: Money,
    status: PlanStatus,
  })
  .strict();

/** The single authoritative Plan schema (runtime AND OpenAPI). */
export const Plan = z.discriminatedUnion('template_id', [
  OpenTransferRemediationPlan,
  SuppressDuplicateRecoveryPlan,
]);
export type Plan = z.infer<typeof Plan>;
