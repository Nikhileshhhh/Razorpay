import type { Pool } from 'pg';
import { isDemoLikeEnvironment, type MoneyTraceEnvironment } from '../../config/env.js';
import type { Database } from '../../config/db.js';
import { sql } from 'drizzle-orm';
import { seedIdentity } from './seed-identity.js';
import { seedSourceConnections } from './seed-sources.js';
import { SEED_TENANTS, SEED_USERS } from '../identity/seed-data.js';
import { contentHash } from './manifest.js';

export class DemoNotAllowedError extends Error {
  constructor() {
    super('demo reset/advance is only permitted in demo/buildathon environments');
    this.name = 'DemoNotAllowedError';
  }
}

/**
 * Every application table except the migration bookkeeping table, in an order
 * that does not matter because `CASCADE` is specified and all dependents are
 * listed explicitly in one statement (backend PRD §16, §21: reset is
 * destructive only for the disposable demo database).
 *
 * NOTE: `TRUNCATE` does not fire `BEFORE DELETE` triggers in PostgreSQL, so the
 * append-only `forbid_update_delete` triggers do not block this full-wipe reset
 * — they continue to block ordinary application UPDATE/DELETE statements.
 */
export const ALL_APP_TABLES = [
  'demo_seed_manifest',
  'demo_scenario_state',
  'audit_entries',
  'claim_evaluations',
  'agent_result_claims',
  'reconciliation_allocations',
  'verification_runs',
  'verification_contracts',
  'outbox',
  'action_attempts',
  'actions',
  'approvals',
  'policy_decisions',
  'policy_bundles',
  'plans',
  'investigations',
  'evidence_set_items',
  'evidence_sets',
  'entity_link_reviews',
  'entity_links',
  'case_notes',
  'case_relationships',
  'case_transitions',
  'cases',
  'financial_outcomes',
  'invariant_evaluations',
  'expectation_inputs',
  'expectations',
  'economic_subjects',
  'entity_current',
  'entity_revisions',
  'projector_runs',
  'event_conflicts',
  'ingest_events',
  'source_connections',
  'memberships',
  'users',
  'tenants',
] as const;

export interface ResetResult {
  readonly manifestHash: string;
  readonly seedId: string;
}

/**
 * Full deterministic reset (backend PRD §16.2). Gate B1 scope: truncate
 * everything, then reseed identity. Later gates extend this to also seed the
 * 500-record synthetic dataset and reset demo scenario state; the manifest
 * hash is recomputed from the full persisted state at that point.
 */
export async function resetDemoDatabase(
  _pool: Pool,
  db: Database,
  environment: MoneyTraceEnvironment,
  seedId = 'moneytrace_demo_v1',
): Promise<ResetResult> {
  if (!isDemoLikeEnvironment(environment)) {
    throw new DemoNotAllowedError();
  }

  // Truncation and deterministic reseeding are one atomic operation. A seed
  // failure rolls the destructive truncate back instead of leaving an empty
  // or partially seeded demo database.
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate table ${ALL_APP_TABLES.join(', ')} cascade`));
    await seedIdentity(tx);
    await seedSourceConnections(tx);
  });

  const manifestHash = contentHash({
    seedId,
    tenants: SEED_TENANTS,
    users: SEED_USERS,
  });

  return { manifestHash, seedId };
}
