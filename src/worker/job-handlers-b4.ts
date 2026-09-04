import { z } from 'zod';
import type PgBoss from 'pg-boss';
import type { Database } from '../config/db.js';
import { demoScenarioState, workerHeartbeat } from '../config/db-schema.js';
import { and, eq } from 'drizzle-orm';
import { resolveTenantContext } from '../modules/identity/identity-repository.js';
import { evaluateActionVerification } from '../modules/verification/verification-service.js';
import { reconcileExpectation } from '../modules/reconciliation/reconciliation-service.js';
import { evaluateAgentClaim } from '../modules/claims/claim-service.js';
import type { Env } from '../config/env.js';
import type { TenantContext } from '../modules/identity/tenant-context.js';
import { runDemoScenarioStep } from '../modules/demo/scenario-runner.js';
import { generateDemoDataset } from '../modules/demo/dataset.js';
import { completeDuplicateRecoveryPrevention } from './complete-duplicate-recovery.js';

export const B4_JOB_TOPICS = [
  'check-verification.v1',
  'reconcile-expectation.v1',
  'reevaluate-claim.v1',
  'advance-demo-scenario.v1',
  'complete-duplicate-recovery-prevention.v1',
  'process-import.v1',
] as const;

const TenantPayload = z.object({ tenant_id: z.string().min(1).max(128) }).passthrough();
const VerificationPayload = TenantPayload.extend({ action_id: z.string().min(1).max(128) });
const ReconciliationPayload = TenantPayload.extend({ expectation_id: z.string().min(1).max(128) });
const ClaimPayload = TenantPayload.extend({ claim_id: z.string().min(1).max(128) });
const ScenarioPayload = TenantPayload.extend({
  scenario_id: z.string().min(1).max(128),
  step: z.number().int().positive(),
});
const DuplicateRecoveryPayload = TenantPayload.extend({ action_id: z.string().min(1).max(128) });
const ImportPayload = TenantPayload.extend({ seed_id: z.string().min(1).max(128) });

export const DEMO_STEP_FAILED_CODE = 'DEMO_STEP_FAILED' as const;

export async function recordDemoScenarioFailure(
  db: Database,
  ctx: TenantContext,
  scenarioId: string,
  _error: unknown,
): Promise<void> {
  await db
    .update(demoScenarioState)
    .set({ lastError: DEMO_STEP_FAILED_CODE })
    .where(
      and(
        eq(demoScenarioState.tenantId, ctx.tenantId),
        eq(demoScenarioState.scenarioId, scenarioId),
      ),
    );
}

export async function registerB4JobHandlers(
  boss: PgBoss,
  db: Database,
  env: Pick<
    Env,
    | 'MONEYTRACE_ENV'
    | 'SYNTHETIC_SOURCE_HMAC_SECRET'
    | 'MODEL_PROVIDER'
    | 'MODEL_API_URL'
    | 'MODEL_API_KEY'
  >,
): Promise<void> {
  for (const topic of B4_JOB_TOPICS) await boss.createQueue(topic);
  await boss.work('check-verification.v1', async ([job]) => {
    if (!job) throw new Error('verification job batch was empty');
    const payload = VerificationPayload.parse(job.data);
    await evaluateActionVerification(
      db,
      await resolveTenantContext(db, payload.tenant_id),
      payload.action_id,
    );
  });
  await boss.work('reconcile-expectation.v1', async ([job]) => {
    if (!job) throw new Error('reconciliation job batch was empty');
    const payload = ReconciliationPayload.parse(job.data);
    await reconcileExpectation(
      db,
      await resolveTenantContext(db, payload.tenant_id),
      payload.expectation_id,
    );
  });
  await boss.work('reevaluate-claim.v1', async ([job]) => {
    if (!job) throw new Error('claim job batch was empty');
    const payload = ClaimPayload.parse(job.data);
    await evaluateAgentClaim(
      db,
      await resolveTenantContext(db, payload.tenant_id),
      payload.claim_id,
    );
  });
  await boss.work('advance-demo-scenario.v1', async ([job]) => {
    if (!job) throw new Error('scenario job batch was empty');
    const payload = ScenarioPayload.parse(job.data);
    const ctx = await resolveTenantContext(db, payload.tenant_id);
    const rows = await db
      .select({ currentStep: demoScenarioState.currentStep })
      .from(demoScenarioState)
      .where(
        and(
          eq(demoScenarioState.tenantId, payload.tenant_id),
          eq(demoScenarioState.scenarioId, payload.scenario_id),
        ),
      )
      .limit(1);
    if (!rows[0] || rows[0].currentStep < payload.step) {
      throw new Error('scenario command is not durably persisted');
    }
    try {
      await runDemoScenarioStep(db, ctx, env, payload.scenario_id, payload.step);
      await db
        .update(demoScenarioState)
        .set({ completedStep: payload.step, lastError: null })
        .where(
          and(
            eq(demoScenarioState.tenantId, payload.tenant_id),
            eq(demoScenarioState.scenarioId, payload.scenario_id),
          ),
        );
    } catch (error) {
      await recordDemoScenarioFailure(db, ctx, payload.scenario_id, error);
      throw error;
    }
  });
  await boss.work('complete-duplicate-recovery-prevention.v1', async ([job]) => {
    if (!job) throw new Error('duplicate-recovery-prevention job batch was empty');
    const payload = DuplicateRecoveryPayload.parse(job.data);
    await completeDuplicateRecoveryPrevention(
      db,
      await resolveTenantContext(db, payload.tenant_id),
      payload.action_id,
    );
  });
  // WORKER-ONLY: the API process durably enqueues this job
  // (`enqueueDatasetImport`) and never calls `generateDemoDataset` itself
  // (backend PRD §14.1 "async/durable import id"). Safely re-runnable on
  // redelivery — every insert inside `generateDemoDataset` is conflict-safe.
  await boss.work('process-import.v1', async ([job]) => {
    if (!job) throw new Error('import job batch was empty');
    const payload = ImportPayload.parse(job.data);
    await generateDemoDataset(
      db,
      env,
      await resolveTenantContext(db, payload.tenant_id),
      payload.seed_id,
    );
  });
}

export async function writeWorkerHeartbeat(db: Database, now = new Date()): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ id: 'moneytrace-worker', lastBeatAt: now, status: 'up' })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { lastBeatAt: now, status: 'up' },
    });
}
