import { describe, expect, it } from 'vitest';
import {
  allocate,
  allocateSellerObligation,
  roundHalfEvenDiv,
  SELLER_ALLOCATION_CONTRACT_V4,
} from '../../../../src/domain/money/allocation.js';
import { InvalidMoneyInputError, money } from '../../../../src/domain/money/money.js';

describe('roundHalfEvenDiv (banker rounding)', () => {
  it('rounds down/up on non-half remainders', () => {
    expect(roundHalfEvenDiv(9n, 4n)).toBe(2n); // 2.25 -> 2
    expect(roundHalfEvenDiv(11n, 4n)).toBe(3n); // 2.75 -> 3
  });

  it('rounds exact halves to the nearest even integer', () => {
    expect(roundHalfEvenDiv(1n, 2n)).toBe(0n); // 0.5 -> 0 (even)
    expect(roundHalfEvenDiv(3n, 2n)).toBe(2n); // 1.5 -> 2 (even)
    expect(roundHalfEvenDiv(5n, 2n)).toBe(2n); // 2.5 -> 2 (even)
    expect(roundHalfEvenDiv(7n, 2n)).toBe(4n); // 3.5 -> 4 (even)
  });
});

describe('allocate — exact demo contract (₹5,00,000)', () => {
  it('produces exactly ₹4,55,000 seller + ₹45,000 platform with zero residual', () => {
    const result = allocateSellerObligation(money(50000000n));
    expect(result.sellerAllocation.amountMinor).toBe(45500000n);
    expect(result.platformAllocation.amountMinor).toBe(4500000n);
    expect(result.residual.amountMinor).toBe(0n);
  });

  it('conserves the total exactly', () => {
    const total = money(50000000n);
    const result = allocateSellerObligation(total);
    const reconstructed =
      result.sellerAllocation.amountMinor +
      result.platformAllocation.amountMinor +
      result.residual.amountMinor;
    expect(reconstructed).toBe(total.amountMinor);
  });

  it('rates are exactly documented (91/100, 9/100)', () => {
    expect(SELLER_ALLOCATION_CONTRACT_V4.sellerRate).toEqual({ numerator: 91n, denominator: 100n });
    expect(SELLER_ALLOCATION_CONTRACT_V4.platformRate).toEqual({
      numerator: 9n,
      denominator: 100n,
    });
  });
});

describe('allocate — conservation properties (zero, boundary, rounding)', () => {
  it('conserves for a zero total', () => {
    const total = money(0n);
    const result = allocateSellerObligation(total);
    expect(
      result.sellerAllocation.amountMinor +
        result.platformAllocation.amountMinor +
        result.residual.amountMinor,
    ).toBe(0n);
  });

  it('conserves for an amount that does NOT divide evenly (rounding drift)', () => {
    // 1 paisa total split 91/9 does not divide evenly; residual must absorb drift.
    for (const amount of [1n, 2n, 3n, 7n, 99n, 101n, 999999n, 123456789n]) {
      const total = money(amount);
      const result = allocateSellerObligation(total);
      const sum =
        result.sellerAllocation.amountMinor +
        result.platformAllocation.amountMinor +
        result.residual.amountMinor;
      expect(sum, `amount=${amount}`).toBe(amount);
      expect(result.residual.amountMinor >= 0n, `residual non-negative for ${amount}`).toBe(true);
    }
  });

  it('rejects buckets whose rates sum to more than 1', () => {
    expect(() =>
      allocate(money(100n), [
        { key: 'a', rate: { numerator: 60n, denominator: 100n } },
        { key: 'b', rate: { numerator: 60n, denominator: 100n } },
      ]),
    ).toThrow(InvalidMoneyInputError);
  });

  it('rejects duplicate bucket keys and empty bucket lists', () => {
    expect(() => allocate(money(100n), [])).toThrow(InvalidMoneyInputError);
    expect(() =>
      allocate(money(100n), [
        { key: 'a', rate: { numerator: 1n, denominator: 2n } },
        { key: 'a', rate: { numerator: 1n, denominator: 2n } },
      ]),
    ).toThrow(InvalidMoneyInputError);
  });
});
