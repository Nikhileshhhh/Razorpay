import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { invariantEvaluations } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';

export interface RecordEvaluationInput {
  readonly controlId: string;
  readonly controlVersion: string;
  readonly subjectId: string;
  readonly evaluationWindow: string;
  readonly inputHash: string;
  readonly result: 'clean' | 'violated';
  readonly amountMinor: bigint | null;
  readonly evidenceIds: readonly string[];
  readonly evaluatedAt: Date;
}

export interface RecordedEvaluation {
  readonly id: string;
  readonly version: number;
  readonly reused: boolean;
  readonly result: 'clean' | 'violated';
}

/** Append a new immutable evaluation only when the deterministic input changed. */
export async function recordInvariantEvaluation(
  db: Database,
  ctx: TenantContext,
  input: RecordEvaluationInput,
): Promise<RecordedEvaluation> {
  return db.transaction(async (tx) => {
    const identity = `${ctx.tenantId}|${input.controlId}|${input.controlVersion}|${input.subjectId}|${input.evaluationWindow}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const rows = await tx
      .select()
      .from(invariantEvaluations)
      .where(
        and(
          eq(invariantEvaluations.tenantId, ctx.tenantId),
          eq(invariantEvaluations.controlId, input.controlId),
          eq(invariantEvaluations.controlVersion, input.controlVersion),
          eq(invariantEvaluations.subjectId, input.subjectId),
          eq(invariantEvaluations.evaluationWindow, input.evaluationWindow),
        ),
      )
      .orderBy(desc(invariantEvaluations.evaluationVersion))
      .limit(1);
    const latest = rows[0];
    if (latest?.inputHash === input.inputHash) {
      return {
        id: latest.id,
        version: latest.evaluationVersion,
        reused: true,
        result: latest.result as 'clean' | 'violated',
      };
    }

    const id = `inv_${randomUUID()}`;
    const version = (latest?.evaluationVersion ?? 0) + 1;
    await tx.insert(invariantEvaluations).values({
      id,
      tenantId: ctx.tenantId,
      controlId: input.controlId,
      controlVersion: input.controlVersion,
      subjectId: input.subjectId,
      evaluationWindow: input.evaluationWindow,
      inputHash: input.inputHash,
      result: input.result,
      amountMinor: input.amountMinor,
      currency: input.amountMinor == null ? null : 'INR',
      evidenceIds: [...input.evidenceIds],
      evaluatedAt: input.evaluatedAt,
      evaluationVersion: version,
    });
    return { id, version, reused: false, result: input.result };
  });
}
