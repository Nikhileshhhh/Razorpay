import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { cases, economicSubjects, expectations, outbox } from '../../config/db-schema.js';
import type { Env } from '../../config/env.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { runInvestigation } from '../investigation/investigation-service.js';
import { evaluateCasePolicy } from '../policy/policy-service.js';
import { getCurrentPlan } from '../policy/plan-service.js';
import { reserveAction } from '../actions/action-service.js';
import { reconcileExpectation } from '../reconciliation/reconciliation-service.js';
import {
  rebuildDecisionBasis,
  computeDecisionBasisHash,
  resolveBasisExpiry,
} from '../approvals/decision-basis.js';
import {
  ingestSyntheticEvidence as ingestSyntheticEvidenceOnce,
  ingestConflictingDuplicate,
  type SyntheticEvidenceInput,
} from './evidence-builder.js';

function ingestSyntheticEvidence(
  db: Database,
  ctx: TenantContext,
  input: SyntheticEvidenceInput,
): Promise<string | null> {
  return ingestSyntheticEvidenceOnce(db, ctx, input, { reuseExactDuplicate: true });
}

const INVESTIGATOR = 'user_investigator';
const OPERATOR = 'user_operator';

/**
 * Real, service-driven flows that produce the 500-record dataset's four
 * structural buckets plus the one dedicated duplicate-recovery-prevention
 * record (backend PRD §16.1, ADR 0002 D7/D9). Every flow uses the same
 * application services the four named demo scenarios and the B4 API routes
 * use — there is no hand-rolled row insertion of case/expectation/outcome
 * state anywhere in this file. The resulting manifest metrics in
 * `dataset.ts` are therefore computed from genuinely persisted state, never
 * narrated.
 *
 * Registered bucket semantics (documented here because no dataset schema
 * column encodes them — they are derived, not stored):
 *
 * - MATCHED: the subject's `PaymentCaptured` evaluation already sees a
 *   qualifying `TransferProcessed` in `entity_current` (ingested first), so
 *   CTRL-01's 1-hour grace/missing-transfer check never violates and no case
 *   ever opens for the subject.
 * - UNRESOLVED: no transfer evidence is ever ingested and the capture time is
 *   set more than the CTRL-01 grace window before the fixed evaluation clock,
 *   so CTRL-01 violates and opens (and never resolves) a CTRL-01 case.
 * - UNSAFE CANDIDATE (blocked): like UNRESOLVED, a CTRL-01 case opens, but
 *   settlement/bank evidence later arrives with more than one authoritative
 *   candidate pairing, so a real `reconcileExpectation` call abstains
 *   `AMBIGUOUS` and records a `reconciliation_ambiguous` audit fact — the
 *   real mechanism `unsafe_candidate_matches_blocked` counts, distinguishing
 *   these subjects from the plain UNRESOLVED ones.
 * - OTHER UNMATCHED: a MATCHED-shape record additionally receives a
 *   same-source-ID/different-hash duplicate submission, which the real
 *   ingestion boundary quarantines into `event_conflicts` (PRD §9.1) — a
 *   genuine data-quality reason the record fails the MATCHED predicate
 *   without opening any case.
 */

function sellerAllocationMinor(captureAmountMinor: bigint): bigint {
  // Mirrors the money kernel's 91% seller / 9% platform split
  // (`allocateSellerObligation`) closely enough for round demo amounts; the
  // real expectation service computes the authoritative value independently,
  // this is only used to build matching TransferProcessed evidence.
  return (captureAmountMinor * 91n) / 100n;
}

export interface DatasetFlowResult {
  readonly subjectKey: string;
  readonly primaryIngestEventId: string;
}

/** MATCHED: transfer evidence arrives before capture, so CTRL-01 never violates. */
export async function seedMatchedRecord(
  db: Database,
  ctx: TenantContext,
  ordinal: number,
  captureTime: Date,
  ingestedAt: Date,
  captureAmountMinor = 1_000_000n,
): Promise<DatasetFlowResult> {
  const padded = ordinal.toString().padStart(3, '0');
  const subjectKey = `dataset:matched:${padded}`;
  const recipient = `matched_recipient_${padded}`;
  const seller = sellerAllocationMinor(captureAmountMinor);

  await ingestSyntheticEvidence(db, ctx, {
    key: `matched_${padded}_order_created`,
    subject: subjectKey,
    type: 'OrderCreated',
    source: 'SYNTHETIC_OMS',
    occurredAt: captureTime,
    ingestedAt,
    references: { order_id: `matched_${padded}_order` },
  });
  // Transfer evidence FIRST — projected before the capture's CTRL-01 check.
  await ingestSyntheticEvidence(db, ctx, {
    key: `matched_${padded}_transfer`,
    subject: subjectKey,
    type: 'TransferProcessed',
    source: 'SYNTHETIC_ROUTE',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: seller,
    references: { transfer_id: `matched_${padded}_transfer`, recipient_account_id: recipient },
  });
  const captureEventId = await ingestSyntheticEvidence(db, ctx, {
    key: `matched_${padded}_capture`,
    subject: subjectKey,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: captureAmountMinor,
    references: { payment_id: `matched_${padded}_payment` },
  });
  if (!captureEventId) throw new Error(`dataset matched record ${padded} capture was not accepted`);
  return { subjectKey, primaryIngestEventId: captureEventId };
}

/** UNRESOLVED: capture only, no transfer ever arrives, grace already expired. */
export async function seedUnresolvedRecord(
  db: Database,
  ctx: TenantContext,
  ordinal: number,
  captureTime: Date,
  ingestedAt: Date,
  captureAmountMinor: bigint,
): Promise<DatasetFlowResult> {
  const padded = ordinal.toString().padStart(3, '0');
  const subjectKey = `dataset:unresolved:${padded}`;

  await ingestSyntheticEvidence(db, ctx, {
    key: `unresolved_${padded}_order_created`,
    subject: subjectKey,
    type: 'OrderCreated',
    source: 'SYNTHETIC_OMS',
    occurredAt: captureTime,
    ingestedAt,
    references: { order_id: `unresolved_${padded}_order` },
  });
  const captureEventId = await ingestSyntheticEvidence(db, ctx, {
    key: `unresolved_${padded}_capture`,
    subject: subjectKey,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: captureAmountMinor,
    references: { payment_id: `unresolved_${padded}_payment` },
  });
  await ingestSyntheticEvidence(db, ctx, {
    key: `unresolved_${padded}_receivable_open`,
    subject: subjectKey,
    type: 'SellerReceivableOpened',
    source: 'SYNTHETIC_ERP',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: sellerAllocationMinor(captureAmountMinor),
    references: {
      receivable_id: `unresolved_${padded}_receivable`,
      recipient_account_id: `unresolved_${padded}_recipient`,
    },
  });
  if (!captureEventId)
    throw new Error(`dataset unresolved record ${padded} capture was not accepted`);
  return { subjectKey, primaryIngestEventId: captureEventId };
}

/**
 * UNSAFE CANDIDATE (blocked): the missing-transfer case opens exactly like
 * UNRESOLVED, then two independently authoritative settlement/bank pairings
 * for the SAME expectation make the candidate set ambiguous — real
 * `reconcileExpectation` abstains rather than guessing (backend PRD §13.2,
 * ADR D4), leaving exposure open but recording a distinguishing audit fact.
 */
export async function seedUnsafeCandidateRecord(
  db: Database,
  ctx: TenantContext,
  ordinal: number,
  captureTime: Date,
  ingestedAt: Date,
  captureAmountMinor: bigint,
): Promise<DatasetFlowResult> {
  const padded = ordinal.toString().padStart(3, '0');
  const { subjectKey, primaryIngestEventId } = await seedUnresolvedRecordShape(
    db,
    ctx,
    'unsafe',
    padded,
    captureTime,
    ingestedAt,
    captureAmountMinor,
  );
  const seller = sellerAllocationMinor(captureAmountMinor);
  const recipient = `unsafe_${padded}_recipient`;
  const utr = `UTRUNSAFE${padded}`;
  // Anchored to `ingestedAt` (the fixed evaluation clock), not the far-past
  // `captureTime` used to force CTRL-01's grace to expire — otherwise
  // CTRL-03 ("seller receivable open after verified settlement") ALSO sees
  // its own grace window exceeded and opens a second competing case sharing
  // the same expectation, breaking reconciliation's single-case lookup.
  const settlementTime = new Date(ingestedAt.getTime() - 5 * 60_000);
  // Two independent settlement records that both pair with the SAME single
  // bank line (identical UTR/recipient/amount) give the candidate set
  // cardinality 2, not 0 or 1 — the reconciliation cardinality guard (ADR D4)
  // abstains AMBIGUOUS. Using one shared bank line (not two conflicting ones)
  // avoids also triggering CTRL-05's independent conflicting-bank-evidence
  // check, which would open a second unrelated case for this subject.
  for (const variant of ['a', 'b'] as const) {
    await ingestSyntheticEvidence(db, ctx, {
      key: `unsafe_${padded}_settlement_${variant}`,
      subject: subjectKey,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: settlementTime,
      ingestedAt,
      amountMinor: seller,
      references: {
        settlement_id: `unsafe_${padded}_settlement_${variant}`,
        recipient_account_id: recipient,
      },
      data: {
        settlement_scope: 'RECIPIENT',
        utr,
        value_date: settlementTime.toISOString().slice(0, 10),
      },
    });
  }
  const bankTime = new Date(ingestedAt.getTime() - 2 * 60_000);
  await ingestSyntheticEvidence(db, ctx, {
    key: `unsafe_${padded}_bank`,
    subject: subjectKey,
    type: 'BankCreditObserved',
    source: 'SYNTHETIC_BANK',
    occurredAt: bankTime,
    ingestedAt,
    amountMinor: seller,
    references: { bank_credit_id: `unsafe_${padded}_bank`, recipient_account_id: recipient },
    data: { utr, value_date: bankTime.toISOString().slice(0, 10) },
  });

  const expectationId = await currentExpectationId(db, ctx, subjectKey);
  await reconcileExpectation(db, ctx, expectationId, ingestedAt);
  return { subjectKey, primaryIngestEventId };
}

/** OTHER UNMATCHED: a MATCHED-shape record plus a real conflicting duplicate. */
export async function seedConflictedRecord(
  db: Database,
  ctx: TenantContext,
  ordinal: number,
  captureTime: Date,
  ingestedAt: Date,
  captureAmountMinor = 1_000_000n,
): Promise<DatasetFlowResult> {
  const padded = ordinal.toString().padStart(3, '0');
  const subjectKey = `dataset:conflicted:${padded}`;
  const recipient = `conflicted_recipient_${padded}`;
  const seller = sellerAllocationMinor(captureAmountMinor);

  await ingestSyntheticEvidence(db, ctx, {
    key: `conflicted_${padded}_transfer`,
    subject: subjectKey,
    type: 'TransferProcessed',
    source: 'SYNTHETIC_ROUTE',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: seller,
    references: { transfer_id: `conflicted_${padded}_transfer`, recipient_account_id: recipient },
  });
  const captureInput = {
    key: `conflicted_${padded}_capture`,
    subject: subjectKey,
    type: 'PaymentCaptured' as const,
    source: 'SYNTHETIC_RAZORPAY_FIXTURE' as const,
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: captureAmountMinor,
    references: { payment_id: `conflicted_${padded}_payment` },
  };
  const captureEventId = await ingestSyntheticEvidence(db, ctx, captureInput);
  if (!captureEventId)
    throw new Error(`dataset conflicted record ${padded} capture was not accepted`);
  // Same source_event_id, different amount => real quarantine into
  // `event_conflicts`, never overwriting or re-projecting the accepted row.
  const conflictOutcome = await ingestConflictingDuplicate(db, ctx, captureInput);
  if (conflictOutcome !== 'conflict') {
    throw new Error(`dataset conflicted record ${padded} did not quarantine as expected`);
  }
  return { subjectKey, primaryIngestEventId: captureEventId };
}

/**
 * The one dedicated CTRL-04 duplicate-recovery-prevention record: real
 * investigation -> policy (ALLOW_AUTOMATIC, no approval gate) -> reservation
 * -> dispatch -> signed suppression evidence -> verification, producing the
 * genuinely measured `duplicate_collection_prevented` total (backend PRD
 * §16.1, §12.2). Its subject is otherwise MATCHED-shaped (transfer arrives
 * before capture) so it also counts toward `records_matched`.
 */
export async function seedDuplicateRecoveryPreventedRecord(
  db: Database,
  ctx: TenantContext,
  ordinal: number,
  captureTime: Date,
  ingestedAt: Date,
  env: Pick<Env, 'MODEL_PROVIDER' | 'MODEL_API_URL' | 'MODEL_API_KEY'>,
  preventedAmountMinor: bigint,
): Promise<DatasetFlowResult> {
  const padded = ordinal.toString().padStart(3, '0');
  const { subjectKey, primaryIngestEventId } = await seedMatchedRecord(
    db,
    ctx,
    ordinal,
    captureTime,
    ingestedAt,
    preventedAmountMinor,
  );
  // Rename the subject key namespace so its dataset-record entry is
  // distinguishable in diagnostics, while keeping the same ledger contract.
  const recoveryTime = new Date(captureTime.getTime() + 30_000);
  await ingestSyntheticEvidence(db, ctx, {
    key: `duprec_${padded}_refund`,
    subject: subjectKey,
    type: 'RefundProcessed',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: recoveryTime,
    ingestedAt,
    amountMinor: preventedAmountMinor,
    references: { refund_id: `duprec_${padded}_refund`, payment_id: `matched_${padded}_payment` },
  });
  await ingestSyntheticEvidence(db, ctx, {
    key: `duprec_${padded}_recovery_scheduled`,
    subject: subjectKey,
    type: 'RecoveryScheduled',
    source: 'SYNTHETIC_RECOVERY',
    occurredAt: recoveryTime,
    ingestedAt,
    amountMinor: preventedAmountMinor,
    references: { recovery_id: `duprec_${padded}_recovery` },
  });

  // Real investigation -> policy -> reservation. Dispatch, the resulting
  // suppression evidence, and verification NEVER happen here — this
  // function is reachable from the API process (`/v1/imports`,
  // `/v1/demo/reset`), and only the worker may invoke adapter dispatch
  // (backend PRD §12.4/§18, architecture "least privilege"). Reservation
  // durably enqueues `dispatch-action.v1`; the plain outbox insert below
  // additionally durably enqueues the worker-only completion job
  // (`src/worker/complete-duplicate-recovery.ts`) that performs the actual
  // dispatch + evidence + verification asynchronously. Until a worker
  // drains that job, this record legitimately stays reserved/pending —
  // `duplicate_collection_prevented` reflects that honestly (see
  // `manifest-metrics.ts`), never a synchronously-forced value.
  const caseId = await currentCaseIdForControl(db, ctx, subjectKey, 'CTRL-04');
  await runInvestigation(db, ctx, env, { caseId, actorId: INVESTIGATOR });
  const plan = await getCurrentPlan(db, ctx, caseId);
  if (!plan) throw new Error(`duplicate-recovery record ${padded} produced no plan`);
  await evaluateCasePolicy(db, ctx, {
    caseId,
    planId: plan.id,
    expectedPlanVersion: plan.version,
    actorId: INVESTIGATOR,
  });
  const authorizedPlan = await getCurrentPlan(db, ctx, caseId);
  if (!authorizedPlan || authorizedPlan.status !== 'AUTHORIZED') {
    throw new Error(`duplicate-recovery record ${padded} policy did not auto-allow`);
  }
  // Must match exactly what `reserveActionInTransaction` resolves internally
  // when it rebuilds and compares the basis (backend PRD §12.4) — an
  // automatic (no-approval) plan resolves to the far-future
  // `AUTOMATIC_PLAN_BASIS_EXPIRY` sentinel, not a caller-invented value.
  const expiresAt = await resolveBasisExpiry(db, ctx, authorizedPlan.id);
  const basis = await rebuildDecisionBasis(
    db,
    ctx,
    { caseId, planId: authorizedPlan.id },
    expiresAt,
  );
  if (!basis) throw new Error(`duplicate-recovery record ${padded} basis was incomplete`);
  const action = await reserveAction(db, ctx, {
    caseId,
    planId: authorizedPlan.id,
    decisionBasisHash: computeDecisionBasisHash(basis),
    actorId: OPERATOR,
  });
  await db.insert(outbox).values({
    id: `outbox_duplicate_recovery_completion_${action.action_id}`,
    tenantId: ctx.tenantId,
    topic: 'complete-duplicate-recovery-prevention.v1',
    domainEventId: `duplicate-recovery-completion:${action.action_id}`,
    payload: { tenant_id: ctx.tenantId, action_id: action.action_id },
    status: 'pending',
  });
  return { subjectKey, primaryIngestEventId };
}

// --- internal helpers -------------------------------------------------

async function seedUnresolvedRecordShape(
  db: Database,
  ctx: TenantContext,
  prefix: 'unsafe',
  padded: string,
  captureTime: Date,
  ingestedAt: Date,
  captureAmountMinor: bigint,
): Promise<DatasetFlowResult> {
  const subjectKey = `dataset:${prefix}:${padded}`;
  await ingestSyntheticEvidence(db, ctx, {
    key: `${prefix}_${padded}_order_created`,
    subject: subjectKey,
    type: 'OrderCreated',
    source: 'SYNTHETIC_OMS',
    occurredAt: captureTime,
    ingestedAt,
    references: { order_id: `${prefix}_${padded}_order` },
  });
  const captureEventId = await ingestSyntheticEvidence(db, ctx, {
    key: `${prefix}_${padded}_capture`,
    subject: subjectKey,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: captureAmountMinor,
    references: { payment_id: `${prefix}_${padded}_payment` },
  });
  await ingestSyntheticEvidence(db, ctx, {
    key: `${prefix}_${padded}_receivable_open`,
    subject: subjectKey,
    type: 'SellerReceivableOpened',
    source: 'SYNTHETIC_ERP',
    occurredAt: captureTime,
    ingestedAt,
    amountMinor: sellerAllocationMinor(captureAmountMinor),
    references: {
      receivable_id: `${prefix}_${padded}_receivable`,
      recipient_account_id: `${prefix}_${padded}_recipient`,
    },
  });
  if (!captureEventId) throw new Error(`dataset ${prefix} record ${padded} capture not accepted`);
  return { subjectKey, primaryIngestEventId: captureEventId };
}

async function currentExpectationId(
  db: Database,
  ctx: TenantContext,
  subjectKey: string,
): Promise<string> {
  const subjectRows = await db
    .select({ id: economicSubjects.id })
    .from(economicSubjects)
    .where(
      and(eq(economicSubjects.tenantId, ctx.tenantId), eq(economicSubjects.subjectKey, subjectKey)),
    )
    .limit(1);
  if (!subjectRows[0]) throw new Error(`no economic subject for ${subjectKey}`);
  const rows = await db
    .select({ id: expectations.id })
    .from(expectations)
    .where(
      and(
        eq(expectations.tenantId, ctx.tenantId),
        eq(expectations.subjectId, subjectRows[0].id),
        eq(expectations.isCurrent, true),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error(`no current expectation for ${subjectKey}`);
  return rows[0].id;
}

async function currentCaseIdForControl(
  db: Database,
  ctx: TenantContext,
  subjectKey: string,
  controlId: string,
): Promise<string> {
  const subjectRows = await db
    .select({ id: economicSubjects.id })
    .from(economicSubjects)
    .where(
      and(eq(economicSubjects.tenantId, ctx.tenantId), eq(economicSubjects.subjectKey, subjectKey)),
    )
    .limit(1);
  if (!subjectRows[0]) throw new Error(`no economic subject for ${subjectKey}`);
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.tenantId, ctx.tenantId),
        eq(cases.subjectId, subjectRows[0].id),
        eq(cases.controlId, controlId),
        eq(cases.isActiveEpoch, true),
      ),
    )
    .orderBy(desc(cases.epoch))
    .limit(1);
  if (!rows[0]) throw new Error(`no active ${controlId} case for ${subjectKey}`);
  return rows[0].id;
}
