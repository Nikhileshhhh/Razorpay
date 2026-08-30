import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { eventConflicts } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { openControlCase } from './control-support.js';
import { recordInvariantEvaluation } from './evaluation-store.js';

export const CTRL_06_ID = 'CTRL-06';
export const CTRL_06_VERSION = 'v1';

export interface Ctrl06Input {
  readonly subjectId: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly existingIngestEventId: string;
  readonly exposureAmountMinor: bigint;
  readonly evaluatedAt: Date;
}

export async function evaluateCtrl06DuplicateSafety(
  db: Database,
  ctx: TenantContext,
  input: Ctrl06Input,
) {
  const conflicts = await db
    .select({ id: eventConflicts.id })
    .from(eventConflicts)
    .where(
      and(
        eq(eventConflicts.tenantId, ctx.tenantId),
        eq(eventConflicts.existingIngestEventId, input.existingIngestEventId),
      ),
    );
  const violated = conflicts.length > 0;
  const window = input.existingIngestEventId;
  const evidenceIds = conflicts.map((row) => row.id).sort();
  await recordInvariantEvaluation(db, ctx, {
    controlId: CTRL_06_ID,
    controlVersion: CTRL_06_VERSION,
    subjectId: input.subjectId,
    evaluationWindow: window,
    inputHash: contentHash({ existingIngestEventId: input.existingIngestEventId, evidenceIds }),
    result: violated ? 'violated' : 'clean',
    amountMinor: violated ? input.exposureAmountMinor : null,
    evidenceIds,
    evaluatedAt: input.evaluatedAt,
  });
  if (!violated) return { violated, caseId: null, caseCreated: false };
  const result = await openControlCase(db, ctx, {
    controlId: CTRL_06_ID,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow: window,
    exposureAmountMinor: input.exposureAmountMinor,
  });
  return { violated, caseId: result.caseId, caseCreated: result.created };
}
