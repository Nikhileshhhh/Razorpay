import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { entityCurrent, entityRevisions, ingestEvents } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { openControlCase, references } from './control-support.js';
import { recordInvariantEvaluation } from './evaluation-store.js';

export const CTRL_03_ID = 'CTRL-03';
export const CTRL_03_VERSION = 'v1';

export interface Ctrl03Input {
  readonly subjectId: string;
  readonly subjectKey: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly expectedAmountMinor: bigint;
  readonly receivableId: string;
  readonly settlementVerifiedTime: Date;
  readonly graceSeconds: number;
  readonly now: Date;
}

export async function evaluateCtrl03OpenReceivable(
  db: Database,
  ctx: TenantContext,
  input: Ctrl03Input,
) {
  const rows = await db
    .select()
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, input.subjectKey),
        inArray(ingestEvents.eventType, [
          'BankCreditObserved',
          'SellerReceivableOpened',
          'SellerReceivableClosed',
        ]),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );
  const bank = rows.filter(
    (row) =>
      row.eventType === 'BankCreditObserved' &&
      row.amountMinor === input.expectedAmountMinor &&
      row.currency === 'INR',
  );
  const receivable = (type: string) =>
    rows.filter(
      (row) =>
        row.eventType === type &&
        references(row.entityReferences).receivable_id === input.receivableId,
    );
  const opened = receivable('SellerReceivableOpened');
  const closed = receivable('SellerReceivableClosed');
  const expired =
    input.now.getTime() - input.settlementVerifiedTime.getTime() >= input.graceSeconds * 1000;
  // Whether the receivable is CURRENTLY open must come from `entity_current`
  // (the latest authoritative projected state), not "no close event has ever
  // been seen" — a stale `closed.length === 0` check would permanently block
  // this control from re-violating after a later authoritative
  // `SellerReceivableOpened` reopens a receivable that was previously closed.
  const [currentReceivable] = await db
    .select({ businessState: entityRevisions.businessState })
    .from(entityCurrent)
    .innerJoin(
      entityRevisions,
      and(
        eq(entityRevisions.tenantId, entityCurrent.tenantId),
        eq(entityRevisions.id, entityCurrent.currentRevisionId),
      ),
    )
    .where(
      and(
        eq(entityCurrent.tenantId, ctx.tenantId),
        eq(entityCurrent.entityKey, `receivable:${input.receivableId}`),
      ),
    )
    .limit(1);
  const receivableCurrentlyOpen = currentReceivable?.businessState === 'open';
  const violated = expired && bank.length > 0 && opened.length > 0 && receivableCurrentlyOpen;
  const window = input.settlementVerifiedTime.toISOString();
  const evidenceIds = [...bank, ...opened, ...closed].map((row) => row.id).sort();
  await recordInvariantEvaluation(db, ctx, {
    controlId: CTRL_03_ID,
    controlVersion: CTRL_03_VERSION,
    subjectId: input.subjectId,
    evaluationWindow: window,
    inputHash: contentHash({
      subjectId: input.subjectId,
      expectationVersion: input.expectationVersion,
      expectedAmountMinor: input.expectedAmountMinor.toString(),
      receivableId: input.receivableId,
      settlementVerifiedTime: input.settlementVerifiedTime.toISOString(),
      graceSeconds: input.graceSeconds,
      evaluatedAt: input.now.toISOString(),
      evidenceIds,
    }),
    result: violated ? 'violated' : 'clean',
    amountMinor: violated ? input.expectedAmountMinor : null,
    evidenceIds,
    evaluatedAt: input.now,
  });
  if (!violated) return { violated, caseId: null, caseCreated: false };
  const result = await openControlCase(db, ctx, {
    controlId: CTRL_03_ID,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow: window,
    exposureAmountMinor: input.expectedAmountMinor,
  });
  return { violated, caseId: result.caseId, caseCreated: result.created };
}
