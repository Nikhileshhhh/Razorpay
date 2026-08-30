import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import { runMigrations } from '../../../scripts/db/migrate.js';

/**
 * "Migrate from an empty database" and migration idempotency (backend PRD
 * §19.2). Uses ONE real, ephemeral PostgreSQL database for this file (created
 * once in `beforeAll`) — not the shared dev database — so this genuinely
 * proves the migration applies cleanly from nothing, without paying the cost
 * of a fresh CREATE DATABASE per assertion.
 */
describe('migrate from an empty database', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDb?.teardown();
  });

  it('creates every required table group from an empty database', async () => {
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
      );
      const names = result.rows.map((r) => r.table_name);
      for (const required of [
        'tenants',
        'users',
        'memberships',
        'ingest_events',
        'event_conflicts',
        'projector_runs',
        'entity_revisions',
        'entity_current',
        'economic_subjects',
        'expectations',
        'invariant_evaluations',
        'financial_outcomes',
        'cases',
        'case_transitions',
        'case_notes',
        'case_relationships',
        'entity_links',
        'entity_link_reviews',
        'evidence_sets',
        'evidence_set_items',
        'investigations',
        'plans',
        'policy_bundles',
        'policy_decisions',
        'approvals',
        'actions',
        'action_attempts',
        'outbox',
        'verification_contracts',
        'verification_runs',
        'reconciliation_allocations',
        'agent_result_claims',
        'claim_evaluations',
        'audit_entries',
        'demo_scenario_state',
      ]) {
        expect(names, `missing table: ${required}`).toContain(required);
      }
    } finally {
      await client.end();
    }
  });

  it('applies the initial schema before the forward B1/B2 integrity migration', async () => {
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ id: string }>(
        `select id from schema_migrations order by applied_at, id`,
      );
      expect(result.rows.map((row) => row.id)).toEqual([
        '0001_init.sql',
        '0002_b1_b2_integrity.sql',
      ]);
    } finally {
      await client.end();
    }
  });

  it('is idempotent: running migrations again applies nothing further', async () => {
    const second = await runMigrations(testDb.databaseUrl);
    expect(second.every((r) => r.status === 'already_applied')).toBe(true);
  });
});
