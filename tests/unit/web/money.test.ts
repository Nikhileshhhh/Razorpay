import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../../src/web/formatting/money.js';

describe('browser BigInt-safe money formatting', () => {
  it.each([
    ['0', '₹0.00 INR'],
    ['1', '₹0.01 INR'],
    ['100', '₹1.00 INR'],
    ['45500000', '₹4,55,000.00 INR'],
    ['123456789012345678901', '₹12,34,56,78,90,12,34,56,789.01 INR'],
    ['-12000000', '-₹1,20,000.00 INR'],
  ])('formats %s minor units as %s', (amountMinor, expected) => {
    expect(formatMoney({ amount_minor: amountMinor, currency: 'INR' })).toBe(expected);
  });

  it('rejects malformed input rather than coercing it', () => {
    expect(() => formatMoney({ amount_minor: '1.5', currency: 'INR' })).toThrow(
      'Unsupported money value',
    );
  });
});
