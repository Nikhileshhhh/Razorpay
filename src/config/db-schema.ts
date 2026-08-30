/**
 * Drizzle schema barrel — typed query-building definitions mirroring
 * `db/migrations/*.sql` (the source of truth for constraints/triggers).
 * Backend PRD §8. Lives under `src/config` (server-only, "config owns … db")
 * so it compiles within the server build's `rootDir`.
 */
export * from './db-schema/identity.js';
export * from './db-schema/evidence.js';
export * from './db-schema/financial.js';
export * from './db-schema/cases.js';
export * from './db-schema/provenance.js';
export * from './db-schema/investigation.js';
export * from './db-schema/control-loop.js';
export * from './db-schema/verification.js';
export * from './db-schema/claims.js';
export * from './db-schema/audit-demo.js';
