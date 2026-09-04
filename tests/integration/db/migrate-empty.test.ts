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
        'verification_run_heads',
        'reconciliation_allocations',
        'receivable_closures',
        'reconciliation_reversals',
        'agent_result_claims',
        'agent_claim_evidence_bindings',
        'claim_evaluations',
        'claim_evaluation_heads',
        'audit_entries',
        'demo_scenario_state',
        'demo_dataset_records',
        'data_imports',
        'worker_heartbeat',
      ]) {
        expect(names, `missing table: ${required}`).toContain(required);
      }
    } finally {
      await client.end();
    }
  });

  it('applies the initial schema before all six forward integrity migrations', async () => {
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ id: string }>(
        `select id from schema_migrations order by applied_at, id`,
      );
      expect(result.rows.map((row) => row.id)).toEqual([
        '0001_init.sql',
        '0002_b1_b2_integrity.sql',
        '0003_b3_reliability.sql',
        '0004_b4_integrity.sql',
        '0005_b4_import_async.sql',
        '0006_b4_scenario_status.sql',
        '0007_b4_claim_evidence_bindings.sql',
      ]);
    } finally {
      await client.end();
    }
  });

  it('has the exact B4 runtime-classified unique constraint names (ADR 0002)', async () => {
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ conname: string }>(
        `select conname from pg_constraint where conname = any($1::text[]) order by conname`,
        [
          [
            'reconciliation_allocations_bank_line_uq',
            'reconciliation_allocations_expectation_uq',
            'reconciliation_allocations_tenant_id_id_uq',
            'verification_runs_tenant_id_id_uq',
            'claim_evaluations_tenant_id_id_uq',
            'receivable_closures_allocation_uq',
            'receivable_closures_expectation_uq',
            'receivable_closures_action_uq',
            'receivable_closures_evidence_uq',
            'reconciliation_reversals_allocation_uq',
            'reconciliation_reversals_evidence_uq',
            'data_imports_tenant_id_id_uq',
            'demo_dataset_records_ordinal_uq',
            'demo_dataset_records_ingest_uq',
          ],
        ],
      );
      expect(result.rows.map((r) => r.conname).sort()).toEqual(
        [
          'claim_evaluations_tenant_id_id_uq',
          'reconciliation_allocations_bank_line_uq',
          'reconciliation_allocations_expectation_uq',
          'reconciliation_allocations_tenant_id_id_uq',
          'verification_runs_tenant_id_id_uq',
          'receivable_closures_allocation_uq',
          'receivable_closures_expectation_uq',
          'receivable_closures_action_uq',
          'receivable_closures_evidence_uq',
          'reconciliation_reversals_allocation_uq',
          'reconciliation_reversals_evidence_uq',
          'data_imports_tenant_id_id_uq',
          'demo_dataset_records_ordinal_uq',
          'demo_dataset_records_ingest_uq',
        ].sort(),
      );
    } finally {
      await client.end();
    }
  });

  it('drops the contradictory is_current columns and adds append-only history triggers (D2)', async () => {
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      const cols = await client.query<{ table_name: string }>(
        `select table_name from information_schema.columns
         where column_name = 'is_current' and table_name in ('verification_runs', 'claim_evaluations')`,
      );
      expect(cols.rows).toHaveLength(0);
      const trg = await client.query<{ tgname: string }>(
        `select tgname from pg_trigger where tgname in (
           'verification_runs_append_only', 'receivable_closures_append_only',
           'reconciliation_reversals_append_only', 'data_imports_append_only',
           'demo_dataset_records_append_only'
         )`,
      );
      expect(trg.rows.length).toBe(5);
      const rh = await client.query(
        `select 1 from information_schema.columns where table_name = 'agent_result_claims' and column_name = 'request_hash'`,
      );
      expect(rh.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('Gate B4 remediation migrations 0005/0006/0007: exact catalog evidence', async () => {
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      const check = await client.query<{ consrc: string }>(
        `select pg_get_constraintdef(oid) as consrc from pg_constraint
         where conrelid = 'data_imports'::regclass and conname = 'data_imports_status_check'`,
      );
      expect(check.rows).toHaveLength(1);
      expect(check.rows[0]!.consrc).toContain("'pending'");
      expect(check.rows[0]!.consrc).toContain("'accepted'");
      expect(check.rows[0]!.consrc).toContain("'failed'");

      const cols = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'demo_scenario_state' and column_name in ('completed_step', 'last_error')`,
      );
      expect(cols.rows.map((r) => r.column_name).sort()).toEqual(['completed_step', 'last_error']);

      const bindings = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes where tablename = 'agent_claim_evidence_bindings'
         and indexname in ('agent_claim_capture_attribution_uq', 'agent_claim_evidence_bindings_claim_event_uq')
         order by indexname`,
      );
      expect(bindings.rows.map((row) => row.indexname)).toEqual([
        'agent_claim_capture_attribution_uq',
        'agent_claim_evidence_bindings_claim_event_uq',
      ]);
      const trigger = await client.query<{ tgname: string }>(
        `select tgname from pg_trigger where tgname = 'agent_claim_evidence_bindings_append_only'`,
      );
      expect(trigger.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('is idempotent: running migrations again applies nothing further', async () => {
    const second = await runMigrations(testDb.databaseUrl);
    expect(second.every((r) => r.status === 'already_applied')).toBe(true);
  });
});
