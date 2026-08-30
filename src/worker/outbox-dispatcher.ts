import type PgBoss from 'pg-boss';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../config/db.js';
import { outbox } from '../config/db-schema.js';

export const B2_JOB_TOPICS = ['project-evidence.v1', 'evaluate-controls.v1'] as const;
const ACTION_TOPIC = 'dispatch-action.v1';

export class ReplayTopicForbiddenError extends Error {
  constructor() {
    super('replay cannot publish an action-capable topic');
    this.name = 'ReplayTopicForbiddenError';
  }
}

export function assertReplayTopicAllowed(topic: string, replay: boolean): void {
  if (replay && topic === ACTION_TOPIC) throw new ReplayTopicForbiddenError();
}

interface ClaimedOutboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly topic: string;
  readonly payload: Record<string, unknown>;
}

/** Claim with SKIP LOCKED so multiple workers never dispatch the same row concurrently. */
export async function dispatchPendingOutbox(
  db: Database,
  boss: PgBoss,
  limit = 50,
): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const result = await tx.execute<ClaimedOutboxRow>(sql`
      with picked as (
        select id from outbox
        where status in ('pending', 'failed')
           or (status = 'claimed' and claimed_at < now() - interval '60 seconds')
        order by created_at, id
        for update skip locked
        limit ${limit}
      )
      update outbox o
      set status = 'claimed', claimed_at = now(), claim_attempts = claim_attempts + 1,
          last_error_code = null
      from picked
      where o.id = picked.id
      returning o.id, o.tenant_id, o.topic, o.payload
    `);
    return result.rows;
  });

  for (const row of claimed) {
    try {
      const replay = row.payload.replay === true;
      assertReplayTopicAllowed(row.topic, replay);
      await boss.createQueue(row.topic);
      await boss.send(row.topic, row.payload, {
        singletonKey: row.id,
        retryLimit: 5,
        retryDelay: 1,
        retryBackoff: true,
      });
      await db
        .update(outbox)
        .set({ status: 'dispatched', dispatchedAt: new Date(), lastErrorCode: null })
        .where(
          and(
            eq(outbox.id, row.id),
            eq(outbox.tenantId, row.tenant_id),
            eq(outbox.status, 'claimed'),
          ),
        );
    } catch {
      await db
        .update(outbox)
        .set({ status: 'failed', claimedAt: null, lastErrorCode: 'dispatch_failed' })
        .where(and(eq(outbox.id, row.id), eq(outbox.tenantId, row.tenant_id)));
    }
  }
  return claimed.length;
}
