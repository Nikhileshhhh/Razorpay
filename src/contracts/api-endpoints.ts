import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import {
  ActionId,
  ApprovalId,
  CaseId,
  EventId,
  OpaqueId,
  PlanId,
  RawPayloadRef,
  Sha256Hash,
} from './common/identifiers.js';
import { MinorAmount, Money } from './common/money.js';
import { PaginationQuery } from './common/pagination.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';
import { SourceSystem } from './events/event-types.js';
import { CanonicalEvent } from './events/canonical-event.js';
import {
  CaseDetail,
  CaseLifecycleState,
  CaseSummary,
  EvidenceCoverage,
  MoneyPath,
} from './cases.js';
import { PolicyDecision, PolicyDecisionRecord } from './policy.js';
import { ApprovalRecord, ApprovalState } from './approvals.js';
import { ActionRecord } from './actions.js';
import { Plan } from './plans.js';
import { Finding, AbstentionReason } from './findings.js';
import { VerificationContract, VerificationResult } from './verification.js';
import { ArtifactType, AuditRecord } from './audit.js';
import { AgentResultClaim, ClaimEvaluation } from './agent-claims.js';
import { EvidenceRecord } from './evidence.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ApiResponse, ListResponse, MutationResponse } from './api-common.js';

/**
 * Request/response schemas for the proposed API endpoints (architecture §10).
 * Shapes only — no route handlers. Client bodies never accept
 * requester/approver/executor identity or role (server-derived).
 */

// ---- path params ----
export const CaseIdParam = z.object({ id: CaseId }).strict();
export const CaseLinkParam = z.object({ id: CaseId, linkId: OpaqueId }).strict();
export const ActionIdParam = z.object({ id: ActionId }).strict();
export const AgentResultIdParam = z.object({ id: OpaqueId }).strict();
export const ScenarioIdParam = z.object({ id: OpaqueId }).strict();

// ---- request bodies / queries ----
// The authoritative canonical-event validator (enforces amount/currency
// co-presence, source-system provenance, and environment consistency). Never
// use the weaker internal OpenAPI union as a request validator.
export const SubmitEventRequest = CanonicalEvent;

export const ImportRequest = z
  .object({
    schema_version: SchemaVersion,
    source: SourceSystem,
    item_count: z.number().int().min(0),
    manifest_ref: RawPayloadRef.nullish(),
  })
  .strict();

export const ListCasesQuery = PaginationQuery.extend({
  q: boundedString(LIMITS.KEY_MAX).optional(),
  state: CaseLifecycleState.optional(),
  control_id: boundedString(LIMITS.CODE_MAX).optional(),
  min_exposure_minor: MinorAmount.optional(),
  max_exposure_minor: MinorAmount.optional(),
  evidence_coverage: EvidenceCoverage.optional(),
  owner_id: OpaqueId.optional(),
  policy_status: PolicyDecision.optional(),
  sort: z
    .enum(['-exposure_amount_minor', 'exposure_amount_minor', '-opened_at', 'opened_at'])
    .optional(),
}).strict();
export const CaseTimelineQuery = PaginationQuery;

export const InvestigationRequest = z
  .object({ schema_version: SchemaVersion, expected_case_version: ResourceVersion.optional() })
  .strict();

export const EvaluatePolicyRequest = z
  .object({
    schema_version: SchemaVersion,
    plan_id: PlanId,
    expected_plan_version: ResourceVersion,
  })
  .strict();

export const ApproveRequest = z
  .object({
    schema_version: SchemaVersion,
    approval_id: ApprovalId,
    decision_basis_hash: Sha256Hash,
    reason: boundedString(LIMITS.REASON_MAX).nullish(),
  })
  .strict();

export const RejectRequest = z
  .object({
    schema_version: SchemaVersion,
    approval_id: ApprovalId,
    decision_basis_hash: Sha256Hash,
    reason: boundedString(LIMITS.REASON_MAX),
  })
  .strict();

/** `POST /v1/cases/:id/request-more-evidence` (backend PRD §14.2). A finance
 * approver decision on the CURRENT decision basis, distinct from `reject`: it
 * invalidates the current actionable path with a required reason but is not a
 * flat denial (the case may re-enter investigation once new evidence lands). */
export const RequestMoreEvidenceRequest = z
  .object({
    schema_version: SchemaVersion,
    approval_id: ApprovalId,
    decision_basis_hash: Sha256Hash,
    reason: boundedString(LIMITS.REASON_MAX),
  })
  .strict();

export const ExecuteRequest = z
  .object({ schema_version: SchemaVersion, plan_id: PlanId, decision_basis_hash: Sha256Hash })
  .strict();

export const VerificationCheckRequest = z
  .object({
    schema_version: SchemaVersion,
    expected_verification_version: ResourceVersion.optional(),
  })
  .strict();

export const AuditQuery = PaginationQuery.extend({
  artifact_type: ArtifactType.optional(),
}).strict();

/** `GET /v1/approvals` (backend PRD §14.2): cursor list across cases. */
export const ListApprovalsQuery = PaginationQuery.extend({
  state: ApprovalState.optional(),
  case_id: CaseId.optional(),
}).strict();

export const AssignCaseRequest = z
  .object({
    schema_version: SchemaVersion,
    expected_case_version: ResourceVersion,
    owner_id: OpaqueId.nullable(),
  })
  .strict();

export const AddCaseNoteRequest = z
  .object({
    schema_version: SchemaVersion,
    expected_case_version: ResourceVersion,
    body: boundedString(4000),
  })
  .strict();

export const LinkDecisionRequest = z
  .object({
    schema_version: SchemaVersion,
    expected_case_version: ResourceVersion,
    expected_link_version: ResourceVersion,
    decision: z.enum(['confirm', 'reject']),
    reason: boundedString(LIMITS.REASON_MAX),
  })
  .strict();

export const DemoResetRequest = z
  .object({ schema_version: SchemaVersion, seed_id: OpaqueId, confirm: z.literal(true) })
  .strict();

export const DemoAdvanceRequest = z
  .object({ schema_version: SchemaVersion, expected_step: z.number().int().min(0) })
  .strict();

// ---- response data shapes (exported so the OpenAPI registry can $ref them) ----
export const EventAccepted = z
  .object({ event_id: EventId, status: z.enum(['accepted', 'duplicate']) })
  .strict();
export const WebhookAccepted = z
  .object({ status: z.enum(['accepted', 'duplicate', 'quarantined']) })
  .strict();
export const ImportAccepted = z
  .object({ import_id: OpaqueId, status: z.enum(['accepted']) })
  .strict();
export const InvestigationAccepted = z
  .object({ investigation_id: OpaqueId, status: z.enum(['accepted']) })
  .strict();
export const ClaimAccepted = z
  .object({ claim_id: OpaqueId, status: z.literal('PENDING') })
  .strict();
export const DemoStatus = z.object({ status: z.enum(['ok']) }).strict();
export const DemoAdvanceStatus = z
  .object({ status: z.enum(['ok']), step: z.number().int().min(0) })
  .strict();

export const CaseAssignmentResult = z
  .object({ case_id: CaseId, owner_id: OpaqueId.nullable() })
  .strict();

export const CaseNoteRecord = z
  .object({
    note_id: OpaqueId,
    case_id: CaseId,
    author_id: OpaqueId,
    body: boundedString(4000),
    created_at: Rfc3339Utc,
    case_version: ResourceVersion,
  })
  .strict();

export const LinkDecisionResult = z
  .object({
    case_id: CaseId,
    link_id: OpaqueId,
    decision: z.enum(['confirm', 'reject']),
    link_version: ResourceVersion,
  })
  .strict();

export const EvidenceTimelineItem = EvidenceRecord.extend({
  related_case_id: CaseId,
  is_conflicting: z.boolean(),
}).strict();

export const VerificationView = z
  .object({ contract: VerificationContract.nullable(), result: VerificationResult.nullable() })
  .strict();

/** Commands the control-loop read model may report as currently valid (backend
 * PRD §14.2 `control-loop`). A strict enum so the frontend cannot be pointed at
 * an unregistered/invented command. */
export const ControlLoopCommand = z.enum([
  'request_investigation',
  'evaluate_policy',
  'request_approval',
  'approve',
  'reject',
  'request_more_evidence',
  'execute',
]);
export type ControlLoopCommand = z.infer<typeof ControlLoopCommand>;

/** `GET /v1/approvals` list item: the approval plus the case/amount context a
 * cross-case queue needs (backend PRD §14.2 "with case/amount/expiry"). */
export const ApprovalListItem = z
  .object({ approval: ApprovalRecord, case_id: CaseId, amount_impact: Money })
  .strict();
export type ApprovalListItem = z.infer<typeof ApprovalListItem>;

/** `GET /v1/cases/:id/control-loop` (backend PRD §14.2): current finding/
 * abstention, plan, policy, approval, action summaries and allowed next
 * commands, built from real persisted state only. */
export const ControlLoopView = z
  .object({
    schema_version: SchemaVersion,
    case_id: CaseId,
    finding: Finding.nullable(),
    abstention_reason: AbstentionReason.nullable(),
    plan: Plan.nullable(),
    policy_decision: PolicyDecisionRecord.nullable(),
    /** The plan's CURRENT decision-basis hash, freshly rebuilt from live state
     * (architecture §9.4). Required by `execute` for BOTH automatic and
     * approval-required plans — for the latter it also matches the current
     * approval's `decision_basis_hash`. `null` until enough state exists to
     * build one (backend PRD §12.3). */
    current_decision_basis_hash: Sha256Hash.nullable(),
    approval: ApprovalRecord.nullable(),
    action: ActionRecord.nullable(),
    allowed_next_commands: boundedArray(ControlLoopCommand, LIMITS.ARRAY_MAX),
  })
  .strict();
export type ControlLoopView = z.infer<typeof ControlLoopView>;

export const AgentResultView = z
  .object({
    claim: AgentResultClaim,
    evaluations: boundedArray(ClaimEvaluation, LIMITS.ARRAY_MAX),
    verified_amount: Money.nullable(),
  })
  .strict();

// ---- response envelopes ----
// Every POST success returns the resulting resource/state version (MutationResponse).
export const EventAcceptedResponse = MutationResponse(EventAccepted);
export const WebhookAcceptedResponse = MutationResponse(WebhookAccepted);
export const ImportAcceptedResponse = MutationResponse(ImportAccepted);
export const CaseListResponse = ListResponse(CaseSummary);
export const CaseDetailResponse = ApiResponse(CaseDetail);
export const MoneyPathResponse = ApiResponse(MoneyPath);
export const InvestigationAcceptedResponse = MutationResponse(InvestigationAccepted);
export const PolicyDecisionResponse = MutationResponse(PolicyDecisionRecord);
export const ApprovalResponse = MutationResponse(ApprovalRecord);
export const ActionResponse = MutationResponse(ActionRecord);
export const VerificationResponse = ApiResponse(VerificationView);
export const VerificationCheckResponse = MutationResponse(VerificationResult);
export const AuditListResponse = ListResponse(AuditRecord);
export const AgentResultAcceptedResponse = MutationResponse(ClaimAccepted);
export const AgentResultDetailResponse = ApiResponse(AgentResultView);
export const DemoResetResponse = MutationResponse(DemoStatus);
export const DemoAdvanceResponse = MutationResponse(DemoAdvanceStatus);
export const EvidenceTimelineResponse = ListResponse(EvidenceTimelineItem);
export const CaseNoteListResponse = ListResponse(CaseNoteRecord);
export const CaseAssignmentResponse = MutationResponse(CaseAssignmentResult);
export const CaseNoteResponse = MutationResponse(CaseNoteRecord);
export const LinkDecisionResponse = MutationResponse(LinkDecisionResult);
export const ControlLoopResponse = ApiResponse(ControlLoopView);
export const ApprovalListResponse = ListResponse(ApprovalListItem);
export const RequestMoreEvidenceResponse = MutationResponse(ApprovalRecord);
