import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import { CaseId, EvidenceId, OpaqueId, Sha256Hash } from './common/identifiers.js';
import { Money } from './common/money.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { SchemaVersion } from './common/versions.js';
import { BlockerType, EvidenceType } from './evidence.js';
import { PlanTemplateId } from './plans.js';

/**
 * Findings, evidence contracts, and MODEL investigation output.
 *
 * Model output is kept strictly separate from the persisted deterministic
 * finding: the model may classify, summarize, cite evidence, and recommend a
 * registered plan template, but may NOT originate authoritative money, links,
 * policy, approval, state transitions, verification, or reconciliation (rejected
 * by the strict schema). `FindingCode` enumerates ONLY the codes the PRD
 * documents by name.
 */
export const FindingCode = z.enum(['MISSING_EXPECTED_TRANSFER', 'DUPLICATE_RECOVERY_RISK']);
export type FindingCode = z.infer<typeof FindingCode>;

export const AbstentionReason = z.enum(['INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE']);
export type AbstentionReason = z.infer<typeof AbstentionReason>;

export const ConfidenceBand = z.enum(['low', 'medium', 'high']);
export type ConfidenceBand = z.infer<typeof ConfidenceBand>;

/** Model-facing coverage (adds `complete_for_finding`, PRD §13.5). */
export const ModelEvidenceCoverage = z.enum([
  'insufficient',
  'partial',
  'complete',
  'complete_for_finding',
]);
export type ModelEvidenceCoverage = z.infer<typeof ModelEvidenceCoverage>;

/** Minimum evidence set required to support a finding / block an action (§8.7). */
export const EvidenceContract = z
  .object({
    schema_version: SchemaVersion,
    finding_type: FindingCode,
    required: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX).min(1),
    contradictions_that_block_action: boundedArray(BlockerType, LIMITS.EVIDENCE_TYPES_MAX),
  })
  .strict();
export type EvidenceContract = z.infer<typeof EvidenceContract>;

const FindingModelOutput = z
  .object({
    schema_version: SchemaVersion,
    result_type: z.literal('FINDING'),
    finding_code: FindingCode,
    summary: boundedString(LIMITS.SUMMARY_MAX),
    explanation: boundedString(LIMITS.EXPLANATION_MAX),
    // A material finding must cite at least one supporting evidence id.
    supporting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
    contradicting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX),
    missing_evidence_types: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX),
    confidence_band: ConfidenceBand,
    evidence_coverage: ModelEvidenceCoverage,
    safe_to_act: z.boolean(),
    recommended_plan_template_id: PlanTemplateId.nullable(),
  })
  .strict();

const abstentionCommon = {
  schema_version: SchemaVersion,
  result_type: z.literal('ABSTENTION'),
  summary: boundedString(LIMITS.SUMMARY_MAX),
  explanation: boundedString(LIMITS.EXPLANATION_MAX),
  supporting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX),
  missing_evidence_types: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX),
  confidence_band: ConfidenceBand,
  evidence_coverage: ModelEvidenceCoverage,
  recommended_plan_template_id: z.null(),
};

// An INSUFFICIENT_EVIDENCE abstention may cite no contradictions.
const InsufficientAbstentionOutput = z
  .object({
    ...abstentionCommon,
    abstention_reason: z.literal('INSUFFICIENT_EVIDENCE'),
    contradicting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX),
  })
  .strict();

// A CONFLICTING_EVIDENCE abstention MUST cite at least one contradiction — structural.
const ConflictingAbstentionOutput = z
  .object({
    ...abstentionCommon,
    abstention_reason: z.literal('CONFLICTING_EVIDENCE'),
    contradicting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
  })
  .strict();

/**
 * The single authoritative model-output schema (runtime AND OpenAPI). All rules
 * are structural: FINDING requires >= 1 supporting evidence id; INSUFFICIENT
 * abstention needs no contradictions; CONFLICTING abstention needs >= 1.
 */
export const ModelInvestigationOutput = z.union([
  FindingModelOutput,
  InsufficientAbstentionOutput,
  ConflictingAbstentionOutput,
]);
export type ModelInvestigationOutput = z.infer<typeof ModelInvestigationOutput>;

/**
 * Persisted deterministic finding. Provenance is a strict discriminated union:
 * MODEL_VALIDATED requires model metadata; RULES_ONLY requires validator identity
 * and REJECTS model metadata (so rules-only findings never fabricate it).
 * Deterministic `exposure` money is injected by application code and lives
 * outside model output. A material finding cites at least one supporting id.
 */
const findingCommon = {
  schema_version: SchemaVersion,
  finding_id: OpaqueId,
  case_id: CaseId,
  finding_code: FindingCode,
  summary: boundedString(LIMITS.SUMMARY_MAX),
  confidence_band: ConfidenceBand,
  supporting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
  contradicting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX),
  missing_evidence_types: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX),
  evidence_set_hash: Sha256Hash,
  exposure: Money,
  created_at: Rfc3339Utc,
};

const ModelValidatedFinding = z
  .object({
    ...findingCommon,
    provenance: z.literal('MODEL_VALIDATED'),
    model_id: boundedString(LIMITS.ID_MAX),
    prompt_version: boundedString(LIMITS.CODE_MAX),
    output_schema_version: SchemaVersion,
  })
  .strict();

const RulesOnlyFinding = z
  .object({
    ...findingCommon,
    provenance: z.literal('RULES_ONLY'),
    validator_id: boundedString(LIMITS.ID_MAX),
    validator_version: boundedString(LIMITS.CODE_MAX),
  })
  .strict();

export const Finding = z.discriminatedUnion('provenance', [
  ModelValidatedFinding,
  RulesOnlyFinding,
]);
export type Finding = z.infer<typeof Finding>;
