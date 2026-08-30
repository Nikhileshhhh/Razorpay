/**
 * Deterministic financial kernel (pure domain).
 *
 * This layer is intentionally pure: no I/O, no framework, no database, no
 * model, no integration, no web, and no configuration imports (enforced by
 * ESLint and by tests/unit/architecture-boundaries.test.ts). It may import
 * `src/contracts` (browser-safe, also pure) to reuse wire-format validation
 * patterns without duplicating them.
 */
export const DOMAIN_LAYER = 'domain' as const;

export * from './money/index.js';
export * from './state-machines/index.js';
