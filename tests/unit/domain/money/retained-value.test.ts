import { describe, expect, it } from 'vitest';
import {
  computeRetainedValue,
  isFullyReversed,
} from '../../../../src/domain/money/retained-value.js';
import { money, zero } from '../../../../src/domain/money/money.js';

describe('retained-value equation (backend PRD §13.3)', () => {
  it('the opening demo claim: ₹1,20,000 claimed, ₹1,20,000 refunded -> ₹0, fully reversed', () => {
    const retained = computeRetainedValue({
      eligibleRecoveryCaptures: money(12000000n),
      linkedRefunds: money(12000000n),
      linkedReversals: zero(),
      linkedDisputes: zero(),
      independentlySatisfiedBaseline: zero(),
    });
    expect(retained.amountMinor).toBe(0n);
    expect(isFullyReversed(retained)).toBe(true);
  });

  it('a full, unrefunded capture is fully retained', () => {
    const retained = computeRetainedValue({
      eligibleRecoveryCaptures: money(12000000n),
      linkedRefunds: zero(),
      linkedReversals: zero(),
      linkedDisputes: zero(),
      independentlySatisfiedBaseline: zero(),
    });
    expect(retained.amountMinor).toBe(12000000n);
  });

  it('a partial refund reduces retained value proportionally', () => {
    const retained = computeRetainedValue({
      eligibleRecoveryCaptures: money(12000000n),
      linkedRefunds: money(5000000n),
      linkedReversals: zero(),
      linkedDisputes: zero(),
      independentlySatisfiedBaseline: zero(),
    });
    expect(retained.amountMinor).toBe(7000000n);
  });

  it('clamps at zero even when deductions exceed the capture', () => {
    const retained = computeRetainedValue({
      eligibleRecoveryCaptures: money(1000n),
      linkedRefunds: money(500n),
      linkedReversals: money(400n),
      linkedDisputes: money(400n),
      independentlySatisfiedBaseline: zero(),
    });
    expect(retained.amountMinor).toBe(0n);
  });

  it('an independently satisfied baseline offsets a claim entirely', () => {
    const retained = computeRetainedValue({
      eligibleRecoveryCaptures: money(5000n),
      linkedRefunds: zero(),
      linkedReversals: zero(),
      linkedDisputes: zero(),
      independentlySatisfiedBaseline: money(5000n),
    });
    expect(retained.amountMinor).toBe(0n);
  });
});
