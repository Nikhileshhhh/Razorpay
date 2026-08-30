import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { ingestEvents } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { openControlCase, rawData, references } from './control-support.js';
import { recordInvariantEvaluation } from './evaluation-store.js';

export const CTRL_05_ID = 'CTRL-05';
export const CTRL_05_VERSION = 'v1';

export interface Ctrl05Input {
  readonly subjectId: string;
  readonly subjectKey: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly expectedAmountMinor: bigint;
  readonly evaluatedAt: Date;
}

export async function evaluateCtrl05ConflictingBankEvidence(
  db: Database,
  ctx: TenantContext,
  input: Ctrl05Input,
) {
  const rows = await db
    .select()
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, input.subjectKey),
        eq(ingestEvents.eventType, 'BankCreditObserved'),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );
  const facts = rows
    .map((row) => ({
      id: row.id,
      utr: String(rawData(row.rawPayload).utr ?? ''),
      amount: row.amountMinor?.toString() ?? '',
      recipient: String(references(row.entityReferences).recipient_account_id ?? ''),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const byUtr = new Map<string, Set<string>>();
  for (const fact of facts) {
    const signatures = byUtr.get(fact.utr) ?? new Set<string>();
    signatures.add(`${fact.amount}|${fact.recipient}`);
    byUtr.set(fact.utr, signatures);
  }
  const sameUtrContradiction = [...byUtr.values()].some((signatures) => signatures.size > 1);
  const expectedLines = facts.filter(
    (fact) => fact.amount === input.expectedAmountMinor.toString(),
  );
  const multipleUtrs = new Set(expectedLines.map((fact) => fact.utr).filter(Boolean)).size > 1;
  const violated = sameUtrContradiction || multipleUtrs;
  const window = input.evaluatedAt.toISOString().slice(0, 10);
  const evidenceIds = facts.map((fact) => fact.id).sort();
  await recordInvariantEvaluation(db, ctx, {
    controlId: CTRL_05_ID,
    controlVersion: CTRL_05_VERSION,
    subjectId: input.subjectId,
    evaluationWindow: window,
    inputHash: contentHash({ expectedAmountMinor: input.expectedAmountMinor.toString(), facts }),
    result: violated ? 'violated' : 'clean',
    amountMinor: violated ? input.expectedAmountMinor : null,
    evidenceIds,
    evaluatedAt: input.evaluatedAt,
  });
  if (!violated) return { violated, caseId: null, caseCreated: false };
  const result = await openControlCase(db, ctx, {
    controlId: CTRL_05_ID,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow: window,
    exposureAmountMinor: input.expectedAmountMinor,
  });
  return { violated, caseId: result.caseId, caseCreated: result.created };
}
