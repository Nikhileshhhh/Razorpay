import { InvalidMoneyInputError, type Money, money } from './money.js';

/**
 * Rational-rate allocation with round-half-even and an explicit residual
 * bucket (backend PRD §7.2). Rates are `(numerator, denominator)` — never a
 * floating-point fraction. Conservation is guaranteed BY CONSTRUCTION: the
 * residual is defined as `total - sum(bucket amounts)`, so
 * `sum(buckets) + residual === total` always holds, for zero, boundary, and
 * rounding-drift cases alike.
 */

export interface AllocationRate {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface AllocationBucketSpec {
  readonly key: string;
  readonly rate: AllocationRate;
}

export interface AllocationResult {
  /** One entry per input bucket key, in input order. */
  readonly buckets: ReadonlyMap<string, Money>;
  /** Always present; zero when rounding produced no drift. */
  readonly residual: Money;
  readonly residualKey: 'PLATFORM_ROUNDING_RESIDUAL';
}

/**
 * Round-half-even (banker's rounding) integer division of `numerator/denominator`.
 * `numerator` and `denominator` must both be non-negative with `denominator > 0`.
 */
export function roundHalfEvenDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n)
    throw new InvalidMoneyInputError('allocation denominator must be positive');
  if (numerator < 0n) throw new InvalidMoneyInputError('allocation numerator must be non-negative');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = remainder * 2n;
  if (twiceRemainder < denominator) return quotient;
  if (twiceRemainder > denominator) return quotient + 1n;
  // Exactly half: round to the nearest even quotient.
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

export function allocate(total: Money, buckets: readonly AllocationBucketSpec[]): AllocationResult {
  if (buckets.length === 0) {
    throw new InvalidMoneyInputError('allocate requires at least one bucket');
  }
  const seen = new Set<string>();
  const computed = new Map<string, Money>();
  let sum = 0n;
  for (const bucket of buckets) {
    if (seen.has(bucket.key)) {
      throw new InvalidMoneyInputError(`duplicate allocation bucket key: ${bucket.key}`);
    }
    seen.add(bucket.key);
    if (bucket.rate.numerator < 0n) {
      throw new InvalidMoneyInputError(
        `allocation rate numerator must be non-negative: ${bucket.key}`,
      );
    }
    const amount = roundHalfEvenDiv(
      total.amountMinor * bucket.rate.numerator,
      bucket.rate.denominator,
    );
    computed.set(bucket.key, money(amount, total.currency));
    sum += amount;
  }
  const residualAmount = total.amountMinor - sum;
  if (residualAmount < 0n) {
    throw new InvalidMoneyInputError(
      'allocation buckets sum to more than the total; rates must not exceed 1 in total',
    );
  }
  return {
    buckets: computed,
    residual: money(residualAmount, total.currency),
    residualKey: 'PLATFORM_ROUNDING_RESIDUAL',
  };
}

/**
 * The exact, versioned demo seller-allocation contract (backend PRD §7.2):
 * ₹5,00,000 capture = ₹4,55,000 seller obligation + ₹45,000 platform allocation
 * (91% / 9%, which happens to divide exactly for this demo amount).
 */
export const SELLER_ALLOCATION_CONTRACT_V4 = {
  ruleId: 'seller_allocation_rule',
  ruleVersion: 'contract_v4',
  sellerRate: { numerator: 91n, denominator: 100n } satisfies AllocationRate,
  platformRate: { numerator: 9n, denominator: 100n } satisfies AllocationRate,
} as const;

export interface SellerAllocation {
  readonly sellerAllocation: Money;
  readonly platformAllocation: Money;
  readonly residual: Money;
}

export function allocateSellerObligation(orderCapture: Money): SellerAllocation {
  const result = allocate(orderCapture, [
    { key: 'seller_allocation', rate: SELLER_ALLOCATION_CONTRACT_V4.sellerRate },
    { key: 'platform_allocation', rate: SELLER_ALLOCATION_CONTRACT_V4.platformRate },
  ]);
  const sellerAllocation = result.buckets.get('seller_allocation');
  const platformAllocation = result.buckets.get('platform_allocation');
  if (!sellerAllocation || !platformAllocation) {
    throw new InvalidMoneyInputError('seller allocation contract produced no buckets');
  }
  return { sellerAllocation, platformAllocation, residual: result.residual };
}
