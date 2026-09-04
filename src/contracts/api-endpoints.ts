import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import {
  ActionId,
  ApprovalId,
  CaseId,
  DateOnly,
  EventId,
  EvidenceId,
  OpaqueId,
  PlanId,
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
import { ActionRecord, ActionStatus } from './actions.js';
import { Plan } from './plans.js';
import { Finding, AbstentionReason } from './findings.js';
import { VerificationContract, VerificationResult } from './verification.js';
import { ReconciliationAllocationRef } from './reconciliation.js';
import { ArtifactType, AuditRecord } from './audit.js';
import { AgentResultClaim, AgentClaimStatus, ClaimEvaluation } from './agent-claims.js';
import { EvidenceRecord, EvidenceReference } from './evidence.js';
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

/**
 * Deterministic dataset import (ADR 0002 D9). The client may ONLY name an
 * allowlisted registered seed and confirm; it never supplies a source, item
 * count, tenant, file path, or URL. The server computes source, counts, and the
 * manifest hash from the registered seed specification and persisted rows.
 */
export const ImportSeedId = z.literal('moneytrace_demo_v1');
export const ImportRequest = z
  .object({ schema_version: SchemaVersion, seed_id: ImportSeedId, confirm: z.literal(true) })
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
// A registered import is genuinely asynchronous (backend PRD §14.1): the
// server durably enqueues the work and returns immediately. `pending` means
// the durable job is queued or a worker is processing it and no accepted
// dataset exists yet; `accepted` means the full dataset and manifest are
// persisted. There is no partial/half-accepted state exposed — a crash
// mid-generation never advertises `accepted` for less than the complete
// registered dataset (see `generateDemoDataset`'s resumable, idempotent
// design in `src/modules/demo/dataset.ts`).
export const ImportAccepted = z
  .object({
    import_id: OpaqueId,
    status: z.enum(['pending', 'accepted']),
    seed_id: ImportSeedId,
    // Server-computed from the registered seed + persisted journal rows;
    // null while `status = 'pending'` (not yet known).
    item_count: z.number().int().min(0).nullable(),
    accepted_count: z.number().int().min(0).nullable(),
    duplicate_count: z.number().int().min(0).nullable(),
    conflict_count: z.number().int().min(0).nullable(),
    manifest_hash: Sha256Hash.nullable(),
  })
  .strict();
export const InvestigationAccepted = z
  .object({ investigation_id: OpaqueId, status: z.enum(['accepted']) })
  .strict();
/**
 * Claim acceptance (backend PRD §14.1). A brand-new claim returns `201` with
 * `idempotent_replay=false` and `PENDING`; an exact same-key/same-hash replay
 * returns `200` with `idempotent_replay=true` and the claim's current head
 * status, and creates no second evaluation/effect (ADR 0002 §9.1).
 */
export const ClaimAccepted = z
  .object({ claim_id: OpaqueId, status: AgentClaimStatus, idempotent_replay: z.boolean() })
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

/** A closure/reversal fact summary surfaced in the verification view. */
export const ReceivableClosureSummary = z
  .object({ closure_evidence_id: EvidenceId, closed_at: Rfc3339Utc })
  .strict();
export const ReconciliationReversalSummary = z
  .object({ reversal_evidence_id: EvidenceId, reversed_amount: Money, reversed_at: Rfc3339Utc })
  .strict();

/**
 * Verification view (backend PRD §14.1). ACK / OUTCOME_UNKNOWN action status is
 * surfaced SEPARATELY from the contract evaluation so the UI can never read an
 * acknowledgement as verification (ADR 0002 §11.3).
 */
export const VerificationView = z
  .object({
    contract: VerificationContract.nullable(),
    result: VerificationResult.nullable(),
    action_status: ActionStatus.nullable(),
    blockers: boundedArray(boundedString(LIMITS.CODE_MAX), LIMITS.ARRAY_MAX),
    allocation: ReconciliationAllocationRef.nullable(),
    closure: ReceivableClosureSummary.nullable(),
    reversal: ReconciliationReversalSummary.nullable(),
  })
  .strict();

/** Current logical reconciliation state derived from allocation/closure/reversal facts. */
export const ReconciliationSummary = z
  .object({
    status: z.enum(['NONE', 'ALLOCATED', 'CLOSED', 'REVERSED', 'AMBIGUOUS']),
    allocation: ReconciliationAllocationRef.nullable(),
    closure: ReceivableClosureSummary.nullable(),
    reversal: ReconciliationReversalSummary.nullable(),
  })
  .strict();
export type ReconciliationSummary = z.infer<typeof ReconciliationSummary>;

/**
 * Deterministic dataset manifest metrics (backend PRD §16.1). Every value is
 * computed from persisted rows; the narrative constants appear only as test
 * expectations (ADR 0002 D9). Money fields are INR minor-unit decimal strings.
 */
export const DatasetManifest = z
  .object({
    records_total: z.number().int().min(0),
    records_matched: z.number().int().min(0),
    unresolved_cases: z.number().int().min(0),
    unsafe_candidate_matches_blocked: z.number().int().min(0),
    unresolved_exposure: MinorAmount,
    verified_restored: MinorAmount,
    duplicate_collection_prevented: MinorAmount,
    reversed_recovery: MinorAmount,
  })
  .strict();
export type DatasetManifest = z.infer<typeof DatasetManifest>;

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
  // Gate B4: an executed action awaiting verification exposes only a safe
  // status re-check (never a blind retry) — backed by the real
  // `POST /v1/actions/:id/verification-checks` path.
  'check_status',
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
    /** Gate B4 verification/reconciliation summaries, from real rows only. */
    verification: VerificationResult.nullable(),
    reconciliation: ReconciliationSummary.nullable(),
    allowed_next_commands: boundedArray(ControlLoopCommand, LIMITS.ARRAY_MAX),
  })
  .strict();
export type ControlLoopView = z.infer<typeof ControlLoopView>;

export const AgentResultView = z
  .object({
    claim: AgentResultClaim,
    evaluations: boundedArray(ClaimEvaluation, LIMITS.ARRAY_MAX),
    current_status: AgentClaimStatus,
    verified_amount: Money.nullable(),
  })
  .strict();

// ---- §14.2 read models (all derived from persisted rows) ----

/** `GET /v1/overview` (backend PRD §14.2): computed synthetic KPIs. */
export const LifecycleCount = z
  .object({
    lifecycle_state: CaseLifecycleState,
    count: z.number().int().min(0),
    exposure_amount: Money,
  })
  .strict();
export type LifecycleCount = z.infer<typeof LifecycleCount>;
export const TrendPoint = z
  .object({ date: DateOnly, opened: z.number().int().min(0), closed: z.number().int().min(0) })
  .strict();
export type TrendPoint = z.infer<typeof TrendPoint>;
export const TopCase = z
  .object({ case_id: CaseId, exposure_amount: Money, lifecycle_state: CaseLifecycleState })
  .strict();
/**
 * A downstream acknowledgement of a synthetic transfer action (e.g. Route's
 * `TransferProcessed`). Explicitly NOT verification — carried on the
 * untrusted side of the claim-truth panel, never contributes to
 * `current_status` or `verified_incremental_recovery`.
 */
export const RouteAcknowledgement = z
  .object({
    acknowledged: z.boolean(),
    source_system: SourceSystem,
    occurred_at: Rfc3339Utc,
  })
  .strict();
export type RouteAcknowledgement = z.infer<typeof RouteAcknowledgement>;

/**
 * The deterministic pipeline's own independent-evidence steps for the
 * claim's economic subject (backend PRD §13.3's
 * `independently_satisfied_baseline`). Populated only when at least one step
 * has a persisted row; `satisfied` reflects real row presence, never assumed.
 */
export const VerificationChainStep = z
  .object({
    step: z.enum(['bank_evidence', 'unique_allocation', 'erp_closure']),
    label: boundedString(LIMITS.KEY_MAX),
    satisfied: z.boolean(),
    occurred_at: Rfc3339Utc.nullable(),
  })
  .strict();
export type VerificationChainStep = z.infer<typeof VerificationChainStep>;

export const ClaimTruthComparison = z
  .object({
    claim_id: OpaqueId,
    external_claim_id: OpaqueId,
    claimed_amount: Money,
    recovery_payment_observed: z.boolean(),
    correlated_refund_amount: Money,
    final_retained_value: Money,
    verified_incremental_recovery: Money.nullable(),
    current_status: AgentClaimStatus,
    evidence_references: boundedArray(EvidenceReference, LIMITS.EVIDENCE_IDS_MAX),
    route_acknowledgement: RouteAcknowledgement.nullable(),
    verification_chain: boundedArray(VerificationChainStep, LIMITS.ARRAY_MAX).nullable(),
  })
  .strict();
export type ClaimTruthComparison = z.infer<typeof ClaimTruthComparison>;
export const OverviewView = z
  .object({
    schema_version: SchemaVersion,
    generated_at: Rfc3339Utc,
    dataset_timestamp: Rfc3339Utc.nullable(),
    manifest: DatasetManifest,
    lifecycle_distribution: boundedArray(LifecycleCount, LIMITS.ARRAY_MAX),
    opened_closed_trend: boundedArray(TrendPoint, LIMITS.ARRAY_MAX),
    top_cases: boundedArray(TopCase, LIMITS.ARRAY_MAX),
    claim_truth_comparison: ClaimTruthComparison.nullable(),
    claim_reversal_summary: z
      .object({ reversed_recovery: Money, reversed_claims: z.number().int().min(0) })
      .strict(),
  })
  .strict();

/** `GET /v1/data-health` (backend PRD §14.2). */
export const SourceCapability = z.enum(['available', 'synthetic', 'absent']);
export const SourceHealth = z
  .object({
    source_system: SourceSystem,
    capability: SourceCapability,
    received: z.number().int().min(0),
    signed: z.number().int().min(0),
    unsigned: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    conflict: z.number().int().min(0),
    schema_failure: z.number().int().min(0),
  })
  .strict();
export const DataHealthView = z
  .object({
    schema_version: SchemaVersion,
    generated_at: Rfc3339Utc,
    model_mode: boundedString(LIMITS.CODE_MAX),
    database: z.enum(['up', 'down']),
    worker: z.enum(['up', 'stale', 'down']),
    sources: boundedArray(SourceHealth, LIMITS.ARRAY_MAX),
    received_total: z.number().int().min(0),
    duplicate_total: z.number().int().min(0),
    conflict_total: z.number().int().min(0),
    schema_failure_total: z.number().int().min(0),
    projector_lag_seconds: z.number().int().min(0),
    job_lag_seconds: z.number().int().min(0),
    pending_verification: z.number().int().min(0),
    unlinked: z.number().int().min(0),
    candidate_links: z.number().int().min(0),
    stale_projections: z.number().int().min(0),
  })
  .strict();

/** `GET /v1/demo/status` (backend PRD §14.2): richer than the reset `DemoStatus`. */
export const ScenarioStepView = z
  .object({
    scenario_id: OpaqueId,
    current_step: z.number().int().min(0),
    // Gate B4 remediation: `current_step` is the durably queued request;
    // `completed_step` is written only once the worker has actually applied
    // it, so `status` below is a genuine fact, not inferred from a 200.
    completed_step: z.number().int().min(0),
    total_steps: z.number().int().min(0),
    state_version: ResourceVersion,
    status: z.enum(['queued', 'completed', 'failed']),
    last_error: z.literal('DEMO_STEP_FAILED').nullable(),
  })
  .strict();
export const DemoStatusView = z
  .object({
    schema_version: SchemaVersion,
    seed_id: OpaqueId.nullable(),
    ready: z.boolean(),
    fixed_clock: Rfc3339Utc,
    manifest_hash: Sha256Hash.nullable(),
    manifest: DatasetManifest.nullable(),
    scenarios: boundedArray(ScenarioStepView, LIMITS.ARRAY_MAX),
  })
  .strict();
export type DemoStatusView = z.infer<typeof DemoStatusView>;

/** `GET /ready`: safe database/worker readiness only (no URL/secret). */
export const ReadinessView = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    database: z.enum(['up', 'down']),
    worker: z.enum(['up', 'stale', 'down']),
  })
  .strict();

/**
 * `GET /v1/cases/:id/audit/export` (backend PRD §14.2). The server builds this
 * from persisted audit rows; `content_sha256` is the canonical hash of the
 * export content WITHOUT this field, and is echoed in the safe
 * `x-moneytrace-content-sha256` response header.
 */
export const AuditExportView = z
  .object({
    schema_version: SchemaVersion,
    case_id: CaseId,
    generated_at: Rfc3339Utc,
    content_sha256: Sha256Hash,
    entries: boundedArray(AuditRecord, LIMITS.ARRAY_MAX),
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
// Gate B4 §14.2 read-model envelopes.
export const OverviewResponse = ApiResponse(OverviewView);
export const DataHealthResponse = ApiResponse(DataHealthView);
export const DemoStatusResponse = ApiResponse(DemoStatusView);
export const ReadinessResponse = ApiResponse(ReadinessView);
export const AuditExportResponse = ApiResponse(AuditExportView);
