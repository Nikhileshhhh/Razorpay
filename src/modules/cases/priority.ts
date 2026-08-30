import type { Money } from '../../domain/money/money.js';

/**
 * Deterministic case priority (backend PRD §10.2): "Priority is deterministic
 * from exposure, time sensitivity, customer-harm risk, and evidence
 * coverage." Default list sorting is exposure descending regardless of this
 * score; the score exists for secondary ranking / display.
 *
 * A simple, fully deterministic, documented formula: exposure normalized
 * against a ₹10,00,000 reference ceiling (clamped to 1), blended with
 * evidence-coverage and customer-harm weights. No randomness, no wall-clock
 * dependency beyond the caller-supplied `ageSeconds`.
 */
export interface PriorityInputs {
  readonly exposure: Money;
  readonly evidenceCoverage: 'insufficient' | 'partial' | 'complete';
  readonly customerHarmRisk: 'none' | 'low' | 'medium' | 'high';
  readonly ageSeconds: number;
}

const EXPOSURE_REFERENCE_CEILING_MINOR = 100_000_000n; // ₹10,00,000
const EVIDENCE_WEIGHT: Record<PriorityInputs['evidenceCoverage'], number> = {
  insufficient: 0,
  partial: 0.5,
  complete: 1,
};
const HARM_WEIGHT: Record<PriorityInputs['customerHarmRisk'], number> = {
  none: 0,
  low: 0.33,
  medium: 0.66,
  high: 1,
};
const AGE_REFERENCE_CEILING_SECONDS = 7 * 24 * 3600; // 7 days

export function computePriorityScore(inputs: PriorityInputs): number {
  const exposureRatio =
    Number(
      inputs.exposure.amountMinor > EXPOSURE_REFERENCE_CEILING_MINOR
        ? EXPOSURE_REFERENCE_CEILING_MINOR
        : inputs.exposure.amountMinor,
    ) / Number(EXPOSURE_REFERENCE_CEILING_MINOR);
  const ageRatio = Math.min(1, Math.max(0, inputs.ageSeconds) / AGE_REFERENCE_CEILING_SECONDS);
  const evidenceWeight = EVIDENCE_WEIGHT[inputs.evidenceCoverage];
  const harmWeight = HARM_WEIGHT[inputs.customerHarmRisk];

  // Weighted blend; exposure dominates (0.5) since it is the primary financial signal.
  const score = 0.5 * exposureRatio + 0.2 * ageRatio + 0.15 * evidenceWeight + 0.15 * harmWeight;
  return Math.min(1, Math.max(0, score));
}
