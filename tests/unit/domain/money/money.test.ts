import { describe, expect, it } from 'vitest';
import {
  absMoney,
  addMoney,
  compareMoney,
  CurrencyMismatchError,
  InvalidMoneyInputError,
  isEqualMoney,
  isZero,
  maxWithZero,
  money,
  moneyFromMinorString,
  signedMoney,
  signedMoneyFromString,
  subtractMoney,
  toMinorString,
  zero,
} from '../../../../src/domain/money/money.js';

describe('moneyFromMinorString', () => {
  it('parses canonical non-negative decimal strings', () => {
    const m = moneyFromMinorString('45500000', 'INR');
    expect(m.amountMinor).toBe(45500000n);
    expect(m.currency).toBe('INR');
  });

  it('rejects malformed strings (exponent, decimal, leading zero, plus, whitespace)', () => {
    for (const bad of ['1.5', '1e3', '+5', ' 5', '05', '', '-5']) {
      expect(() => moneyFromMinorString(bad, 'INR')).toThrow(InvalidMoneyInputError);
    }
  });

  it('rejects non-INR currency', () => {
    expect(() => moneyFromMinorString('1', 'USD')).toThrow(InvalidMoneyInputError);
  });
});

describe('signedMoneyFromString', () => {
  it('accepts a signed negative difference', () => {
    expect(signedMoneyFromString('-4500', 'INR').amountMinor).toBe(-4500n);
  });

  it('rejects -0 and malformed signed strings', () => {
    for (const bad of ['-0', '+5', '5.0', '-05']) {
      expect(() => signedMoneyFromString(bad, 'INR')).toThrow(InvalidMoneyInputError);
    }
  });
});

describe('money() construction', () => {
  it('rejects a negative bigint', () => {
    expect(() => money(-1n)).toThrow(InvalidMoneyInputError);
  });

  it('zero() is well-formed', () => {
    expect(isZero(zero())).toBe(true);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts same-currency amounts', () => {
    const a = money(500000n);
    const b = money(45500n);
    expect(addMoney(a, b).amountMinor).toBe(545500n);
    expect(subtractMoney(a, b).amountMinor).toBe(454500n);
  });

  it('subtraction can go negative (SignedMoney)', () => {
    const diff = subtractMoney(money(100n), money(150n));
    expect(diff.amountMinor).toBe(-50n);
  });

  it('rejects cross-currency arithmetic', () => {
    const inr = money(1n, 'INR');
    const other = { amountMinor: 1n, currency: 'USD' } as unknown as ReturnType<typeof money>;
    expect(() => addMoney(inr, other)).toThrow(CurrencyMismatchError);
  });

  it('compares amounts and requires currency equality', () => {
    expect(compareMoney(money(1n), money(2n))).toBe(-1);
    expect(compareMoney(money(2n), money(1n))).toBe(1);
    expect(compareMoney(money(2n), money(2n))).toBe(0);
  });

  it('isEqualMoney / absMoney / maxWithZero / toMinorString', () => {
    expect(isEqualMoney(money(5n), money(5n))).toBe(true);
    expect(absMoney(signedMoney(-5n)).amountMinor).toBe(5n);
    expect(maxWithZero(signedMoney(-5n)).amountMinor).toBe(0n);
    expect(maxWithZero(signedMoney(5n)).amountMinor).toBe(5n);
    expect(toMinorString(money(45500000n))).toBe('45500000');
  });
});
