import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  auditEntries,
  cases,
  caseRelationships,
  caseTransitions,
  financialOutcomes,
} from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import {
  assertCaseLifecycleTransition,
  type CaseLifecycleState,
} from '../../domain/state-machines/case-lifecycle.js';
import type { Money } from '../../domain/money/money.js';
import { computeCaseDedupeKey } from './case-key.js';
import { computePriorityScore, type PriorityInputs } from './priority.js';

export class CaseVersionConflictError extends Error {
  constructor(caseId: string, expected: number, actual: number) {
    super(`case ${caseId} version conflict: expected ${expected}, actual ${actual}`);
    this.name = 'CaseVersionConflictError';
  }
}

const TERMINAL_CASE_STATES: ReadonlySet<CaseLifecycleState> = new Set([
  'reconciled',
  'escalated',
  'rejected',
  'expired',
  'cancelled',
  'closed_no_action',
]);

export interface OpenOrGetCaseInput {
  readonly controlId: string;
  readonly subjectId: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly evaluationWindow: string;
  readonly exposure: Money;
  readonly priority: PriorityInputs;
}

export interface OpenOrGetCaseResult {
  readonly caseId: string;
  readonly created: boolean;
  readonly dedupeKey: string;
}

/**
 * Idempotent case creation (backend PRD §10.2, FR-CASE-001): the SAME
 * dedupe key always resolves to the SAME active case epoch, so concurrent or
 * replayed invariant violations never create a duplicate case (CTRL-06).
 */
export async function openOrGetCase(
  db: Database,
  ctx: TenantContext,
  input: OpenOrGetCaseInput,
): Promise<OpenOrGetCaseResult> {
  const dedupeKey = computeCaseDedupeKey({
    tenantId: ctx.tenantId,
    controlId: input.controlId,
    subjectId: input.subjectId,
    expectationVersion: input.expectationVersion,
    evaluationWindow: input.evaluationWindow,
  });

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|case|${dedupeKey}`}, 0))`,
    );
    const existing = await tx
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.caseDedupeKey, dedupeKey),
          eq(cases.isActiveEpoch, true),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { caseId: existing[0].id, created: false, dedupeKey };
    }

    const priorEpochRows = await tx
      .select({ epoch: cases.epoch, id: cases.id })
      .from(cases)
      .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.caseDedupeKey, dedupeKey)))
      .orderBy(desc(cases.epoch))
      .limit(1);
    const nextEpoch = (priorEpochRows[0]?.epoch ?? -1) + 1;

    const caseId = `case_${randomUUID()}`;
    const priorityScore = computePriorityScore(input.priority);
    await tx.insert(cases).values({
      id: caseId,
      tenantId: ctx.tenantId,
      caseDedupeKey: dedupeKey,
      epoch: nextEpoch,
      subjectId: input.subjectId,
      expectationId: input.expectationId,
      controlId: input.controlId,
      lifecycleState: 'open',
      exposureAmountMinor: input.exposure.amountMinor,
      currency: input.exposure.currency,
      priorityScore: priorityScore.toString(),
      evidenceCoverage: input.priority.evidenceCoverage,
      contradictionCount: 0,
      version: 0,
      isActiveEpoch: true,
    });
    await tx.insert(caseTransitions).values({
      id: `trans_${randomUUID()}`,
      tenantId: ctx.tenantId,
      caseId,
      fromState: null,
      toState: 'open',
      reason: `invariant_violation:${input.controlId}`,
      expectedVersion: 0,
    });
    if (priorEpochRows[0]) {
      await tx.insert(caseRelationships).values({
        id: `case_rel_${randomUUID()}`,
        tenantId: ctx.tenantId,
        sourceCaseId: caseId,
        targetCaseId: priorEpochRows[0].id,
        relationshipType: 'reopened_from',
        reason: 'authoritative evidence reopened a terminal case epoch',
      });
    }
    const currentOutcomeRows = await tx
      .select()
      .from(financialOutcomes)
      .where(
        and(
          eq(financialOutcomes.tenantId, ctx.tenantId),
          eq(financialOutcomes.expectationId, input.expectationId),
          eq(financialOutcomes.isCurrent, true),
        ),
      )
      .limit(1);
    const currentOutcome = currentOutcomeRows[0];
    if (currentOutcome?.status !== 'DIVERGED') {
      if (currentOutcome) {
        await tx
          .update(financialOutcomes)
          .set({ isCurrent: false })
          .where(
            and(
              eq(financialOutcomes.tenantId, ctx.tenantId),
              eq(financialOutcomes.id, currentOutcome.id),
            ),
          );
      }
      await tx.insert(financialOutcomes).values({
        id: `outcome_${randomUUID()}`,
        tenantId: ctx.tenantId,
        expectationId: input.expectationId,
        status: 'DIVERGED',
        version: (currentOutcome?.version ?? 0) + 1,
        observedAmountMinor: null,
        currency: input.exposure.currency,
        isCurrent: true,
      });
    }
    return { caseId, created: true, dedupeKey };
  });
}

/** Append an audited merge/suppression relationship without erasing either case. */
export async function appendCaseRelationship(
  db: Database,
  ctx: TenantContext,
  input: {
    readonly sourceCaseId: string;
    readonly targetCaseId: string;
    readonly relationshipType: 'duplicate_of' | 'superseded_by';
    readonly reason: string;
    readonly expectedSourceVersion: number;
    readonly actorId: string;
    readonly actorRole: string;
  },
): Promise<number> {
  return db.transaction(async (tx) => {
    const targets = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          inArray(cases.id, [input.sourceCaseId, input.targetCaseId]),
        ),
      );
    if (new Set(targets.map((row) => row.id)).size !== 2) {
      throw new Error('case relationship target not found');
    }
    const nextVersion = input.expectedSourceVersion + 1;
    const source = await tx
      .update(cases)
      .set({ version: nextVersion })
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.id, input.sourceCaseId),
          eq(cases.version, input.expectedSourceVersion),
        ),
      )
      .returning({ id: cases.id });
    if (source.length !== 1) {
      throw new CaseVersionConflictError(
        input.sourceCaseId,
        input.expectedSourceVersion,
        nextVersion,
      );
    }
    const relationshipId = `case_rel_${randomUUID()}`;
    await tx.insert(caseRelationships).values({
      id: relationshipId,
      tenantId: ctx.tenantId,
      sourceCaseId: input.sourceCaseId,
      targetCaseId: input.targetCaseId,
      relationshipType: input.relationshipType,
      reason: input.reason,
      actorId: input.actorId,
    });
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'ADMIN_CHANGE',
      artifactId: relationshipId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      details: {
        operation: 'case_relationship_appended',
        relationship_type: input.relationshipType,
        source_case_id: input.sourceCaseId,
        target_case_id: input.targetCaseId,
      },
    });
    return nextVersion;
  });
}

export interface TransitionCaseInput {
  readonly caseId: string;
  readonly toState: CaseLifecycleState;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId?: string | null;
  readonly evidenceIds?: readonly string[];
}

/**
 * Guarded case-lifecycle transition: validates the domain state graph AND
 * optimistic concurrency (expected version) in one transaction, recording the
 * from/to/reason/evidence/actor per backend PRD §7.3.
 */
export async function transitionCase(
  db: Database,
  ctx: TenantContext,
  input: TransitionCaseInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new Error(`case not found: ${input.caseId}`);
    if (current.version !== input.expectedVersion) {
      throw new CaseVersionConflictError(input.caseId, input.expectedVersion, current.version);
    }

    assertCaseLifecycleTransition(current.lifecycleState as CaseLifecycleState, input.toState);

    const terminal = TERMINAL_CASE_STATES.has(input.toState);
    const updated = await tx
      .update(cases)
      .set({
        lifecycleState: input.toState,
        version: current.version + 1,
        isActiveEpoch: !terminal,
        closedAt: terminal ? new Date() : null,
      })
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.id, input.caseId),
          eq(cases.version, input.expectedVersion),
        ),
      )
      .returning({ id: cases.id });
    if (updated.length !== 1) {
      throw new CaseVersionConflictError(input.caseId, input.expectedVersion, current.version + 1);
    }

    await tx.insert(caseTransitions).values({
      id: `trans_${randomUUID()}`,
      tenantId: ctx.tenantId,
      caseId: input.caseId,
      fromState: current.lifecycleState,
      toState: input.toState,
      reason: input.reason,
      evidenceIds: input.evidenceIds ?? [],
      actorId: input.actorId ?? null,
      expectedVersion: input.expectedVersion,
    });
  });
}

export async function getCase(db: Database, ctx: TenantContext, caseId: string) {
  const rows = await db
    .select()
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, caseId)))
    .limit(1);
  return rows[0] ?? null;
}
