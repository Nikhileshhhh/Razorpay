/**
 * MoneyTrace versioned contracts (browser-safe).
 *
 * Everything re-exported here imports only `zod`, so the web bundle can reuse the
 * same schemas without pulling in server code, config, secrets, or the OpenAPI
 * generator. `registry.ts` and `openapi.ts` are intentionally NOT re-exported
 * from the barrel (the OpenAPI generator is imported directly by tooling/tests).
 */
export * from './common/versions.js';
export * from './common/limits.js';
export * from './common/roles.js';
export * from './common/identifiers.js';
export * from './common/money.js';
export * from './common/timestamps.js';
export * from './common/pagination.js';

export * from './events/event-types.js';
export * from './events/payloads.js';
export * from './events/canonical-event.js';
export * from './events/classification.js';
export * from './events/internal-events.js';

export * from './authority.js';
export * from './evidence.js';
export * from './cases.js';
export * from './plans.js';
export * from './findings.js';
export * from './agent-claims.js';
export * from './policy.js';
export * from './approvals.js';
export * from './actions.js';
export * from './verification.js';
export * from './reconciliation.js';
export * from './audit.js';
export * from './errors.js';

export * from './api-common.js';
export * from './api-endpoints.js';

export * from './health.js';
