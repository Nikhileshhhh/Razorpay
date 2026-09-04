import { z } from 'zod';
import type PgBoss from 'pg-boss';
import type { Database } from '../config/db.js';
import { resolveTenantContext } from '../modules/identity/identity-repository.js';
import { projectIngestEvent } from '../modules/projection/projector.js';
import {
  evaluateAffectedControls,
  evaluateConflictControl,
} from '../modules/invariants/control-orchestrator.js';
import { B2_JOB_TOPICS } from './outbox-dispatcher.js';
import { and, eq } from 'drizzle-orm';
import {
  agentResultClaims,
  economicSubjects,
  expectations,
  ingestEvents,
} from '../config/db-schema.js';
import {
  observeReceivableClosure,
  ReceivableClosureInvalidError,
} from '../modules/reconciliation/closure-service.js';
import {
  reverseReconciliation,
  ReconciliationReversalInvalidError,
} from '../modules/reconciliation/reversal-service.js';
import {
  reconcileExpectation,
  ReconciliationNotFoundError,
} from '../modules/reconciliation/reconciliation-service.js';
import { evaluateAgentClaim } from '../modules/claims/claim-service.js';

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
    const ctx = await resolveTenantContext(db, payload.tenant_id);
    await projectIngestEvent(db, ctx, payload.ingest_event_id, { replay: payload.replay });
  });

  await boss.work('evaluate-controls.v1', async ([job]) => {
    if (!job) throw new Error('control job batch was empty');
    const payload = JobPayload.parse(job.data);
    const ctx = await resolveTenantContext(db, payload.tenant_id);
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
    const eventRows = await db
      .select()
      .from(ingestEvents)
      .where(
        and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, payload.ingest_event_id)),
      )
      .limit(1);
    const event = eventRows[0];
    if (event?.eventType === 'SellerReceivableClosed') {
      try {
        await observeReceivableClosure(db, ctx, event.id);
      } catch (error) {
        // An unrelated/typed-but-invalid `SellerReceivableClosed` (wrong
        // action/expectation/tenant, missing causation, already-reversed
        // allocation, etc.) is safely ignored — never a retryable job
        // failure that would poison this worker on every redelivery.
        if (!(error instanceof ReceivableClosureInvalidError)) throw error;
      }
    }
    if (event && ['RefundCreated', 'RefundProcessed'].includes(event.eventType ?? '')) {
      try {
        await reverseReconciliation(db, ctx, event.id);
      } catch (error) {
        if (!(error instanceof ReconciliationReversalInvalidError)) throw error;
      }
      if (event.economicSubjectHint) {
        const claims = await db
          .select({ id: agentResultClaims.id })
          .from(agentResultClaims)
          .where(
            and(
              eq(agentResultClaims.tenantId, ctx.tenantId),
              eq(agentResultClaims.economicSubjectKey, event.economicSubjectHint),
            ),
          );
        for (const claim of claims) await evaluateAgentClaim(db, ctx, claim.id);
      }
    }
    if (
      event?.economicSubjectHint &&
      ['SettlementObserved', 'BankCreditObserved'].includes(event.eventType ?? '')
    ) {
      const expectationRows = await db
        .select({ id: expectations.id })
        .from(economicSubjects)
        .innerJoin(
          expectations,
          and(
            eq(expectations.tenantId, economicSubjects.tenantId),
            eq(expectations.subjectId, economicSubjects.id),
          ),
        )
        .where(
          and(
            eq(economicSubjects.tenantId, ctx.tenantId),
            eq(economicSubjects.subjectKey, event.economicSubjectHint),
            eq(expectations.isCurrent, true),
          ),
        );
      for (const expectation of expectationRows) {
        try {
          await reconcileExpectation(db, ctx, expectation.id);
        } catch (error) {
          if (!(error instanceof ReconciliationNotFoundError)) throw error;
        }
      }
    }
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
