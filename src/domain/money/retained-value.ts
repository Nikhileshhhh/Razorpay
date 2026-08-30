import { type Money, maxWithZero, type SignedMoney } from './money.js';

/**
 * Retained-value equation (backend PRD §13.3):
 *
 *   verified_incremental_recovery
 *     = max(0, eligible_recovery_captures
 *              - linked_refunds
 *              - linked_reversals
 *              - linked_disputes
 *              - independently_satisfied_baseline)
 *
 * Pure arithmetic; the caller supplies deterministically-summed inputs. Clamped
 * at zero (never negative) — an agent cannot receive "negative credit" for an
 * over-refunded claim, it simply retains zero.
 */
export interface RetainedValueInputs {
  readonly eligibleRecoveryCaptures: Money;
  readonly linkedRefunds: Money;
  readonly linkedReversals: Money;
  readonly linkedDisputes: Money;
  readonly independentlySatisfiedBaseline: Money;
}

export function computeRetainedValue(inputs: RetainedValueInputs): Money {
  const currency = inputs.eligibleRecoveryCaptures.currency;
  for (const deduction of [
    inputs.linkedRefunds,
    inputs.linkedReversals,
    inputs.linkedDisputes,
    inputs.independentlySatisfiedBaseline,
  ]) {
    if (deduction.currency !== currency) {
      throw new Error(`retained-value currency mismatch: ${currency} vs ${deduction.currency}`);
    }
  }
  const netAmount =
    inputs.eligibleRecoveryCaptures.amountMinor -
    inputs.linkedRefunds.amountMinor -
    inputs.linkedReversals.amountMinor -
    inputs.linkedDisputes.amountMinor -
    inputs.independentlySatisfiedBaseline.amountMinor;
  const net: SignedMoney = { amountMinor: netAmount, currency };
  return maxWithZero(net);
}

/** True when the retained value is exactly zero (the opening-demo assertion). */
export function isFullyReversed(retained: Money): boolean {
  return retained.amountMinor === 0n;
}
