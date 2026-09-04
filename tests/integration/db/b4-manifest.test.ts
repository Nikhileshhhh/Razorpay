import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import { resetDemoDatabase } from '../../../src/modules/demo/reset.js';
import { computeDatasetMetrics } from '../../../src/modules/demo/manifest-metrics.js';
import { runDemoScenarioStep } from '../../../src/modules/demo/scenario-runner.js';
import { generateDemoDataset } from '../../../src/modules/demo/dataset.js';
import {
  advanceDemoScenario,
  enqueueDatasetImport,
  getDataHealth,
  getOverview,
} from '../../../src/modules/demo/demo-service.js';
import { DemoTenantMismatchError } from '../../../src/modules/demo/demo-tenant.js';
import {
  DEMO_STEP_FAILED_CODE,
  recordDemoScenarioFailure,
} from '../../../src/worker/job-handlers-b4.js';
import { completeDuplicateRecoveryPrevention } from '../../../src/worker/complete-duplicate-recovery.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';

/**
 * Drives the ONE dataset-seeded CTRL-04 duplicate-recovery-prevention record
 * (ordinal 468, subject `dataset:matched:468`) to completion exactly the way
 * the real worker would (Gate B4 remediation: the API/reset path never
 * dispatches — see `complete-duplicate-recovery.ts`).
 */
async function completeDatasetDuplicateRecoveryPrevention(
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<void> {
  const caseRows = await db
    .select({ id: schema.cases.id })
    .from(schema.cases)
    .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
    .where(
      and(
        eq(schema.economicSubjects.subjectKey, 'dataset:matched:468'),
        eq(schema.cases.controlId, 'CTRL-04'),
      ),
    );
  const actionRows = await db
    .select({ id: schema.actions.id })
    .from(schema.actions)
    .where(eq(schema.actions.caseId, caseRows[0]!.id));
  await completeDuplicateRecoveryPrevention(
    db,
    createTenantContext('ten_demo', 'demo'),
    actionRows[0]!.id,
  );
}

const env = { MONEYTRACE_ENV: 'test' as const, MODEL_PROVIDER: 'stub' };
const ctx = createTenantContext('ten_demo', 'demo');

/**
 * Backend PRD §16.1: the manifest is calculated from persisted records, not
 * returned as narrative constants. This drives a real reset (the full
 * service-backed 500-record dataset, not hand-rolled rows) and proves every
 * one of the eight metrics is genuinely measured and changes deterministically
 * as named scenarios advance — not a frozen constant.
 */
describe('Gate B4 dataset manifest — measured, not narrated', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await resetDemoDatabase(pool, db, 'demo');
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  it('asserts every structural metric immediately after reset', async () => {
    const metrics = await computeDatasetMetrics(db, 'ten_demo', 'moneytrace_demo_v1');
    expect(metrics.records_total).toBe(500);
    expect(metrics.records_matched).toBe(468);
    expect(metrics.unresolved_cases).toBe(16);
    expect(metrics.unsafe_candidate_matches_blocked).toBe(4);
    expect(metrics.unresolved_exposure).toBe('128000000');
    // Gate B4 remediation: reset/import never dispatches (adapter dispatch is
    // worker-only). The CTRL-04 duplicate-recovery-prevention record is
    // reserved (a durable outbox job queued) but NOT yet completed —
    // `duplicate_collection_prevented` is genuinely `0` until a worker
    // actually drains that job, never a value produced synchronously here.
    expect(metrics.duplicate_collection_prevented).toBe('0');
    // Not yet produced — no named scenario has advanced.
    expect(metrics.verified_restored).toBe('0');
    expect(metrics.reversed_recovery).toBe('0');

    // Simulate the worker draining the queued job (never something the API
    // or reset path does itself) so the later assertions in this describe
    // block can observe the metric once it is genuinely complete.
    await completeDatasetDuplicateRecoveryPrevention(db);
    const afterCompletion = await computeDatasetMetrics(db, 'ten_demo', 'moneytrace_demo_v1');
    expect(afterCompletion.duplicate_collection_prevented).toBe('50000000');

    const overview = await getOverview(db, ctx);
    expect(overview.claim_truth_comparison).toBeNull();
    const persistedCases = await db
      .select({ exposureAmountMinor: schema.cases.exposureAmountMinor })
      .from(schema.cases)
      .where(eq(schema.cases.tenantId, 'ten_demo'));
    const persistedExposure = persistedCases.reduce(
      (sum, row) => sum + row.exposureAmountMinor,
      0n,
    );
    const overviewExposure = overview.lifecycle_distribution.reduce(
      (sum, row) => sum + BigInt(row.exposure_amount.amount_minor),
      0n,
    );
    expect(overviewExposure).toBe(persistedExposure);
  });

  it('computes Data Health duplicate/per-source-conflict metrics from persisted facts', async () => {
    const health = await getDataHealth(db, ctx, 'stub');
    const conflictRows = await db
      .select()
      .from(schema.eventConflicts)
      .where(eq(schema.eventConflicts.tenantId, 'ten_demo'));
    // Exactly the 12 OTHER-UNMATCHED dataset records (`dataset-flows.ts`'s
    // `seedConflictedRecord`), each producing one real same-source-id/
    // different-hash quarantine into `event_conflicts` — never a fabricated
    // count.
    expect(conflictRows).toHaveLength(12);
    expect(health.conflict_total).toBe(conflictRows.length);
    const conflictsBySource = new Map<string, number>();
    for (const row of conflictRows) {
      conflictsBySource.set(row.sourceSystem, (conflictsBySource.get(row.sourceSystem) ?? 0) + 1);
    }
    for (const source of health.sources) {
      expect(source.conflict).toBe(conflictsBySource.get(source.source_system) ?? 0);
    }

    const evidenceAudits = await db
      .select({ artifactId: schema.auditEntries.artifactId, details: schema.auditEntries.details })
      .from(schema.auditEntries)
      .where(
        and(
          eq(schema.auditEntries.tenantId, 'ten_demo'),
          eq(schema.auditEntries.artifactType, 'EVIDENCE'),
        ),
      );
    const duplicateEventIds = new Set(
      evidenceAudits
        .filter((row) => (row.details as { outcome?: string }).outcome === 'duplicate')
        .map((row) => row.artifactId),
    );
    // `duplicate_total` is measured from persisted audit facts, not narrated
    // — no dataset flow submits an EXACT duplicate, so it is honestly 0 at
    // this point in the fixture, and the assertion is against the real
    // count either way, never a hard-coded expectation.
    expect(health.duplicate_total).toBe(duplicateEventIds.size);

    const overview = await getOverview(db, ctx);
    const caseRows = await db
      .select({ openedAt: schema.cases.openedAt, closedAt: schema.cases.closedAt })
      .from(schema.cases)
      .where(eq(schema.cases.tenantId, 'ten_demo'));
    const openedTotal = overview.opened_closed_trend.reduce((sum, row) => sum + row.opened, 0);
    const closedTotal = overview.opened_closed_trend.reduce((sum, row) => sum + row.closed, 0);
    expect(openedTotal).toBe(caseRows.length);
    expect(closedTotal).toBe(caseRows.filter((row) => row.closedAt !== null).length);
    // The trend is genuinely date-bucketed persisted fact, not a constant —
    // every dataset case opens at the fixed clock's date.
    expect(overview.opened_closed_trend.length).toBeGreaterThan(0);
  });

  it('rejects a missing outbox job by re-inserting it for an already-pending import row', async () => {
    const repairSeedId = 'repair_test_seed';
    await db.insert(schema.dataImports).values({
      id: `import_${repairSeedId}`,
      tenantId: 'ten_demo',
      source: 'registered_synthetic_seed',
      seedId: repairSeedId,
      itemCount: 500,
      acceptedCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      status: 'pending',
    });
    const beforeRepair = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, `outbox_import_${repairSeedId}`));
    expect(beforeRepair).toHaveLength(0);

    await enqueueDatasetImport(db, ctx, repairSeedId);

    const afterRepair = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, `outbox_import_${repairSeedId}`));
    expect(afterRepair).toHaveLength(1);
    expect(afterRepair[0]?.topic).toBe('process-import.v1');
    expect(afterRepair[0]?.status).toBe('pending');
    // The pending row itself was not duplicated by the repair call.
    const pendingRows = await db
      .select()
      .from(schema.dataImports)
      .where(eq(schema.dataImports.id, `import_${repairSeedId}`));
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]?.status).toBe('pending');
  });

  it('sanitizes a persisted scenario failure into a safe reason code, never a raw error', async () => {
    const sensitive = new Error(
      'connection to postgres://demo:s3cr3t-token@127.0.0.1/db failed at /internal/stack',
    );
    await recordDemoScenarioFailure(db, ctx, 'conflicting-bank-evidence', sensitive);
    const rows = await db
      .select({ lastError: schema.demoScenarioState.lastError })
      .from(schema.demoScenarioState)
      .where(
        and(
          eq(schema.demoScenarioState.tenantId, 'ten_demo'),
          eq(schema.demoScenarioState.scenarioId, 'conflicting-bank-evidence'),
        ),
      );
    expect(rows[0]?.lastError).toBe(DEMO_STEP_FAILED_CODE);
    expect(rows[0]?.lastError).not.toContain('s3cr3t-token');
    expect(rows[0]?.lastError).not.toContain('postgres://');
    // Clear it back to null so the later `getDemoStatus` status derivation
    // used by other tests in this file is unaffected.
    await db
      .update(schema.demoScenarioState)
      .set({ lastError: null })
      .where(
        and(
          eq(schema.demoScenarioState.tenantId, 'ten_demo'),
          eq(schema.demoScenarioState.scenarioId, 'conflicting-bank-evidence'),
        ),
      );
  });

  it('rejects every demo mutation/generation flow for any tenant other than the registered demo tenant', async () => {
    const otherCtx = createTenantContext('ten_other', 'demo');
    await expect(enqueueDatasetImport(db, otherCtx, 'moneytrace_demo_v1')).rejects.toBeInstanceOf(
      DemoTenantMismatchError,
    );
    await expect(advanceDemoScenario(db, otherCtx, 'claim-reversal', 0)).rejects.toBeInstanceOf(
      DemoTenantMismatchError,
    );
    await expect(
      generateDemoDataset(db, env, otherCtx, 'moneytrace_demo_v1'),
    ).rejects.toBeInstanceOf(DemoTenantMismatchError);
    await expect(
      runDemoScenarioStep(db, otherCtx, env, 'claim-reversal', 1),
    ).rejects.toBeInstanceOf(DemoTenantMismatchError);
  });

  it('reaches verified_restored=45,500,000 only after the remediation scenario fully advances', async () => {
    for (let step = 1; step <= 6; step += 1) {
      await runDemoScenarioStep(db, ctx, env, 'missing-transfer-remediation', step);
    }
    const metrics = await computeDatasetMetrics(db, 'ten_demo', 'moneytrace_demo_v1');
    expect(metrics.verified_restored).toBe('45500000');
    // Unaffected by this scenario.
    expect(metrics.reversed_recovery).toBe('0');
    expect(metrics.records_total).toBe(500);
  });

  it('reaches reversed_recovery=12,000,000 only after the claim-reversal scenario fully advances', async () => {
    for (let step = 1; step <= 3; step += 1) {
      await runDemoScenarioStep(db, ctx, env, 'claim-reversal', step);
    }
    const metrics = await computeDatasetMetrics(db, 'ten_demo', 'moneytrace_demo_v1');
    expect(metrics.reversed_recovery).toBe('12000000');
    // Confirms the full backend PRD §16.1 assertion list once every named
    // scenario relevant to a numeric metric has advanced.
    expect(metrics.verified_restored).toBe('45500000');
    expect(metrics.records_total).toBe(500);
    expect(metrics.records_matched).toBe(468);
    expect(metrics.unresolved_cases).toBe(16);
    expect(metrics.unsafe_candidate_matches_blocked).toBe(4);
    expect(metrics.unresolved_exposure).toBe('128000000');
    expect(metrics.duplicate_collection_prevented).toBe('50000000');

    const overview = await getOverview(db, ctx);
    expect(overview.claim_truth_comparison).toMatchObject({
      external_claim_id: 'demo_claim_reversal',
      claimed_amount: { amount_minor: '12000000', currency: 'INR' },
      recovery_payment_observed: true,
      correlated_refund_amount: { amount_minor: '12000000', currency: 'INR' },
      final_retained_value: { amount_minor: '0', currency: 'INR' },
      verified_incremental_recovery: { amount_minor: '0', currency: 'INR' },
      current_status: 'REVERSED',
    });
    expect(overview.claim_truth_comparison?.evidence_references).toContainEqual({
      evidence_id: expect.any(String),
      evidence_type: 'captured_payment',
    });
  });
});

describe('Gate B4 dataset manifest — reset determinism', () => {
  it('resetting twice produces an identical manifest hash and identical structural metrics', async () => {
    const testDbA = await createMigratedTestDatabase();
    try {
      const poolA = new pg.Pool({ connectionString: testDbA.databaseUrl });
      const dbA = drizzle(poolA, { schema });
      try {
        const first = await resetDemoDatabase(poolA, dbA, 'demo');
        const second = await resetDemoDatabase(poolA, dbA, 'demo');
        expect(second.manifestHash).toBe(first.manifestHash);
        const metrics = await computeDatasetMetrics(dbA, 'ten_demo', 'moneytrace_demo_v1');
        expect(metrics.records_total).toBe(500);
        expect(metrics.records_matched).toBe(468);
      } finally {
        await poolA.end();
      }
    } finally {
      await testDbA.teardown();
    }
  }, 600_000);
});
