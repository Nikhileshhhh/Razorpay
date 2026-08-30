import { z } from 'zod';

/**
 * Centralized bounds for every untrusted string, array, identifier, summary,
 * reason, and explanation in the contract layer. Keeping them in one place makes
 * the limits auditable and consistent (no ad-hoc caps scattered across schemas).
 */
export const LIMITS = {
  ID_MAX: 128,
  KEY_MAX: 256,
  TOKEN_MAX: 128,
  CODE_MAX: 64,
  SHORT_TEXT: 200,
  TARGET_MAX: 256,
  SUMMARY_MAX: 1000,
  REASON_MAX: 1000,
  MESSAGE_MAX: 1000,
  EXPLANATION_MAX: 4000,
  NOTES_MAX: 500,
  ARRAY_MAX: 200,
  EVIDENCE_IDS_MAX: 200,
  EVIDENCE_TYPES_MAX: 50,
  RULES_MAX: 50,
  LIST_ITEMS_MAX: 500,
} as const;

/** A bounded, non-empty (by default) string. */
export const boundedString = (max: number, min = 1) => z.string().min(min).max(max);

/** A bounded array. */
export const boundedArray = <T extends z.ZodTypeAny>(schema: T, max: number = LIMITS.ARRAY_MAX) =>
  z.array(schema).max(max);
