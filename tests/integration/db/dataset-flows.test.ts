import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import { resetDemoDatabase } from '../../../src/modules/demo/reset.js';
import {
  seedConflictedRecord,
  seedDuplicateRecoveryPreventedRecord,
  seedMatchedRecord,
  seedUnresolvedRecord,
  seedUnsafeCandidateRecord,
} from '../../../src/modules/demo/dataset-flows.js';
import { completeDuplicateRecoveryPrevention } from '../../../src/worker/complete-duplicate-recovery.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import {
  enqueueDatasetImport,
  getDataHealth,
  getDemoStatus,
  getOverview,
} from '../../../src/modules/demo/demo-service.js';
import {
  ingestConflictingDuplicate,
  ingestSyntheticEvidence,
} from '../../../src/modules/demo/evidence-builder.js';
import { DemoTenantMismatchError } from '../../../src/modules/demo/demo-tenant.js';
import { recordDemoScenarioFailure } from '../../../src/worker/job-handlers-b4.js';

const CLOCK = new Date('2026-08-25T05:20:00.000Z');
const env = { MODEL_PROVIDER: 'stub' as const };
const ctx = createTenantContext('ten_demo', 'demo');

describe('Gate B4 dataset flows — individual bucket verification', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await resetDemoDatabase(pool, db, 'demo');
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  it('MATCHED: transfer-first ordering means CTRL-01 never opens a case', async () => {
    await seedMatchedRecord(db, ctx, 901, CLOCK, CLOCK);
    const rows = await db
      .select()
      .from(schema.cases)
      .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
      .where(eq(schema.economicSubjects.subjectKey, 'dataset:matched:901'));
    expect(rows).toHaveLength(0);
  });

  it('UNRESOLVED: capture-only with expired grace opens and keeps a CTRL-01 case', async () => {
    // captureTime well before the fixed clock so the 1-hour CTRL-01 grace has
    // expired by the time controls evaluate.
    const captureTime = new Date(CLOCK.getTime() - 2 * 60 * 60 * 1000);
    await seedUnresolvedRecord(db, ctx, 902, captureTime, CLOCK, 8_791_209n);
    const rows = await db
      .select()
      .from(schema.cases)
      .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
      .where(eq(schema.economicSubjects.subjectKey, 'dataset:unresolved:902'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cases.controlId).toBe('CTRL-01');
    expect(rows[0]?.cases.isActiveEpoch).toBe(true);
    expect(rows[0]?.cases.exposureAmountMinor).toBe(8_000_000n);
  });

  it('UNSAFE CANDIDATE: ambiguous reconciliation abstains and records the audit fact', async () => {
    const captureTime = new Date(CLOCK.getTime() - 2 * 60 * 60 * 1000);
    await seedUnsafeCandidateRecord(db, ctx, 903, captureTime, CLOCK, 8_791_209n);
    const caseRows = await db
      .select()
      .from(schema.cases)
      .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
      .where(eq(schema.economicSubjects.subjectKey, 'dataset:unsafe:903'));
    expect(caseRows).toHaveLength(1);
    const allocations = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.caseId, caseRows[0]!.cases.id));
    expect(allocations).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditEntries)
      .where(eq(schema.auditEntries.artifactType, 'RECONCILIATION'));
    const ambiguous = audits.filter(
      (row) => (row.details as { operation?: string }).operation === 'reconciliation_ambiguous',
    );
    expect(ambiguous.length).toBeGreaterThanOrEqual(1);
  });

  it('OTHER UNMATCHED: a real conflicting duplicate quarantines without opening a case', async () => {
    await seedConflictedRecord(db, ctx, 904, CLOCK, CLOCK);
    const caseRows = await db
      .select()
      .from(schema.cases)
      .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
      .where(eq(schema.economicSubjects.subjectKey, 'dataset:conflicted:904'));
    expect(caseRows).toHaveLength(0);
    const conflicts = await db
      .select()
      .from(schema.eventConflicts)
      .where(eq(schema.eventConflicts.tenantId, 'ten_demo'));
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('DUPLICATE RECOVERY PREVENTED: reservation is API-safe (no dispatch), completion is worker-only', async () => {
    await seedDuplicateRecoveryPreventedRecord(db, ctx, 905, CLOCK, CLOCK, env, 50_000_000n);
    const caseRows = await db
      .select()
      .from(schema.cases)
      .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
      .where(
        and(
          eq(schema.economicSubjects.subjectKey, 'dataset:matched:905'),
          eq(schema.cases.controlId, 'CTRL-04'),
        ),
      );
    expect(caseRows).toHaveLength(1);
    const actionRows = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.caseId, caseRows[0]!.cases.id));
    expect(actionRows).toHaveLength(1);
    const actionId = actionRows[0]!.id;
    // Reservation alone must never dispatch — no adapter call, no
    // suppression evidence, no verification run yet.
    expect(actionRows[0]?.status).not.toBe('ACKNOWLEDGED');
    const headsBefore = await db
      .select()
      .from(schema.verificationRunHeads)
      .where(eq(schema.verificationRunHeads.actionId, actionId));
    expect(headsBefore).toHaveLength(0);
    const suppressedBefore = await db
      .select()
      .from(schema.ingestEvents)
      .where(eq(schema.ingestEvents.economicSubjectHint, 'dataset:matched:905'));
    expect(suppressedBefore.some((row) => row.eventType === 'RecoverySuppressed')).toBe(false);
    // The completion job is durably queued, ready for a real worker.
    const outboxRows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.domainEventId, `duplicate-recovery-completion:${actionId}`));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.topic).toBe('complete-duplicate-recovery-prevention.v1');
    expect(outboxRows[0]?.status).toBe('pending');

    // Simulate the worker draining that job (never something the API does).
    await completeDuplicateRecoveryPrevention(
      db,
      createTenantContext('ten_demo', 'demo'),
      actionId,
      CLOCK,
    );
    const heads = await db
      .select()
      .from(schema.verificationRunHeads)
      .innerJoin(schema.actions, eq(schema.actions.id, schema.verificationRunHeads.actionId))
      .innerJoin(
        schema.verificationRuns,
        eq(schema.verificationRuns.id, schema.verificationRunHeads.currentRunId),
      )
      .where(eq(schema.actions.caseId, caseRows[0]!.cases.id));
    expect(heads).toHaveLength(1);
    expect(heads[0]?.verification_run_heads.status).toBe('EFFECT_VERIFIED');
    expect(heads[0]?.verification_runs.verifiedAmountMinor).toBe(50_000_000n);
  });

  it('Data Health measures exact duplicate and per-source conflict attempts from persisted facts', async () => {
    const before = await getDataHealth(db, ctx, 'stub', CLOCK);
    const input = {
      key: 'health_metrics_event',
      subject: 'dataset:health-metrics',
      type: 'OrderCreated' as const,
      source: 'SYNTHETIC_OMS' as const,
      occurredAt: CLOCK,
      ingestedAt: CLOCK,
      references: { order_id: 'health_metrics_order' },
    };
    expect(await ingestSyntheticEvidence(db, ctx, input)).toBeTruthy();
    expect(await ingestSyntheticEvidence(db, ctx, input)).toBeNull();
    expect(await ingestConflictingDuplicate(db, ctx, input)).toBe('conflict');

    const after = await getDataHealth(db, ctx, 'stub', CLOCK);
    expect(after.duplicate_total).toBe(before.duplicate_total + 1);
    expect(after.conflict_total).toBe(before.conflict_total + 1);
    expect(after.sources.reduce((sum, source) => sum + source.duplicate, 0)).toBe(
      after.duplicate_total,
    );
    expect(after.sources.reduce((sum, source) => sum + source.conflict, 0)).toBe(
      after.conflict_total,
    );
    const oms = after.sources.find((source) => source.source_system === 'SYNTHETIC_OMS');
    expect(oms?.duplicate).toBe(
      (before.sources.find((s) => s.source_system === 'SYNTHETIC_OMS')?.duplicate ?? 0) + 1,
    );
    expect(oms?.conflict).toBe(
      (before.sources.find((s) => s.source_system === 'SYNTHETIC_OMS')?.conflict ?? 0) + 1,
    );
  });

  it('overview opened/closed trend follows persisted case timestamps', async () => {
    const row = await db
      .select({ id: schema.cases.id })
      .from(schema.cases)
      .where(eq(schema.cases.tenantId, ctx.tenantId))
      .limit(1);
    expect(row[0]).toBeDefined();
    await db
      .update(schema.cases)
      .set({ closedAt: new Date('2026-08-26T03:00:00.000Z') })
      .where(and(eq(schema.cases.tenantId, ctx.tenantId), eq(schema.cases.id, row[0]!.id)));
    const overview = await getOverview(db, ctx, CLOCK);
    expect(overview.opened_closed_trend.find((point) => point.date === '2026-08-26')).toEqual({
      date: '2026-08-26',
      opened: 0,
      closed: 1,
    });
    const openedTotal = overview.opened_closed_trend.reduce((sum, point) => sum + point.opened, 0);
    const casesCount = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.cases)
      .where(eq(schema.cases.tenantId, ctx.tenantId));
    expect(openedTotal).toBe(casesCount[0]!.value);
  });

  it('repairs a pending import whose durable outbox row is missing', async () => {
    const seedId = 'repairable_import';
    await db.insert(schema.dataImports).values({
      id: `import_${seedId}`,
      tenantId: ctx.tenantId,
      source: 'registered_synthetic_seed',
      seedId,
      itemCount: 500,
      status: 'pending',
    });
    await enqueueDatasetImport(db, ctx, seedId);
    const jobs = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, `outbox_import_${seedId}`));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('pending');
  });

  it('rolls back pending import acceptance when its outbox insert fails', async () => {
    const seedId = 'atomic_import';
    await db.execute(sql`
      create or replace function reject_atomic_import_outbox() returns trigger as $$
      begin
        if new.id = 'outbox_import_atomic_import' then raise exception 'test rejection'; end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger reject_atomic_import_outbox_trigger before insert on outbox
      for each row execute function reject_atomic_import_outbox()
    `);
    try {
      await expect(enqueueDatasetImport(db, ctx, seedId)).rejects.toThrow();
      const rows = await db
        .select()
        .from(schema.dataImports)
        .where(eq(schema.dataImports.id, `import_${seedId}`));
      expect(rows).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists reject_atomic_import_outbox_trigger on outbox`);
      await db.execute(sql`drop function if exists reject_atomic_import_outbox()`);
    }
  });

  it('rejects a non-registered tenant before creating import state', async () => {
    const other = createTenantContext('ten_other', 'demo');
    await expect(enqueueDatasetImport(db, other, 'tenant_mismatch')).rejects.toBeInstanceOf(
      DemoTenantMismatchError,
    );
    const rows = await db
      .select()
      .from(schema.dataImports)
      .where(eq(schema.dataImports.id, 'import_tenant_mismatch'));
    expect(rows).toHaveLength(0);
  });

  it('persists only a safe scenario failure code, never a raw secret-bearing exception', async () => {
    const marker = 'TEST_ONLY_SECRET_MARKER_NEVER_PERSIST';
    await recordDemoScenarioFailure(
      db,
      ctx,
      'claim-reversal',
      new Error(`provider failed with ${marker}`),
    );
    const status = await getDemoStatus(db, ctx);
    const scenario = status.scenarios.find((item) => item.scenario_id === 'claim-reversal');
    expect(scenario?.status).toBe('failed');
    expect(scenario?.last_error).toBe('DEMO_STEP_FAILED');
    expect(JSON.stringify(scenario)).not.toContain(marker);
  });
});
