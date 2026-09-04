import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type PgBoss from 'pg-boss';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../src/config/db-schema.js';
import { getDb, closeDb } from '../../src/config/db.js';
import { EnvSchema, type Env } from '../../src/config/env.js';
import { buildServer } from '../../src/api/server.js';
import { startWorker } from '../../src/worker/worker.js';
import { seedIdentity } from '../../src/modules/demo/seed-identity.js';
import { seedSourceConnections } from '../../src/modules/demo/seed-sources.js';
import { seedPolicyBundle } from '../../src/modules/policy/policy-bundle.js';
import { seedVerificationContracts } from '../../src/modules/verification/verification-contracts-seed.js';
import { createMigratedTestDatabase, type TestDatabase } from '../integration/helpers/test-db.js';

/**
 * Backend PRD §19.4: automate the four scenarios against a real test
 * PostgreSQL database and a running API/worker — through the REAL Fastify
 * HTTP boundary, the REAL transactional outbox, and the REAL pg-boss worker
 * (not the scenario runner called directly, which `tests/integration/db/
 * b4-scenarios.test.ts` already covers). Job completion is awaited by
 * polling actual persisted state with a bounded timeout, never an arbitrary
 * fixed sleep.
 */

const DEMO_OPERATOR = 'user_operator';

function pollUntil<T>(
  check: () => Promise<T | undefined | null | false>,
  description: string,
  timeoutMs = 20_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const result = await check();
        if (result) {
          resolve(result);
          return;
        }
      } catch {
        // keep polling — the condition may not be persisted yet
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for: ${description}`));
        return;
      }
      setTimeout(() => void attempt(), intervalMs);
    };
    void attempt();
  });
}

describe('Backend E2E: real HTTP API + outbox + worker', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let boss: PgBoss;
  let env: Env;
  let db: ReturnType<typeof getDb>;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    env = EnvSchema.parse({
      MONEYTRACE_ENV: 'demo',
      NODE_ENV: 'test',
      DATABASE_URL: testDb.databaseUrl,
      MODEL_PROVIDER: 'stub',
    });
    db = getDb(env.DATABASE_URL!);
    // Real operational sequence: `db:migrate` + `db:seed` run before the API
    // ever accepts a request (identity cannot come from the reset it is used
    // to authorize). `resetDemoDatabase` itself re-seeds identity anyway, so
    // this is only the pre-reset bootstrap, not a substitute for the test.
    await seedIdentity(db);
    await seedSourceConnections(db);
    await seedPolicyBundle(db);
    await seedVerificationContracts(db);
    app = buildServer(env);
    await app.ready();
    boss = await startWorker(env);
  }, 60_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false, timeout: 1_000 }).catch(() => {});
    await app?.close();
    await closeDb();
    await testDb?.teardown();
  }, 30_000);

  async function inject(
    method: 'GET' | 'POST',
    url: string,
    opts: { user?: string; payload?: Record<string, unknown> } = {},
  ) {
    return await app.inject({
      method,
      url,
      headers: opts.user ? { 'x-demo-user-id': opts.user } : undefined,
      payload: opts.payload,
    });
  }

  async function advanceAndDrain(scenarioId: string, expectedStep: number): Promise<void> {
    const response = await inject('POST', `/v1/demo/scenarios/${scenarioId}/advance`, {
      user: DEMO_OPERATOR,
      payload: { schema_version: '1.0', expected_step: expectedStep },
    });
    expect(response.statusCode, `advance ${scenarioId} step ${expectedStep + 1}`).toBe(200);
    const targetStep = expectedStep + 1;
    const completed = await pollUntil(async () => {
      const rows = await db
        .select({
          currentStep: schema.demoScenarioState.currentStep,
          completedStep: schema.demoScenarioState.completedStep,
          lastError: schema.demoScenarioState.lastError,
        })
        .from(schema.demoScenarioState)
        .where(
          and(
            eq(schema.demoScenarioState.tenantId, 'ten_demo'),
            eq(schema.demoScenarioState.scenarioId, scenarioId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row && (row.completedStep >= targetStep || row.lastError !== null) ? row : false;
    }, `${scenarioId} scenario state to complete step ${targetStep}`);
    expect(completed.currentStep).toBe(targetStep);
    expect(completed.completedStep).toBe(targetStep);
    expect(completed.lastError).toBeNull();
    // The state/outbox row commits synchronously with the HTTP response, but
    // the domain EFFECT (`runDemoScenarioStep`) runs asynchronously — the
    // outbox row flips to `dispatched` as soon as it is handed to pg-boss,
    // well BEFORE the worker actually picks up and executes the job, so that
    // alone is not a completion signal. Poll pg-boss's own job table
    // directly for THIS specific step's job leaving the outstanding
    // (created/retry/active) states — a real completion signal (the worker
    // has genuinely finished it, success or failure), not a fixed sleep.
    await pollUntil(async () => {
      // Requires the job to have actually been SEEN (`total > 0`) before
      // treating zero outstanding as "finished" — otherwise a check that
      // runs before pg-boss has even inserted the job (the outbox
      // dispatcher polls every 500ms, not synchronously with the HTTP
      // response) would false-positive as already complete.
      const rows = await db.execute<{ outstanding: string; total: string }>(sql`
        select
          count(*) filter (where state in ('created', 'retry', 'active'))::text as outstanding,
          count(*)::text as total
        from pgboss.job
        where name = 'advance-demo-scenario.v1'
          and (data->>'scenario_id') = ${scenarioId}
          and (data->>'step')::int = ${targetStep}
      `);
      const row = rows.rows[0];
      return row && row.total !== '0' && row.outstanding === '0' ? true : false;
    }, `${scenarioId} step ${targetStep} worker job to finish`);
  }

  // Reset alone drives the real 500-record dataset (~2 minutes); the four
  // scenarios' worker-processed steps add real but bounded time on top.
  const FULL_LIFECYCLE_TEST_TIMEOUT_MS = 280_000;

  it(
    'runs the full backend gate over real HTTP + worker: reset, all four scenarios, and demo status/overview',
    async () => {
      // --- Genuine asynchronous import over real HTTP + worker ------------
      const importResponse = await inject('POST', '/v1/imports', {
        user: DEMO_OPERATOR,
        payload: { schema_version: '1.0', seed_id: 'moneytrace_demo_v1', confirm: true },
      });
      expect(importResponse.statusCode).toBe(202);
      expect(importResponse.json().resource_version).toBe(0);
      expect(importResponse.json().data.status).toBe('pending');
      await pollUntil(
        async () => {
          const rows = await db
            .select({ id: schema.dataImports.id })
            .from(schema.dataImports)
            .where(eq(schema.dataImports.id, 'import_moneytrace_demo_v1_completed'));
          return rows[0] ?? false;
        },
        '500-record import to persist its accepted completion',
        180_000,
        250,
      );
      const replayImport = await inject('POST', '/v1/imports', {
        user: DEMO_OPERATOR,
        payload: { schema_version: '1.0', seed_id: 'moneytrace_demo_v1', confirm: true },
      });
      expect(replayImport.statusCode).toBe(200);
      expect(replayImport.json().resource_version).toBe(1);
      expect(replayImport.json().data).toMatchObject({ status: 'accepted', accepted_count: 500 });
      const ledger = await db
        .select({ id: schema.demoDatasetRecords.id })
        .from(schema.demoDatasetRecords);
      expect(ledger).toHaveLength(500);

      // --- Scenario 1: missing-transfer-remediation (6 steps) --------------
      for (let step = 0; step < 6; step += 1) {
        await advanceAndDrain('missing-transfer-remediation', step);
      }
      const remediationSubject = await db
        .select({ id: schema.economicSubjects.id })
        .from(schema.economicSubjects)
        .where(eq(schema.economicSubjects.subjectKey, 'scenario:missing-transfer-remediation'))
        .limit(1);
      const remediationCase = await db
        .select()
        .from(schema.cases)
        .where(
          and(
            eq(schema.cases.subjectId, remediationSubject[0]!.id),
            eq(schema.cases.controlId, 'CTRL-01'),
          ),
        );
      expect(remediationCase).toHaveLength(1);
      expect(remediationCase[0]?.lifecycleState).toBe('reconciled');
      const remediationAllocations = await db
        .select()
        .from(schema.reconciliationAllocations)
        .where(eq(schema.reconciliationAllocations.caseId, remediationCase[0]!.id));
      expect(remediationAllocations).toHaveLength(1);
      expect(remediationAllocations[0]?.amountMinor).toBe(45_500_000n);
      const remediationClosures = await db
        .select()
        .from(schema.receivableClosures)
        .where(eq(schema.receivableClosures.caseId, remediationCase[0]!.id));
      expect(remediationClosures).toHaveLength(1);

      // --- Scenario 2: claim-reversal (3 steps) ----------------------------
      for (let step = 0; step < 3; step += 1) {
        await advanceAndDrain('claim-reversal', step);
      }
      const claimHeads = await db.select().from(schema.claimEvaluationHeads);
      const reversedClaim = claimHeads.find((row) => row.status === 'REVERSED');
      expect(reversedClaim).toBeDefined();

      // --- Scenario 3: conflicting-bank-evidence (3 steps) -----------------
      for (let step = 0; step < 3; step += 1) {
        await advanceAndDrain('conflicting-bank-evidence', step);
      }
      const conflictSubject = await db
        .select({ id: schema.economicSubjects.id })
        .from(schema.economicSubjects)
        .where(eq(schema.economicSubjects.subjectKey, 'scenario:conflicting-bank-evidence'))
        .limit(1);
      const conflictCase = await db
        .select()
        .from(schema.cases)
        .where(
          and(
            eq(schema.cases.subjectId, conflictSubject[0]!.id),
            eq(schema.cases.controlId, 'CTRL-05'),
          ),
        );
      expect(conflictCase).toHaveLength(1);
      expect(conflictCase[0]?.lifecycleState).toBe('abstained');

      // --- Scenario 4: duplicate-replay (4 steps) --------------------------
      for (let step = 0; step < 4; step += 1) {
        await advanceAndDrain('duplicate-replay', step);
      }
      const duplicateSubject = await db
        .select({ id: schema.economicSubjects.id })
        .from(schema.economicSubjects)
        .where(eq(schema.economicSubjects.subjectKey, 'scenario:duplicate-replay'))
        .limit(1);
      const duplicateCase = await db
        .select()
        .from(schema.cases)
        .where(
          and(
            eq(schema.cases.subjectId, duplicateSubject[0]!.id),
            eq(schema.cases.controlId, 'CTRL-01'),
          ),
        );
      expect(duplicateCase).toHaveLength(1);
      const duplicateActions = await db
        .select()
        .from(schema.actions)
        .where(eq(schema.actions.caseId, duplicateCase[0]!.id));
      expect(
        duplicateActions.filter((row) => row.toolId === 'SIMULATE_TRANSFER_REMEDIATION'),
      ).toHaveLength(1);
      expect(
        duplicateActions.filter(
          (row) => row.toolId === 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
        ),
      ).toHaveLength(1);
      const duplicateAllocations = await db
        .select()
        .from(schema.reconciliationAllocations)
        .where(eq(schema.reconciliationAllocations.caseId, duplicateCase[0]!.id));
      expect(duplicateAllocations).toHaveLength(1);
      const duplicateClosures = await db
        .select()
        .from(schema.receivableClosures)
        .where(eq(schema.receivableClosures.caseId, duplicateCase[0]!.id));
      expect(duplicateClosures).toHaveLength(1);

      // --- Demo status/overview reflect the real, now-advanced state ------
      const status = await inject('GET', '/v1/demo/status', { user: 'user_viewer' });
      expect(status.statusCode).toBe(200);
      const statusBody = status.json();
      expect(
        statusBody.data.scenarios.every(
          (scenario: { status: string; last_error: string | null }) =>
            scenario.status === 'completed' && scenario.last_error === null,
        ),
      ).toBe(true);
      // Two independent expectations now hold a current EFFECT_VERIFIED
      // SIMULATE_TRANSFER_REMEDIATION outcome — missing-transfer-remediation's
      // (45,500,000) AND duplicate-replay's own remediation (45,500,000) — so
      // the tenant-wide measured total genuinely sums both, grouped once per
      // expectation (ADR D7). `verified_restored=45,500,000` for a single
      // scenario alone is proven by `tests/integration/db/b4-manifest.test.ts`.
      expect(statusBody.data.manifest.verified_restored).toBe('91000000');
      expect(statusBody.data.manifest.reversed_recovery).toBe('12000000');
      expect(statusBody.data.manifest.records_total).toBe(500);

      const overview = await inject('GET', '/v1/overview', { user: 'user_viewer' });
      expect(overview.statusCode).toBe(200);
      expect(overview.json().data.claim_reversal_summary.reversed_recovery.amount_minor).toBe(
        '12000000',
      );

      // --- Duplicate replay produced no second accepted ingest event ------
      const replayEvents = await db
        .select()
        .from(schema.ingestEvents)
        .where(eq(schema.ingestEvents.economicSubjectHint, 'scenario:duplicate-replay'));
      expect(replayEvents).toHaveLength(7);
    },
    FULL_LIFECYCLE_TEST_TIMEOUT_MS,
  );
});
