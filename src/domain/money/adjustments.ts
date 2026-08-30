import {
  InvalidMoneyInputError,
  type Money,
  money,
  type SignedMoney,
  signedMoney,
} from './money.js';

/**
 * Signed adjustments (backend PRD §7.1): "Signed adjustments are typed by
 * direction and reason; unclassified negative input rejects." A raw negative
 * `bigint`/string is never accepted directly into a balance — only through one
 * of these typed, reasoned adjustments.
 */
export const ADJUSTMENT_DIRECTIONS = ['CREDIT', 'DEBIT'] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

/** Reason codes recognised by the demo financial kernel. */
export const ADJUSTMENT_REASON_CODES = [
  'PLATFORM_ROUNDING_RESIDUAL',
  'REFUND',
  'REVERSAL',
  'DISPUTE_ADJUSTMENT',
  'MANUAL_CORRECTION',
] as const;
export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASON_CODES)[number];

export interface SignedAdjustment {
  readonly direction: AdjustmentDirection;
  /** Always non-negative; direction carries the sign. */
  readonly absoluteAmount: Money;
  readonly reasonCode: AdjustmentReasonCode;
}

export function createAdjustment(
  direction: AdjustmentDirection,
  absoluteAmount: Money,
  reasonCode: AdjustmentReasonCode,
): SignedAdjustment {
  if (absoluteAmount.amountMinor < 0n) {
    throw new InvalidMoneyInputError('adjustment absoluteAmount must be non-negative');
  }
  return { direction, absoluteAmount, reasonCode };
}

/** Convert a typed adjustment into a signed delta. */
export function adjustmentToSigned(adjustment: SignedAdjustment): SignedMoney {
  const sign = adjustment.direction === 'DEBIT' ? -1n : 1n;
  return signedMoney(
    sign * adjustment.absoluteAmount.amountMinor,
    adjustment.absoluteAmount.currency,
  );
}

/**
 * Apply a typed adjustment to a non-negative balance. Throws rather than
 * silently producing a negative balance — callers that intend to allow a
 * negative bucket must model it as `SignedMoney` explicitly and justify it
 * (backend PRD §7.1: "unclassified negative input rejects").
 */
export function applyAdjustment(base: Money, adjustment: SignedAdjustment): Money {
  const delta = adjustmentToSigned(adjustment);
  if (delta.currency !== base.currency) {
    throw new InvalidMoneyInputError(
      `adjustment currency ${delta.currency} does not match balance currency ${base.currency}`,
    );
  }
  const result = base.amountMinor + delta.amountMinor;
  if (result < 0n) {
    throw new InvalidMoneyInputError(
      `adjustment ${adjustment.reasonCode} would drive balance negative without an explicit signed-balance model`,
    );
  }
  return money(result, base.currency);
}
