import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import { resetDemoDatabase } from '../../../src/modules/demo/reset.js';
import { runDemoScenarioStep } from '../../../src/modules/demo/scenario-runner.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';

const env = {
  MONEYTRACE_ENV: 'test' as const,
  MODEL_PROVIDER: 'stub',
};
const ctx = createTenantContext('ten_demo', 'demo');

describe('Gate B4 persisted demo scenarios', () => {
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

  it('re-evaluates a ₹1.20 lakh recovery claim to zero/REVERSED after refund', async () => {
    for (let step = 1; step <= 3; step += 1) {
      await runDemoScenarioStep(db, ctx, env, 'claim-reversal', step);
    }
    const heads = await db.select().from(schema.claimEvaluationHeads);
    expect(heads).toHaveLength(1);
    expect(heads[0]?.status).toBe('REVERSED');
    const history = await db
      .select()
      .from(schema.claimEvaluations)
      .where(eq(schema.claimEvaluations.claimId, heads[0]!.claimId));
    expect(history.map((row) => row.status)).toEqual(['PENDING', 'VERIFIED', 'REVERSED']);
    expect(history.at(-1)?.verifiedAmountMinor).toBe(0n);
  });

  it('closes the ₹4.55 lakh remediation only after exact bank allocation and ERP observation', async () => {
    for (let step = 1; step <= 6; step += 1) {
      await runDemoScenarioStep(db, ctx, env, 'missing-transfer-remediation', step);
    }
    const subject = await db
      .select()
      .from(schema.economicSubjects)
      .where(eq(schema.economicSubjects.subjectKey, 'scenario:missing-transfer-remediation'))
      .limit(1);
    const caseRows = await db
      .select()
      .from(schema.cases)
      .where(
        and(eq(schema.cases.subjectId, subject[0]!.id), eq(schema.cases.controlId, 'CTRL-01')),
      );
    expect(caseRows).toHaveLength(1);
    expect(caseRows[0]?.lifecycleState).toBe('reconciled');
    const allocations = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.caseId, caseRows[0]!.id));
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.amountMinor).toBe(45_500_000n);
    const closures = await db
      .select()
      .from(schema.receivableClosures)
      .where(eq(schema.receivableClosures.allocationId, allocations[0]!.id));
    expect(closures).toHaveLength(1);
    const heads = await db
      .select()
      .from(schema.verificationRunHeads)
      .innerJoin(schema.actions, eq(schema.actions.id, schema.verificationRunHeads.actionId))
      .where(eq(schema.actions.caseId, caseRows[0]!.id));
    expect(heads).toHaveLength(2);
    expect(heads.every((row) => row.verification_run_heads.status === 'EFFECT_VERIFIED')).toBe(
      true,
    );
  });

  it('keeps incompatible bank evidence unresolved and records a conflict abstention', async () => {
    for (let step = 1; step <= 3; step += 1) {
      await runDemoScenarioStep(db, ctx, env, 'conflicting-bank-evidence', step);
    }
    const subject = await db
      .select()
      .from(schema.economicSubjects)
      .where(eq(schema.economicSubjects.subjectKey, 'scenario:conflicting-bank-evidence'))
      .limit(1);
    const caseRows = await db
      .select()
      .from(schema.cases)
      .where(
        and(eq(schema.cases.subjectId, subject[0]!.id), eq(schema.cases.controlId, 'CTRL-05')),
      );
    expect(caseRows).toHaveLength(1);
    expect(caseRows[0]?.lifecycleState).toBe('abstained');
    const investigations = await db
      .select()
      .from(schema.investigations)
      .where(eq(schema.investigations.caseId, caseRows[0]!.id));
    expect(investigations).toHaveLength(1);
    expect(investigations[0]?.output).toMatchObject({
      result_type: 'ABSTENTION',
      abstention_reason: 'CONFLICTING_EVIDENCE',
    });
  });

  it('replays evidence and execute without duplicating case, effect, allocation, or closure', async () => {
    for (let step = 1; step <= 4; step += 1) {
      await runDemoScenarioStep(db, ctx, env, 'duplicate-replay', step);
    }
    const subject = await db
      .select()
      .from(schema.economicSubjects)
      .where(eq(schema.economicSubjects.subjectKey, 'scenario:duplicate-replay'))
      .limit(1);
    const caseRows = await db
      .select()
      .from(schema.cases)
      .where(
        and(eq(schema.cases.subjectId, subject[0]!.id), eq(schema.cases.controlId, 'CTRL-01')),
      );
    expect(caseRows).toHaveLength(1);
    const actionRows = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.caseId, caseRows[0]!.id));
    expect(actionRows.filter((row) => row.toolId === 'SIMULATE_TRANSFER_REMEDIATION')).toHaveLength(
      1,
    );
    expect(
      actionRows.filter((row) => row.toolId === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.reconciliationAllocations)
        .where(eq(schema.reconciliationAllocations.caseId, caseRows[0]!.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.receivableClosures)
        .where(eq(schema.receivableClosures.caseId, caseRows[0]!.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.ingestEvents)
        .where(eq(schema.ingestEvents.economicSubjectHint, 'scenario:duplicate-replay')),
    ).toHaveLength(7);
  });
});
