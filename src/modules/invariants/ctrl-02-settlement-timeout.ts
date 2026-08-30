import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { entityCurrent, entityRevisions, ingestEvents } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { openControlCase, references } from './control-support.js';
import { recordInvariantEvaluation } from './evaluation-store.js';

export const CTRL_02_ID = 'CTRL-02';
export const CTRL_02_VERSION = 'v1';

export interface Ctrl02Input {
  readonly subjectId: string;
  readonly subjectKey: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly expectedAmountMinor: bigint;
  readonly recipientAccountId: string;
  readonly transferProcessedTime: Date;
  readonly slaSeconds: number;
  readonly now: Date;
}

export async function evaluateCtrl02SettlementTimeout(
  db: Database,
  ctx: TenantContext,
  input: Ctrl02Input,
) {
  // Transfer evidence must reflect the LATEST authoritative projected state,
  // not merely "a TransferProcessed event was ever ingested" — a later
  // `SyntheticTransferFailed` supersedes it in `entity_current` (see CTRL-01
  // for the same reasoning) and must stop the settlement-SLA clock from
  // treating a since-reversed transfer as still awaiting a bank credit.
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
        eq(entityRevisions.businessState, 'processed'),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );
  const bankCreditRows = await db
    .select()
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, input.subjectKey),
        inArray(ingestEvents.eventType, ['BankCreditObserved']),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );
  const transfers = transferRows.filter((row) => {
    const refs = references(row.entityReferences);
    return (
      row.amountMinor === input.expectedAmountMinor &&
      row.currency === 'INR' &&
      refs.recipient_account_id === input.recipientAccountId
    );
  });
  const bankCredits = bankCreditRows.filter((row) => {
    const refs = references(row.entityReferences);
    return (
      row.amountMinor === input.expectedAmountMinor &&
      row.currency === 'INR' &&
      refs.recipient_account_id === input.recipientAccountId
    );
  });
  const expired =
    input.now.getTime() - input.transferProcessedTime.getTime() >= input.slaSeconds * 1000;
  const violated = expired && transfers.length > 0 && bankCredits.length === 0;
  const window = input.transferProcessedTime.toISOString();
  const evidenceIds = [...transfers, ...bankCredits].map((row) => row.id).sort();
  await recordInvariantEvaluation(db, ctx, {
    controlId: CTRL_02_ID,
    controlVersion: CTRL_02_VERSION,
    subjectId: input.subjectId,
    evaluationWindow: window,
    inputHash: contentHash({
      subjectId: input.subjectId,
      expectationVersion: input.expectationVersion,
      expectedAmountMinor: input.expectedAmountMinor.toString(),
      recipientAccountId: input.recipientAccountId,
      transferProcessedTime: input.transferProcessedTime.toISOString(),
      slaSeconds: input.slaSeconds,
      evaluatedAt: input.now.toISOString(),
      evidenceIds,
    }),
    result: violated ? 'violated' : 'clean',
    amountMinor: violated ? input.expectedAmountMinor : null,
    evidenceIds,
    evaluatedAt: input.now,
  });
  if (!violated) return { violated, caseId: null, caseCreated: false };
  const opened = await openControlCase(db, ctx, {
    controlId: CTRL_02_ID,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow: window,
    exposureAmountMinor: input.expectedAmountMinor,
    ageSeconds: Math.max(0, (input.now.getTime() - input.transferProcessedTime.getTime()) / 1000),
  });
  return { violated, caseId: opened.caseId, caseCreated: opened.created };
}
