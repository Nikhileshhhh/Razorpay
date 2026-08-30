import { z } from 'zod';
import type PgBoss from 'pg-boss';
import type { Database } from '../config/db.js';
import type { Env } from '../config/env.js';
import { createTenantContext } from '../modules/identity/tenant-context.js';
import { runInvestigation } from '../modules/investigation/investigation-service.js';
import { dispatchAction } from '../modules/actions/action-dispatch.js';

export const B3_JOB_TOPICS = ['run-investigation.v1', 'dispatch-action.v1'] as const;

const InvestigationJobPayload = z
  .object({
    tenant_id: z.string().min(1).max(128),
    case_id: z.string().min(1).max(128),
    expected_case_version: z.number().int().min(0).nullable(),
    actor_id: z.string().min(1).max(128),
    actor_role: z.string().min(1).max(64),
  })
  .passthrough();

const ActionJobPayload = z
  .object({ tenant_id: z.string().min(1).max(128), action_id: z.string().min(1).max(128) })
  .passthrough();

/**
 * Gate B3 durable job handlers (backend PRD §15). `run-investigation.v1` runs
 * the bounded investigation gateway call + validation off the API request
 * path; `dispatch-action.v1` is the ONLY topic with adapter capability (only
 * the worker owns it — backend PRD §12.4/§18) and MUST NOT run during replay
 * (enforced by `assertReplayTopicAllowed` in `outbox-dispatcher.ts`, upstream
 * of this handler).
 */
export async function registerB3JobHandlers(
  boss: PgBoss,
  db: Database,
  env: Pick<Env, 'MODEL_PROVIDER'> & { MODEL_API_URL?: string; MODEL_API_KEY?: string },
): Promise<void> {
  for (const topic of B3_JOB_TOPICS) await boss.createQueue(topic);

  await boss.work('run-investigation.v1', async ([job]) => {
    if (!job) throw new Error('investigation job batch was empty');
    const payload = InvestigationJobPayload.parse(job.data);
    const ctx = createTenantContext(payload.tenant_id, 'demo');
    await runInvestigation(db, ctx, env, {
      caseId: payload.case_id,
      expectedCaseVersion: payload.expected_case_version ?? undefined,
      actorId: payload.actor_id,
      actorRole: payload.actor_role,
    });
  });

  await boss.work('dispatch-action.v1', async ([job]) => {
    if (!job) throw new Error('action job batch was empty');
    const payload = ActionJobPayload.parse(job.data);
    const ctx = createTenantContext(payload.tenant_id, 'demo');
    await dispatchAction(db, ctx, payload.action_id);
  });
}
