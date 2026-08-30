import { describe, expect, it } from 'vitest';
import {
  adjustmentToSigned,
  applyAdjustment,
  createAdjustment,
} from '../../../../src/domain/money/adjustments.js';
import { InvalidMoneyInputError, money } from '../../../../src/domain/money/money.js';

describe('signed adjustments', () => {
  it('CREDIT is positive, DEBIT is negative', () => {
    const credit = createAdjustment('CREDIT', money(100n), 'MANUAL_CORRECTION');
    const debit = createAdjustment('DEBIT', money(100n), 'MANUAL_CORRECTION');
    expect(adjustmentToSigned(credit).amountMinor).toBe(100n);
    expect(adjustmentToSigned(debit).amountMinor).toBe(-100n);
  });

  it('rejects a negative absoluteAmount at construction', () => {
    expect(() =>
      createAdjustment('CREDIT', { amountMinor: -1n, currency: 'INR' }, 'REFUND'),
    ).toThrow(InvalidMoneyInputError);
  });

  it('applyAdjustment credits/debits a balance', () => {
    const base = money(1000n);
    const credited = applyAdjustment(base, createAdjustment('CREDIT', money(500n), 'REFUND'));
    expect(credited.amountMinor).toBe(1500n);
    const debited = applyAdjustment(base, createAdjustment('DEBIT', money(500n), 'REVERSAL'));
    expect(debited.amountMinor).toBe(500n);
  });

  it('rejects an adjustment that would drive the balance negative', () => {
    const base = money(100n);
    expect(() => applyAdjustment(base, createAdjustment('DEBIT', money(200n), 'REVERSAL'))).toThrow(
      InvalidMoneyInputError,
    );
  });
});
