import type { Sha256Hash } from '../../../contracts/index.js';

/**
 * Shared literals for the offline design mocks (frontend-only phase). These
 * values reproduce the fixed demo clock and manifest shown across every
 * `.dc.html` design ("25 Aug 2026, 10:50 IST" / manifest `7b42…91ef`) so every
 * mocked page reads as one consistent dataset snapshot.
 */
export const FIXED_CLOCK: string = '2026-08-25T05:20:00Z';
export const GENERATED_AT: string = '2026-08-25T05:20:05Z';
export const SEED_ID = 'moneytrace_demo_v1';

/** Builds a syntactically valid `sha256:<64 hex>` value from a short prefix and
 * suffix, matching the truncated hash shown in the designs (e.g. `7b42…91ef`).
 * The middle is deterministic filler — these are mock identifiers only, never
 * real content hashes. */
export function mockHash(prefix: string, suffix: string): Sha256Hash {
  const fill = '0123456789abcdef'.repeat(5);
  const middleLength = 64 - prefix.length - suffix.length;
  return `sha256:${prefix}${fill.slice(0, middleLength)}${suffix}` as Sha256Hash;
}

export const MANIFEST_HASH = mockHash('7b42', '91ef');

/** When the synthetic dataset itself was generated — distinct from `FIXED_CLOCK`
 * (the evaluation instant). Matches the `DATASET_IMPORT` audit entry. */
export const DATASET_GENERATED_AT: string = '2026-08-25T02:32:00Z';
