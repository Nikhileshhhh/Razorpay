import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import {
  CaseId,
  EvidenceId,
  ExpectationId,
  OpaqueId,
  SubjectId,
  SubjectKey,
  TenantId,
} from './common/identifiers.js';
import { Money } from './common/money.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';
import { SourceSystem } from './events/event-types.js';

/**
 * Case summary/detail and the expected-vs-observed money path.
 *
 * Case LIFECYCLE state and FINANCIAL OUTCOME status are independent state
 * machines (FR-CASE-004 and handoff §9.1) and are modelled as separate enums —
 * neither substitutes for the other.
 */
export const CaseLifecycleState = z.enum([
  'candidate',
  'open',
  'investigating',
  'recommendation_ready',
  'approval_required',
  'approved',
  'executing',
  'verification_pending',
  'reconciled',
  'abstained',
  'escalated',
  'rejected',
  'expired',
  'cancelled',
  'closed_no_action',
]);
export type CaseLifecycleState = z.infer<typeof CaseLifecycleState>;

export const FinancialOutcomeStatus = z.enum([
  'EXPECTED',
  'OBSERVED_UNVERIFIED',
  'DIVERGED',
  'ACTION_PENDING',
  'VERIFIED',
  'REVERSED',
  'UNRESOLVED',
]);
export type FinancialOutcomeStatus = z.infer<typeof FinancialOutcomeStatus>;

export const EvidenceCoverage = z.enum(['insufficient', 'partial', 'complete']);
export type EvidenceCoverage = z.infer<typeof EvidenceCoverage>;

// ---- Money path (handoff §16, §19.5) ----

/** Provenance node types (§16.2). */
export const NodeType = z.enum([
  'commercial_intent',
  'order',
  'payment_attempt',
  'payment',
  'authorization',
  'capture',
  'refund',
  'dispute',
  'transfer',
  'linked_account',
  'settlement',
  'bank_credit',
  'seller_receivable',
  'invoice',
  'ledger_entry',
  'recovery_action',
  'approval',
  'tool_action',
  'verification_result',
  'policy_decision',
  'financial_case',
]);
export type NodeType = z.infer<typeof NodeType>;

/** Provenance edge types (§16.3). */
export const EdgeType = z.enum([
  'ATTEMPT_FOR',
  'PAYMENT_FOR',
  'CAPTURED_AS',
  'REFUNDS',
  'SOURCE_OF_TRANSFER',
  'ALLOCATED_TO',
  'TRANSFERRED_TO',
  'SETTLED_IN',
  'OBSERVED_IN_BANK',
  'CLOSES_RECEIVABLE',
  'POSTED_TO_LEDGER',
  'RECOVERS_SUBJECT',
  'PROPOSED_BY',
  'AUTHORIZED_BY',
  'EXECUTED_AS',
  'VERIFIED_BY',
  'SUPERSEDES',
  'CONTRADICTS',
  'DERIVED_FROM',
  'CANDIDATE_MATCH',
]);
export type EdgeType = z.infer<typeof EdgeType>;

/** Edge confidence classes (§16.4). */
export const EdgeConfidenceClass = z.enum([
  'verified',
  'asserted',
  'derived',
  'candidate',
  'rejected',
  'contradicted',
]);
export type EdgeConfidenceClass = z.infer<typeof EdgeConfidenceClass>;

export const PathObservation = z.enum(['expected', 'observed']);

export const MoneyPathNode = z
  .object({
    node_key: OpaqueId,
    node_type: NodeType,
    status: boundedString(LIMITS.CODE_MAX),
    amount: Money.nullish(),
    event_time: Rfc3339Utc.nullish(),
    source_system: SourceSystem.nullish(),
    evidence_count: z.number().int().min(0),
  })
  .strict();

export const MoneyPathEdge = z
  .object({
    link_id: OpaqueId,
    edge_type: EdgeType,
    source_node_key: OpaqueId,
    target_node_key: OpaqueId,
    confidence_class: EdgeConfidenceClass,
    observation: PathObservation,
    amount: Money.nullish(),
    // Every edge (candidate edges included) must cite the evidence/provenance
    // behind it; we do not rely on evidence_count alone.
    evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
  })
  .strict();

export const MoneyPath = z
  .object({
    schema_version: SchemaVersion,
    case_id: CaseId,
    nodes: boundedArray(MoneyPathNode, LIMITS.ARRAY_MAX),
    edges: boundedArray(MoneyPathEdge, LIMITS.ARRAY_MAX),
    /** Accessible linear alternative to the visual path. */
    linear: boundedArray(boundedString(LIMITS.SHORT_TEXT), LIMITS.ARRAY_MAX),
  })
  .strict();
export type MoneyPath = z.infer<typeof MoneyPath>;

// ---- Case records ----

export const CaseSummary = z
  .object({
    schema_version: SchemaVersion,
    case_id: CaseId,
    case_dedupe_key: SubjectKey,
    tenant_id: TenantId,
    subject_id: SubjectId,
    expectation_id: ExpectationId,
    control_id: boundedString(LIMITS.CODE_MAX),
    epoch: z.number().int().min(0),
    lifecycle_state: CaseLifecycleState,
    outcome_status: FinancialOutcomeStatus,
    exposure: Money,
    priority_score: z.number().min(0).max(1),
    evidence_coverage: EvidenceCoverage,
    contradiction_count: z.number().int().min(0),
    owner_id: OpaqueId.nullable(),
    opened_at: Rfc3339Utc,
    due_at: Rfc3339Utc.nullable(),
    closed_at: Rfc3339Utc.nullable(),
    resource_version: ResourceVersion,
  })
  .strict();
export type CaseSummary = z.infer<typeof CaseSummary>;

export const CaseDetail = CaseSummary.extend({
  finding_id: OpaqueId.nullable(),
  current_plan_id: OpaqueId.nullable(),
  latest_policy_decision_id: OpaqueId.nullable(),
  money_path_available: z.boolean(),
}).strict();
export type CaseDetail = z.infer<typeof CaseDetail>;
