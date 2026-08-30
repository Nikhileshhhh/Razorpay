import { ModelInvestigationOutput, type FindingCode } from '../../contracts/findings.js';
import { FINDING_PLAN_TEMPLATE_MAP } from '../../contracts/plans.js';
import type { CaseEvidencePool } from './evidence-classification.js';

/**
 * Investigation output validation (backend PRD §11.1/§11.3, architecture §12
 * "Investigation pipeline"): JSON schema validation, evidence-ID/citation
 * validation against the SEALED set (not the raw model claim), and
 * finding/plan-template enum validation. Any failure is a SAFE FAILURE — it
 * never becomes a persisted finding.
 */
export type InvestigationFailureClass =
  | 'SCHEMA_INVALID'
  | 'CITATION_INVALID'
  | 'PLAN_TEMPLATE_MISMATCH'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE';

export class InvestigationOutputInvalidError extends Error {
  constructor(readonly failureClass: InvestigationFailureClass) {
    super(`investigation output invalid: ${failureClass}`);
    this.name = 'InvestigationOutputInvalidError';
  }
}

/**
 * Validate an UNVALIDATED gateway output. Throws {@link InvestigationOutputInvalidError}
 * on any structural, citation, or enum violation. Returns the SAME validated
 * output on success — this function never mutates or "fixes" model output.
 */
export function validateInvestigationOutput(
  rawOutput: unknown,
  pool: CaseEvidencePool,
): ModelInvestigationOutput {
  const parsed = ModelInvestigationOutput.safeParse(rawOutput);
  if (!parsed.success) throw new InvestigationOutputInvalidError('SCHEMA_INVALID');
  const output = parsed.data;

  const sealedIds = new Set(pool.items.map((item) => item.evidenceId));
  const citedIds = [...output.supporting_evidence_ids, ...output.contradicting_evidence_ids];
  for (const id of citedIds) {
    if (!sealedIds.has(id)) throw new InvestigationOutputInvalidError('CITATION_INVALID');
  }

  if (output.result_type === 'FINDING') {
    const expectedTemplate = FINDING_PLAN_TEMPLATE_MAP[output.finding_code as FindingCode];
    if (output.recommended_plan_template_id !== expectedTemplate) {
      throw new InvestigationOutputInvalidError('PLAN_TEMPLATE_MISMATCH');
    }
  }

  return output;
}
