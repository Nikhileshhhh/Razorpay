import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { entityCurrent, entityRevisions, ingestEvents } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { contentHash } from '../../config/hashing.js';
import { openOrGetCase } from '../cases/case-service.js';
import { money } from '../../domain/money/money.js';
import type { PriorityInputs } from '../cases/priority.js';
import { recordInvariantEvaluation } from './evaluation-store.js';

export const CTRL_01_ID = 'CTRL-01';
export const CTRL_01_VERSION = 'v1';

export interface Ctrl01Input {
  readonly subjectId: string;
  readonly subjectKey: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly sellerAllocationMinor: bigint;
  readonly captureEventTime: Date;
  readonly graceSeconds: number;
  /** Injected/fixed clock (backend PRD §10.1: "use an injected/fixed clock"). */
  readonly now: Date;
  readonly recipientId?: string;
}

export interface Ctrl01Result {
  readonly violated: boolean;
  readonly caseId: string | null;
  readonly caseCreated: boolean;
}

/**
 * CTRL-01: captured payment with missing expected transfer (PRD §9.4,
 * backend PRD §10.1). Deterministic, fixed-clock, idempotent: re-running the
 * SAME evaluation window never creates a second `invariant_evaluations` row or
 * a second case (CTRL-06 duplicate safety) — it returns the prior result.
 */
export async function evaluateCtrl01MissingTransfer(
  db: Database,
  ctx: TenantContext,
  input: Ctrl01Input,
): Promise<Ctrl01Result> {
  const evaluationWindow = input.captureEventTime.toISOString();

  const graceExpired =
    input.now.getTime() - input.captureEventTime.getTime() >= input.graceSeconds * 1000;

  // Evidence must reflect the LATEST authoritative projected state for the
  // transfer entity, not merely "a TransferCreated/TransferProcessed event was
  // ever ingested" — a `SyntheticTransferFailed` arriving after
  // `TransferProcessed` becomes `entity_current` (entity-mapping precedence:
  // transfer.failed > transfer.processed) and must invalidate this evidence so
  // the control re-violates. Joining through `entity_current` rather than
  // scanning the raw `ingest_events` journal directly enforces this.
  const transferRows = await db
    .select({
      id: ingestEvents.id,
      amountMinor: entityRevisions.amountMinor,
      currency: entityRevisions.currency,
      entityReferences: ingestEvents.entityReferences,
    })
    .from(entityCurrent)
    .innerJoin(
      entityRevisions,
      and(
        eq(entityRevisions.tenantId, entityCurrent.tenantId),
        eq(entityRevisions.id, entityCurrent.currentRevisionId),
      ),
    )
    .innerJoin(
      ingestEvents,
      and(
        eq(ingestEvents.tenantId, entityRevisions.tenantId),
        eq(ingestEvents.id, entityRevisions.ingestEventId),
      ),
    )
    .where(
      and(
        eq(entityCurrent.tenantId, ctx.tenantId),
        eq(entityCurrent.entityType, 'transfer'),
        eq(ingestEvents.economicSubjectHint, input.subjectKey),
        ne(entityRevisions.businessState, 'failed'),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );

  const transferEvidence = transferRows.filter((row) => {
    const refs = row.entityReferences as Record<string, unknown>;
    return (
      row.amountMinor === input.sellerAllocationMinor &&
      row.currency === 'INR' &&
      (!input.recipientId || refs.recipient_id === input.recipientId)
    );
  });
  const violated = graceExpired && transferEvidence.length === 0;
  const inputHash = contentHash({
    subjectId: input.subjectId,
    expectationVersion: input.expectationVersion,
    evaluationWindow,
    graceSeconds: input.graceSeconds,
    checkedAt: input.now.toISOString(),
    qualifyingEvidenceIds: transferEvidence.map((row) => row.id).sort(),
  });
  await recordInvariantEvaluation(db, ctx, {
    controlId: CTRL_01_ID,
    controlVersion: CTRL_01_VERSION,
    subjectId: input.subjectId,
    evaluationWindow,
    inputHash,
    result: violated ? 'violated' : 'clean',
    amountMinor: violated ? input.sellerAllocationMinor : null,
    evidenceIds: transferEvidence.map((row) => row.id),
    evaluatedAt: input.now,
  });

  if (!violated) {
    return { violated: false, caseId: null, caseCreated: false };
  }

  const result = await openOrGetCase(db, ctx, {
    controlId: CTRL_01_ID,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow,
    exposure: money(input.sellerAllocationMinor),
    priority: defaultPriority(input),
  });

  return { violated: true, caseId: result.caseId, caseCreated: result.created };
}

function defaultPriority(input: Ctrl01Input): PriorityInputs {
  return {
    exposure: money(input.sellerAllocationMinor),
    evidenceCoverage: 'complete',
    customerHarmRisk: 'medium',
    ageSeconds: Math.max(0, (input.now.getTime() - input.captureEventTime.getTime()) / 1000),
  };
}
