import { z } from 'zod';
import type PgBoss from 'pg-boss';
import type { Database } from '../config/db.js';
import { createTenantContext } from '../modules/identity/tenant-context.js';
import { projectIngestEvent } from '../modules/projection/projector.js';
import {
  evaluateAffectedControls,
  evaluateConflictControl,
} from '../modules/invariants/control-orchestrator.js';
import { B2_JOB_TOPICS } from './outbox-dispatcher.js';

const JobPayload = z
  .object({
    tenant_id: z.string().min(1).max(128),
    ingest_event_id: z.string().min(1).max(128),
    conflict_id: z.string().min(1).max(128).optional(),
    evaluated_at: z.string().datetime({ offset: true }).optional(),
    replay: z.boolean().optional(),
  })
  .passthrough();

export async function registerB2JobHandlers(boss: PgBoss, db: Database): Promise<void> {
  for (const topic of B2_JOB_TOPICS) await boss.createQueue(topic);

  await boss.work('project-evidence.v1', async ([job]) => {
    if (!job) throw new Error('project job batch was empty');
    const payload = JobPayload.parse(job.data);
    const ctx = createTenantContext(payload.tenant_id, 'demo');
    await projectIngestEvent(db, ctx, payload.ingest_event_id, { replay: payload.replay });
  });

  await boss.work('evaluate-controls.v1', async ([job]) => {
    if (!job) throw new Error('control job batch was empty');
    const payload = JobPayload.parse(job.data);
    const ctx = createTenantContext(payload.tenant_id, 'demo');
    if (payload.conflict_id) {
      await evaluateConflictControl(
        db,
        ctx,
        payload.ingest_event_id,
        payload.evaluated_at ? new Date(payload.evaluated_at) : new Date(),
      );
      return;
    }
    const result = await evaluateAffectedControls(
      db,
      ctx,
      payload.ingest_event_id,
      payload.evaluated_at ? new Date(payload.evaluated_at) : undefined,
    );
    if (result.nextCheckAt && result.nextCheckAt.getTime() > Date.now()) {
      const evaluatedAt = result.nextCheckAt.toISOString();
      await boss.sendAfter(
        'evaluate-controls.v1',
        { ...payload, evaluated_at: evaluatedAt },
        { singletonKey: `${payload.ingest_event_id}:due:${evaluatedAt}`, retryLimit: 5 },
        result.nextCheckAt,
      );
    }
  });
}
