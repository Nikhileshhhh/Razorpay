import { z } from 'zod';

/**
 * JSON money.
 *
 * Money crossing a JSON boundary is ALWAYS a canonical decimal integer string in
 * minor units — never `z.number()`. The patterns reject numbers, decimals,
 * exponent notation, whitespace, plus signs, `NaN`-like strings, and leading
 * zeros other than the single `"0"`. This module defines the SHAPE only; the
 * `Money`/`bigint` arithmetic lives in the domain kernel (MT-003).
 */

/** Non-negative minor amount: `0` or a digit string with no leading zero. */
export const MINOR_AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,29})$/;
/** Signed difference/adjustment: as above, optionally negated (no `-0`, no `+`). */
export const SIGNED_AMOUNT_PATTERN = /^(0|-?[1-9][0-9]{0,29})$/;

export const MinorAmount = z.string().regex(MINOR_AMOUNT_PATTERN);
export type MinorAmount = z.infer<typeof MinorAmount>;

export const SignedAmount = z.string().regex(SIGNED_AMOUNT_PATTERN);
export type SignedAmount = z.infer<typeof SignedAmount>;

/**
 * Generic ISO-4217 uppercase 3-letter code FORMAT (documentation / preserved
 * source only). Authoritative money uses {@link SupportedCurrency} below.
 */
export const CURRENCY_CODE_FORMAT = /^[A-Z]{3}$/;

/**
 * Authoritative currency allowlist. The Buildathon allowlist is INR only, and
 * cross-currency input is rejected (handoff §2.5/§7.2 — the stricter
 * financial-safety rule). INR is also a valid uppercase 3-letter code, so this
 * satisfies the generic format requirement. Widening this requires a
 * schema-version bump AND a versioned conversion contract.
 */
export const SupportedCurrency = z.enum(['INR']);
export type SupportedCurrency = z.infer<typeof SupportedCurrency>;

/** A material amount always pairs a non-negative minor amount with a currency. */
export const Money = z.object({ amount_minor: MinorAmount, currency: SupportedCurrency }).strict();
export type Money = z.infer<typeof Money>;

/** A signed money value (differences, adjustments). */
export const SignedMoney = z
  .object({ amount_minor: SignedAmount, currency: SupportedCurrency })
  .strict();
export type SignedMoney = z.infer<typeof SignedMoney>;
