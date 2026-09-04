import type { Pool } from 'pg';
import { isDemoLikeEnvironment, type Env, type MoneyTraceEnvironment } from '../../config/env.js';
import type { Database } from '../../config/db.js';
import { sql } from 'drizzle-orm';
import { seedIdentity } from './seed-identity.js';
import { seedSourceConnections } from './seed-sources.js';
import { seedVerificationContracts } from '../verification/verification-contracts-seed.js';
import { seedPolicyBundle } from '../policy/policy-bundle.js';
import { DEMO_FIXED_CLOCK, generateDemoDataset } from './dataset.js';
import { demoScenarioState } from '../../config/db-schema.js';
import { REGISTERED_DEMO_TENANT_ID } from './demo-tenant.js';
import { createTenantContext } from '../identity/tenant-context.js';

type ModelEnv = Pick<Env, 'MODEL_PROVIDER' | 'MODEL_API_URL' | 'MODEL_API_KEY'>;
const DEFAULT_MODEL_ENV: ModelEnv = { MODEL_PROVIDER: 'stub' };

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
  'worker_heartbeat',
  'demo_seed_manifest',
  'demo_scenario_state',
  'demo_dataset_records',
  'data_imports',
  'audit_entries',
  'claim_evaluation_heads',
  'claim_evaluations',
  'agent_claim_evidence_bindings',
  'agent_result_claims',
  'receivable_closures',
  'reconciliation_reversals',
  'reconciliation_allocations',
  'verification_run_heads',
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
  readonly resourceVersion: number;
}

/**
 * Full deterministic reset (backend PRD §16.2). Truncate everything, reseed
 * identity/sources/policy/verification-contracts atomically, then generate
 * the 500-record dataset and compute its manifest from persisted state.
 *
 * The truncate+identity-seed phase is one atomic transaction: a seed failure
 * rolls the destructive truncate back instead of leaving an empty or
 * partially seeded demo database. The dataset-generation phase that follows
 * is NOT part of that same transaction — it drives real application
 * services (investigation, policy, action reservation/dispatch,
 * verification) for the duplicate-recovery-prevention record, each of which
 * commits its own transaction, so nesting the entire 500-record sequence
 * inside one outer transaction is not possible without relying on fragile
 * cross-module savepoint behavior. This is an explicit, documented
 * tradeoff (`docs/GATE_B4_IMPLEMENTATION_PLAN.md` §5.1: "do not claim false
 * atomicity") — a failure partway through dataset generation leaves a
 * partially seeded DISPOSABLE demo database, which the next reset's leading
 * `TRUNCATE` always repairs from a clean slate. Every individual step is
 * itself atomic and safe to retry.
 */
export async function resetDemoDatabase(
  _pool: Pool,
  db: Database,
  environment: MoneyTraceEnvironment,
  seedId = 'moneytrace_demo_v1',
  modelEnv: ModelEnv = DEFAULT_MODEL_ENV,
): Promise<ResetResult> {
  if (!isDemoLikeEnvironment(environment)) {
    throw new DemoNotAllowedError();
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate table ${ALL_APP_TABLES.join(', ')} cascade`));
    await seedIdentity(tx);
    await seedSourceConnections(tx);
    await seedPolicyBundle(tx);
    await seedVerificationContracts(tx);
  });

  const generated = await generateDemoDataset(
    db,
    modelEnv,
    createTenantContext(REGISTERED_DEMO_TENANT_ID, environment),
    seedId,
  );
  const manifestHash = generated.manifestHash;
  await db.execute(sql`
    insert into audit_entries
      (id, tenant_id, artifact_type, artifact_id, artifact_hash, actor_role, details, created_at)
    values
      (${`audit_demo_reset_${seedId}`}, ${REGISTERED_DEMO_TENANT_ID}, 'DEMO_COMMAND', ${seedId}, ${manifestHash},
       'worker', ${JSON.stringify({ operation: 'demo_reset', seed_id: seedId, manifest_hash: manifestHash })}::jsonb,
       ${DEMO_FIXED_CLOCK})
    on conflict (id) do nothing
  `);

  const versions = await db
    .select({ version: demoScenarioState.version })
    .from(demoScenarioState)
    .where(sql`${demoScenarioState.tenantId} = ${REGISTERED_DEMO_TENANT_ID}`);
  const resourceVersion = Math.max(...versions.map((row) => row.version), 0);
  return { manifestHash, seedId, resourceVersion };
}
