import { describe, expect, it } from 'vitest';
import {
  MinorAmount,
  Money,
  SignedAmount,
  SignedMoney,
  SupportedCurrency,
} from '../../../src/contracts/common/money.js';

describe('money — minor amounts', () => {
  it('accepts canonical decimal integer strings', () => {
    for (const v of ['0', '1', '45500000', '999999999999']) {
      expect(MinorAmount.parse(v)).toBe(v);
    }
  });

  it('rejects JSON numbers (never z.number for money)', () => {
    expect(MinorAmount.safeParse(50000000 as unknown).success).toBe(false);
    expect(MinorAmount.safeParse(0 as unknown).success).toBe(false);
  });

  it('rejects malformed decimal strings', () => {
    for (const v of [
      '1.5',
      '1e3',
      '1E3',
      ' 5 ',
      '5 ',
      ' 5',
      '+5',
      '-5',
      '-0',
      '05',
      '007',
      '',
      'NaN',
      '0x1',
      '1_000',
    ]) {
      expect(MinorAmount.safeParse(v).success, `expected reject: ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe('money — signed amounts', () => {
  it('accepts signed differences only in signed fields', () => {
    for (const v of ['0', '5', '-5', '455', '-455']) {
      expect(SignedAmount.parse(v)).toBe(v);
    }
  });

  it('still rejects malformed signed strings', () => {
    for (const v of ['-0', '+5', '5.0', '-1e3', '00', '-05']) {
      expect(SignedAmount.safeParse(v).success, `expected reject: ${v}`).toBe(false);
    }
  });

  it('negative values are not accepted by the non-negative MinorAmount', () => {
    expect(MinorAmount.safeParse('-5').success).toBe(false);
  });
});

describe('money — Money object and currency', () => {
  it('accepts a well-formed INR money', () => {
    expect(Money.parse({ amount_minor: '45500000', currency: 'INR' })).toEqual({
      amount_minor: '45500000',
      currency: 'INR',
    });
  });

  it('rejects a material amount with a missing currency', () => {
    expect(Money.safeParse({ amount_minor: '45500000' }).success).toBe(false);
  });

  it('rejects a non-INR (cross-currency) code', () => {
    expect(Money.safeParse({ amount_minor: '1', currency: 'USD' }).success).toBe(false);
    expect(SupportedCurrency.safeParse('EUR').success).toBe(false);
  });

  it('rejects unknown properties on Money', () => {
    expect(Money.safeParse({ amount_minor: '1', currency: 'INR', note: 'x' }).success).toBe(false);
  });

  it('SignedMoney accepts a signed difference with currency', () => {
    expect(SignedMoney.parse({ amount_minor: '-4500', currency: 'INR' })).toEqual({
      amount_minor: '-4500',
      currency: 'INR',
    });
  });
});
