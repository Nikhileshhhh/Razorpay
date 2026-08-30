import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { cases, caseRelationships, caseTransitions } from '../../../src/config/db-schema.js';
import { money } from '../../../src/domain/money/money.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { ensureSellerAllocationExpectation } from '../../../src/modules/expectations/expectation-service.js';
import {
  CaseVersionConflictError,
  openOrGetCase,
  transitionCase,
} from '../../../src/modules/cases/case-service.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('case concurrency and active epochs', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ctx = createTenantContext('ten_demo', 'demo');

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await seedIdentity(db);
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  it('creates one active epoch under concurrent opens and reopens after a terminal epoch', async () => {
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: 'order:case-concurrency:seller-1',
      orderCaptureAmountMinor: 50_000_000n,
    });
    const input = {
      controlId: 'CTRL-01',
      subjectId: expectation.subjectId,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      evaluationWindow: '2026-08-25T05:20:00.000Z',
      exposure: money(expectation.sellerAllocationMinor),
      priority: {
        exposure: money(expectation.sellerAllocationMinor),
        evidenceCoverage: 'partial' as const,
        customerHarmRisk: 'medium' as const,
        ageSeconds: 7200,
      },
    };
    const opened = await Promise.all(
      Array.from({ length: 8 }, () => openOrGetCase(db, ctx, input)),
    );
    expect(new Set(opened.map((item) => item.caseId)).size).toBe(1);
    expect(opened.filter((item) => item.created)).toHaveLength(1);
    const caseId = opened[0]!.caseId;

    const transitions = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        transitionCase(db, ctx, {
          caseId,
          toState: 'investigating',
          reason: 'TEST_ONLY_CONCURRENT_TRANSITION',
          expectedVersion: 0,
          actorId: 'user_investigator',
        }),
      ),
    );
    expect(transitions.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = transitions.find((item) => item.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(CaseVersionConflictError) });

    await transitionCase(db, ctx, {
      caseId,
      toState: 'cancelled',
      reason: 'TEST_ONLY_TERMINAL_EPOCH',
      expectedVersion: 1,
      actorId: 'user_investigator',
    });
    const reopened = await openOrGetCase(db, ctx, input);
    expect(reopened.created).toBe(true);
    expect(reopened.caseId).not.toBe(caseId);
    const epochs = await db
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, 'ten_demo'), eq(cases.caseDedupeKey, reopened.dedupeKey)));
    expect(epochs.map((row) => row.epoch).sort()).toEqual([0, 1]);
    expect(epochs.filter((row) => row.isActiveEpoch).map((row) => row.id)).toEqual([
      reopened.caseId,
    ]);
    const reopening = await db
      .select()
      .from(caseRelationships)
      .where(eq(caseRelationships.sourceCaseId, reopened.caseId));
    expect(reopening).toHaveLength(1);
    expect(reopening[0]).toMatchObject({
      targetCaseId: caseId,
      relationshipType: 'reopened_from',
    });
    const history = await db
      .select()
      .from(caseTransitions)
      .where(eq(caseTransitions.caseId, caseId));
    expect(history.map((row) => row.toState)).toEqual(
      expect.arrayContaining(['open', 'investigating', 'cancelled']),
    );
  });
});
