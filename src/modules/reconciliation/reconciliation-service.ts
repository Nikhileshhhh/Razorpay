import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../../config/db.js';
import {
  actions,
  cases,
  economicSubjects,
  expectations,
  ingestEvents,
  receivableClosures,
  reconciliationAllocations,
  reconciliationReversals,
} from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import { isUniqueViolation } from '../../config/errors.js';
import { CanonicalEvent } from '../../contracts/events/canonical-event.js';
import type { ReconciliationResult } from '../../contracts/reconciliation.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { appendAuditEntry } from '../audit/audit-writer.js';
import {
  computeDecisionBasisHash,
  rebuildDecisionBasis,
  resolveBasisExpiry,
} from '../approvals/decision-basis.js';
import { reserveActionInTransaction } from '../actions/action-service.js';
import { MONEYTRACE_WORKER_ACTOR } from '../identity/worker-actor.js';
import { evaluateCasePolicyInTransaction } from '../policy/policy-service.js';
import { ensurePolicyBundleExists } from '../policy/policy-bundle.js';
import { proposePlanInTransaction } from '../policy/plan-service.js';

export class ReconciliationNotFoundError extends Error {
  constructor() {
    super('expectation or case not found');
    this.name = 'ReconciliationNotFoundError';
  }
}

export interface ReconcileExpectationResult {
  readonly reconciliation: ReconciliationResult;
  readonly closeActionId: string | null;
}

interface Candidate {
  readonly bankEvidenceId: string;
  readonly settlementEvidenceId: string;
}

function utcDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function parseSettlements(
  rows: readonly (typeof ingestEvents.$inferSelect)[],
  amountMinor: bigint,
  currency: string,
) {
  return rows.flatMap((row) => {
    const result = CanonicalEvent.safeParse(row.rawPayload);
    if (!result.success) return [];
    const event = result.data;
    const data = event.data as Record<string, unknown>;
    const eligible =
      event.event_type === 'SettlementObserved' &&
      data.settlement_scope === 'RECIPIENT' &&
      typeof data.utr === 'string' &&
      typeof data.value_date === 'string' &&
      Boolean(event.entity_references.recipient_account_id) &&
      row.amountMinor === amountMinor &&
      row.currency === currency;
    return eligible ? [{ row, event }] : [];
  });
}

function parseBanks(
  rows: readonly (typeof ingestEvents.$inferSelect)[],
  amountMinor: bigint,
  currency: string,
) {
  return rows.flatMap((row) => {
    const result = CanonicalEvent.safeParse(row.rawPayload);
    if (!result.success) return [];
    const event = result.data;
    const eligible =
      event.event_type === 'BankCreditObserved' &&
      row.sourceSystem === 'SYNTHETIC_BANK' &&
      row.amountMinor === amountMinor &&
      row.currency === currency &&
      Boolean(event.entity_references.recipient_account_id);
    return eligible ? [{ row, event }] : [];
  });
}

/**
 * Pair a subject's eligible settlement evidence against the TENANT-WIDE pool
 * of eligible bank evidence (never just that subject's own bank rows): a
 * bank credit's `economic_subject_hint` is an ingestion-time guess, not
 * ground truth, so the SAME physical bank evidence row must be checkable
 * against every current expectation's settlement — otherwise a bank line
 * that genuinely satisfies two different expectations' settlements could
 * never be detected as contested (backend PRD §13.2, ADR 0002 D4).
 */
function exactCandidates(
  settlementRows: readonly (typeof ingestEvents.$inferSelect)[],
  bankRows: readonly (typeof ingestEvents.$inferSelect)[],
  amountMinor: bigint,
  currency: string,
  valueDateWindowDays: number,
): Candidate[] {
  const settlements = parseSettlements(settlementRows, amountMinor, currency);
  const banks = parseBanks(bankRows, amountMinor, currency);
  const candidates: Candidate[] = [];
  for (const settlement of settlements) {
    const settlementData = settlement.event.data as Record<string, unknown>;
    for (const bank of banks) {
      const bankData = bank.event.data as Record<string, unknown>;
      const datesValid =
        typeof settlementData.value_date === 'string' &&
        typeof bankData.value_date === 'string' &&
        Math.abs(utcDay(settlementData.value_date) - utcDay(bankData.value_date)) <=
          valueDateWindowDays * 86_400_000;
      if (
        settlementData.utr === bankData.utr &&
        settlement.event.entity_references.recipient_account_id ===
          bank.event.entity_references.recipient_account_id &&
        datesValid
      ) {
        candidates.push({
          bankEvidenceId: bank.row.id,
          settlementEvidenceId: settlement.row.id,
        });
      }
    }
  }
  return candidates;
}

export class ReconciliationAmbiguousError extends Error {
  constructor(readonly reason: 'multiple_candidates' | 'contested_bank_line') {
    super(`reconciliation ambiguous: ${reason}`);
    this.name = 'ReconciliationAmbiguousError';
  }
}

interface TenantWideCandidateResult {
  /** This expectation's own exact-match candidate bank/settlement pairs. */
  readonly candidates: Candidate[];
  /** True when this expectation's unique candidate bank line is ALSO an
   * exact-match candidate for at least one OTHER current expectation in the
   * tenant — one bank line satisfying two expectations, never auto-resolved. */
  readonly bankLineContested: boolean;
}

/**
 * Enumerate the COMPLETE tenant-wide bank-line <-> current-expectation
 * candidate graph (backend PRD §13.2, ADR 0002 D4) — never a single
 * expectation's own subject in isolation. A single physical bank/settlement
 * evidence pair is authoritative for at most one expectation; the previous
 * implementation only ever asked "does MY subject's own evidence contain a
 * unique match", which structurally could never detect the SAME bank line
 * also exactly matching a DIFFERENT current expectation's evidence (a real
 * "one bank line, two expectations" ambiguity) or two callers racing for it.
 * The caller must hold the tenant-wide reconciliation advisory lock (see
 * `reconcileExpectationInTransaction`) before calling this, and this
 * function itself row-locks every current expectation and every eligible
 * bank/settlement evidence row tenant-wide so the graph it returns cannot
 * change out from under the caller before the allocation commits.
 */
async function tenantWideCandidates(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  expectationId: string,
): Promise<TenantWideCandidateResult> {
  await tx.execute(sql`
    select id from expectations
    where tenant_id = ${ctx.tenantId} and is_current = true
    order by id
    for update
  `);
  await tx.execute(sql`
    select id from ingest_events
    where tenant_id = ${ctx.tenantId}
      and event_type in ('SettlementObserved', 'BankCreditObserved')
      and signature_status = 'verified'
      and quarantine_status = 'none'
    order by id
    for update
  `);
  const currentExpectations = await tx
    .select()
    .from(expectations)
    .where(and(eq(expectations.tenantId, ctx.tenantId), eq(expectations.isCurrent, true)));
  const subjectRows = await tx
    .select({ id: economicSubjects.id, subjectKey: economicSubjects.subjectKey })
    .from(economicSubjects)
    .where(eq(economicSubjects.tenantId, ctx.tenantId));
  const subjectKeyById = new Map(subjectRows.map((row) => [row.id, row.subjectKey]));

  // Bank lines already consumed by an existing allocation are never
  // available candidates for a different expectation (ADR D4: one bank line
  // allocates to at most one expectation).
  const consumedRows = await tx
    .select({ bankLineEvidenceId: reconciliationAllocations.bankLineEvidenceId })
    .from(reconciliationAllocations)
    .where(eq(reconciliationAllocations.tenantId, ctx.tenantId));
  const consumedBankLines = new Set(consumedRows.map((row) => row.bankLineEvidenceId));

  const evidenceRows = await tx
    .select()
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        inArray(ingestEvents.eventType, ['SettlementObserved', 'BankCreditObserved']),
        eq(ingestEvents.signatureStatus, 'verified'),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );
  // Settlements are seller-side facts and stay scoped to their own subject's
  // hint. Bank evidence is a tenant-wide pool: its hint is only an
  // ingestion-time guess, so the SAME bank row must remain checkable against
  // every current expectation's settlement, not just the one it happened to
  // be hinted to.
  const settlementsBySubject = new Map<string, (typeof evidenceRows)[number][]>();
  const bankRowsAll: (typeof evidenceRows)[number][] = [];
  for (const row of evidenceRows) {
    if (consumedBankLines.has(row.id)) continue;
    if (row.eventType === 'SettlementObserved') {
      if (!row.economicSubjectHint) continue;
      const bucket = settlementsBySubject.get(row.economicSubjectHint) ?? [];
      bucket.push(row);
      settlementsBySubject.set(row.economicSubjectHint, bucket);
    } else if (row.eventType === 'BankCreditObserved') {
      bankRowsAll.push(row);
    }
  }

  const candidatesByExpectation = new Map<string, Candidate[]>();
  const bankLineOwners = new Map<string, Set<string>>();
  for (const expectation of currentExpectations) {
    const subjectKey = subjectKeyById.get(expectation.subjectId);
    if (!subjectKey) continue;
    const settlementRows = settlementsBySubject.get(subjectKey) ?? [];
    const found = exactCandidates(
      settlementRows,
      bankRowsAll,
      expectation.expectedAmountMinor,
      expectation.currency,
      2,
    );
    candidatesByExpectation.set(expectation.id, found);
    for (const candidate of found) {
      const owners = bankLineOwners.get(candidate.bankEvidenceId) ?? new Set<string>();
      owners.add(expectation.id);
      bankLineOwners.set(candidate.bankEvidenceId, owners);
    }
  }

  const candidates = candidatesByExpectation.get(expectationId) ?? [];
  const bankLineContested = candidates.some(
    (candidate) => (bankLineOwners.get(candidate.bankEvidenceId)?.size ?? 0) > 1,
  );
  return { candidates, bankLineContested };
}

async function ensureCloseAction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  allocation: typeof reconciliationAllocations.$inferSelect,
): Promise<string> {
  const plan = await proposePlanInTransaction(tx, ctx, {
    caseId: allocation.caseId,
    templateId: 'CLOSE_RECEIVABLE_AFTER_RECONCILIATION',
    parameters: {
      tool_id: 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION',
      expectation_id: allocation.expectationId,
    },
    authorityLevel: 'L3',
    maximumAmountImpact: { amountMinor: 0n, currency: 'INR' },
  });
  const existingActions = await tx
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.tenantId, ctx.tenantId),
        eq(actions.planId, plan.id),
        eq(actions.caseId, allocation.caseId),
      ),
    )
    .limit(1);
  if (existingActions[0]) return existingActions[0].id;

  await ensurePolicyBundleExists(tx);
  const policy = await evaluateCasePolicyInTransaction(
    tx,
    ctx,
    { caseId: allocation.caseId, planId: plan.id, expectedPlanVersion: plan.version },
    MONEYTRACE_WORKER_ACTOR,
    {
      allocation_id: allocation.id,
      expectation_id: allocation.expectationId,
      status: 'ALLOCATED',
      closure_status: 'NONE',
      reversal_status: 'NONE',
      resource_version: 0,
    },
  );
  if (policy.record.decision !== 'ALLOW_AUTOMATIC') {
    throw new Error('reconciliation-gated close policy denied');
  }
  const expiresAt = await resolveBasisExpiry(tx, ctx, plan.id);
  const basis = await rebuildDecisionBasis(
    tx,
    ctx,
    { caseId: allocation.caseId, planId: plan.id },
    expiresAt,
  );
  if (!basis) throw new Error('close action decision basis is incomplete');
  const action = await reserveActionInTransaction(
    tx,
    ctx,
    {
      caseId: allocation.caseId,
      planId: plan.id,
      decisionBasisHash: computeDecisionBasisHash(basis),
    },
    MONEYTRACE_WORKER_ACTOR,
  );
  return action.action_id;
}

export async function reconcileExpectationInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  expectationId: string,
  now = new Date(),
): Promise<ReconcileExpectationResult> {
  // A single TENANT-WIDE advisory lock (not per-expectation) so concurrent
  // reconcile calls for the same tenant fully serialize — required to
  // enumerate and lock the COMPLETE candidate graph safely (a bank line
  // cannot be evaluated in isolation per expectation; see
  // `tenantWideCandidates`).
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|reconciliation-tenant-wide`}, 0))`,
  );
  await tx.execute(
    sql`select id from expectations where tenant_id = ${ctx.tenantId} and id = ${expectationId} for update`,
  );
  const expectationRows = await tx
    .select()
    .from(expectations)
    .where(
      and(
        eq(expectations.tenantId, ctx.tenantId),
        eq(expectations.id, expectationId),
        eq(expectations.isCurrent, true),
      ),
    )
    .limit(1);
  const expectation = expectationRows[0];
  if (!expectation || expectation.currency !== 'INR') throw new ReconciliationNotFoundError();
  const existingRows = await tx
    .select()
    .from(reconciliationAllocations)
    .where(
      and(
        eq(reconciliationAllocations.tenantId, ctx.tenantId),
        eq(reconciliationAllocations.expectationId, expectationId),
      ),
    )
    .limit(1);
  let allocation = existingRows[0] ?? null;
  const caseRows = await tx
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.tenantId, ctx.tenantId),
        eq(cases.expectationId, expectationId),
        allocation ? eq(cases.id, allocation.caseId) : eq(cases.isActiveEpoch, true),
      ),
    );
  if (caseRows.length !== 1) throw new ReconciliationNotFoundError();
  const caseRow = caseRows[0]!;
  let evidenceIds: string[];
  if (!allocation) {
    const subjectRows = await tx
      .select({ subjectKey: economicSubjects.subjectKey })
      .from(economicSubjects)
      .where(
        and(
          eq(economicSubjects.tenantId, ctx.tenantId),
          eq(economicSubjects.id, expectation.subjectId),
        ),
      )
      .limit(1);
    if (!subjectRows[0]) throw new ReconciliationNotFoundError();
    const { candidates, bankLineContested } = await tenantWideCandidates(tx, ctx, expectationId);
    evidenceIds = [
      ...new Set(candidates.flatMap((c) => [c.settlementEvidenceId, c.bankEvidenceId])),
    ].sort();
    if (candidates.length !== 1 || bankLineContested) {
      const status = candidates.length > 1 || bankLineContested ? 'AMBIGUOUS' : 'UNRESOLVED';
      const reason: 'multiple_candidates' | 'contested_bank_line' | null =
        candidates.length > 1
          ? 'multiple_candidates'
          : bankLineContested
            ? 'contested_bank_line'
            : null;
      const reconciliationId = `reconciliation_${contentHash({ expectationId, status, evidenceIds }).slice(7)}`;
      if (status === 'AMBIGUOUS') {
        await appendAuditEntry(tx, ctx, {
          artifactType: 'RECONCILIATION',
          artifactId: reconciliationId,
          actorId: null,
          actorRole: MONEYTRACE_WORKER_ACTOR.role,
          deterministicId: `audit_${reconciliationId}`,
          details: {
            operation: 'reconciliation_ambiguous',
            case_id: caseRow.id,
            expectation_id: expectationId,
            candidate_count: candidates.length,
            reason,
          },
        });
      }
      return {
        reconciliation: {
          schema_version: '1.0',
          reconciliation_id: reconciliationId,
          case_id: caseRow.id,
          subject_id: expectation.subjectId,
          status,
          matched_amount: {
            amount_minor: expectation.expectedAmountMinor.toString(),
            currency: 'INR',
          },
          difference: { amount_minor: '0', currency: 'INR' },
          match_type: 'EXACT_ONE_TO_ONE',
          allocation: null,
          closed_receivable_id: null,
          evidence_ids: evidenceIds,
          created_at: now.toISOString(),
        },
        closeActionId: null,
      };
    }
    const allocationId = `allocation_${randomUUID()}`;
    try {
      await tx.insert(reconciliationAllocations).values({
        id: allocationId,
        tenantId: ctx.tenantId,
        caseId: caseRow.id,
        expectationId,
        bankLineEvidenceId: candidates[0]!.bankEvidenceId,
        amountMinor: expectation.expectedAmountMinor,
        currency: 'INR',
        status: 'ALLOCATED',
        createdAt: now,
      });
    } catch (error) {
      // Defense in depth: the tenant-wide advisory lock plus the
      // recomputed-after-lock candidate graph above should make this
      // unreachable in practice, but a real unique-constraint race must
      // never leak a raw PostgreSQL error — reclassify it as the same typed
      // ambiguity outcome rather than crashing the caller.
      if (
        isUniqueViolation(error, 'reconciliation_allocations_bank_line_uq') ||
        isUniqueViolation(error, 'reconciliation_allocations_expectation_uq')
      ) {
        throw new ReconciliationAmbiguousError('contested_bank_line');
      }
      throw error;
    }
    allocation = (
      await tx
        .select()
        .from(reconciliationAllocations)
        .where(
          and(
            eq(reconciliationAllocations.tenantId, ctx.tenantId),
            eq(reconciliationAllocations.id, allocationId),
          ),
        )
        .limit(1)
    )[0]!;
  } else {
    evidenceIds = [allocation.bankLineEvidenceId];
  }
  const reversalRows = await tx
    .select({ id: reconciliationReversals.id })
    .from(reconciliationReversals)
    .where(
      and(
        eq(reconciliationReversals.tenantId, ctx.tenantId),
        eq(reconciliationReversals.allocationId, allocation.id),
      ),
    )
    .limit(1);
  if (reversalRows[0]) throw new Error('reversed allocation cannot close a receivable');
  await appendAuditEntry(tx, ctx, {
    artifactType: 'RECONCILIATION',
    artifactId: allocation.id,
    actorId: null,
    actorRole: MONEYTRACE_WORKER_ACTOR.role,
    deterministicId: `audit_reconciliation_${allocation.id}`,
    details: {
      operation: 'reconciliation_allocated',
      case_id: caseRow.id,
      allocation_id: allocation.id,
      expectation_id: expectationId,
      bank_line_evidence_id: allocation.bankLineEvidenceId,
    },
  });
  const closeActionId = await ensureCloseAction(tx, ctx, allocation);
  // A retry after the receivable has already been observed-closed must
  // report that persisted fact, not silently re-report "not yet closed".
  const existingClosure = await tx
    .select({ id: receivableClosures.id })
    .from(receivableClosures)
    .where(
      and(
        eq(receivableClosures.tenantId, ctx.tenantId),
        eq(receivableClosures.allocationId, allocation.id),
      ),
    )
    .limit(1);
  return {
    reconciliation: {
      schema_version: '1.0',
      reconciliation_id: allocation.id,
      case_id: caseRow.id,
      subject_id: expectation.subjectId,
      status: 'ALLOCATED',
      matched_amount: {
        amount_minor: allocation.amountMinor.toString(),
        currency: 'INR',
      },
      difference: { amount_minor: '0', currency: 'INR' },
      match_type: 'EXACT_ONE_TO_ONE',
      allocation: {
        allocation_id: allocation.id,
        bank_line_evidence_id: allocation.bankLineEvidenceId,
        expectation_id: expectationId,
        amount: { amount_minor: allocation.amountMinor.toString(), currency: 'INR' },
      },
      closed_receivable_id: existingClosure[0]?.id ?? null,
      evidence_ids: evidenceIds,
      created_at: allocation.createdAt.toISOString(),
    },
    closeActionId,
  };
}

export async function reconcileExpectation(
  db: Database,
  ctx: TenantContext,
  expectationId: string,
  now = new Date(),
): Promise<ReconcileExpectationResult> {
  return db.transaction((tx) => reconcileExpectationInTransaction(tx, ctx, expectationId, now));
}
