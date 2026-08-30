import { MINOR_AMOUNT_PATTERN, SIGNED_AMOUNT_PATTERN } from '../../contracts/common/money.js';

/**
 * Pure `bigint` money kernel (backend PRD §7.1).
 *
 * Domain money is `{ amountMinor: bigint, currency: 'INR' }`. This module has no
 * I/O, no DB, no HTTP, and no framework dependency — it reuses only the
 * browser-safe regex patterns from `src/contracts/common/money.ts` so the
 * wire-format rules (reject exponents, decimals, whitespace, leading `+`, unsafe
 * leading zeroes, non-INR currency) are defined exactly once.
 *
 * JavaScript `number` and floating SQL types never participate in a financial
 * decision. Every parse boundary (JSON, Postgres `BIGINT`) goes through the
 * functions here.
 */

export type Currency = 'INR';

/** A non-negative money value. */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

/** A possibly-negative money value (differences, adjustments). */
export interface SignedMoney {
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

export class InvalidMoneyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyInputError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: Currency,
    readonly right: Currency,
  ) {
    super(`currency mismatch: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

function assertCurrency(currency: string): asserts currency is Currency {
  if (currency !== 'INR') {
    throw new InvalidMoneyInputError(`unsupported currency: ${currency} (schema 1.0 is INR-only)`);
  }
}

/** Parse a canonical non-negative decimal-string amount into a `Money`. */
export function moneyFromMinorString(amountMinor: string, currency: string): Money {
  if (!MINOR_AMOUNT_PATTERN.test(amountMinor)) {
    throw new InvalidMoneyInputError(`invalid minor amount string: ${JSON.stringify(amountMinor)}`);
  }
  assertCurrency(currency);
  return { amountMinor: BigInt(amountMinor), currency };
}

/** Parse a canonical signed decimal-string amount into a `SignedMoney`. */
export function signedMoneyFromString(amountMinor: string, currency: string): SignedMoney {
  if (!SIGNED_AMOUNT_PATTERN.test(amountMinor)) {
    throw new InvalidMoneyInputError(
      `invalid signed amount string: ${JSON.stringify(amountMinor)}`,
    );
  }
  assertCurrency(currency);
  return { amountMinor: BigInt(amountMinor), currency };
}

/** Construct a `Money` directly from a validated non-negative `bigint`. */
export function money(amountMinor: bigint, currency: Currency = 'INR'): Money {
  if (amountMinor < 0n) {
    throw new InvalidMoneyInputError('Money.amountMinor must be non-negative; use SignedMoney');
  }
  return { amountMinor, currency };
}

export function signedMoney(amountMinor: bigint, currency: Currency = 'INR'): SignedMoney {
  return { amountMinor, currency };
}

export function zero(currency: Currency = 'INR'): Money {
  return { amountMinor: 0n, currency };
}

/** Canonical decimal-integer-string serialization for the JSON/API boundary. */
export function toMinorString(value: Money | SignedMoney): string {
  return value.amountMinor.toString();
}

function assertSameCurrency(a: { currency: Currency }, b: { currency: Currency }): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Subtract two non-negative amounts; the result may be negative (a difference). */
export function subtractMoney(a: Money, b: Money): SignedMoney {
  assertSameCurrency(a, b);
  return signedMoney(a.amountMinor - b.amountMinor, a.currency);
}

export function addSigned(a: SignedMoney, b: SignedMoney): SignedMoney {
  assertSameCurrency(a, b);
  return signedMoney(a.amountMinor + b.amountMinor, a.currency);
}

/** -1 if a<b, 0 if equal, 1 if a>b. Requires currency equality. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function isZero(value: Money | SignedMoney): boolean {
  return value.amountMinor === 0n;
}

export function isEqualMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/** Absolute value of a signed amount, converted back to non-negative `Money`. */
export function absMoney(value: SignedMoney): Money {
  const amt = value.amountMinor < 0n ? -value.amountMinor : value.amountMinor;
  return money(amt, value.currency);
}

/**
 * `max(0, value)` — used by the retained-value equation (backend PRD §13.3),
 * which is explicitly clamped at zero rather than allowed to go negative.
 */
export function maxWithZero(value: SignedMoney): Money {
  return value.amountMinor < 0n ? zero(value.currency) : money(value.amountMinor, value.currency);
}
