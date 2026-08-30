import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { economicSubjects, expectations, ingestEvents } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { ensureSellerAllocationExpectation } from '../expectations/expectation-service.js';
import { evaluateCtrl01MissingTransfer } from './ctrl-01-missing-transfer.js';
import { evaluateCtrl02SettlementTimeout } from './ctrl-02-settlement-timeout.js';
import { evaluateCtrl03OpenReceivable } from './ctrl-03-open-receivable.js';
import { evaluateCtrl04DuplicateRecovery } from './ctrl-04-duplicate-recovery.js';
import { evaluateCtrl05ConflictingBankEvidence } from './ctrl-05-conflicting-bank-evidence.js';
import { evaluateCtrl06DuplicateSafety } from './ctrl-06-duplicate-safety.js';
import { references } from './control-support.js';

const TRANSFER_GRACE_SECONDS = 3_600;
const SETTLEMENT_SLA_SECONDS = 86_400;
const RECEIVABLE_GRACE_SECONDS = 3_600;

export interface ControlRunResult {
  readonly evaluated: readonly string[];
  readonly nextCheckAt: Date | null;
}

export async function evaluateAffectedControls(
  db: Database,
  ctx: TenantContext,
  ingestEventId: string,
  evaluatedAt?: Date,
): Promise<ControlRunResult> {
  const eventRows = await db
    .select()
    .from(ingestEvents)
    .where(and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, ingestEventId)))
    .limit(1);
  const event = eventRows[0];
  if (!event?.eventType || !event.economicSubjectHint) return { evaluated: [], nextCheckAt: null };
  const now = evaluatedAt ?? event.ingestedAt;
  let subjectId: string;
  let expectationId: string;
  let expectationVersion: number;
  let expectedAmountMinor: bigint;

  if (event.eventType === 'PaymentCaptured' && event.amountMinor != null) {
    const created = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: event.economicSubjectHint,
      orderCaptureAmountMinor: event.amountMinor,
      inputEvidenceIds: [event.id],
    });
    subjectId = created.subjectId;
    expectationId = created.expectationId;
    expectationVersion = created.expectationVersion;
    expectedAmountMinor = created.sellerAllocationMinor;
  } else {
    const current = await db
      .select({ subject: economicSubjects, expectation: expectations })
      .from(economicSubjects)
      .innerJoin(
        expectations,
        and(
          eq(expectations.tenantId, economicSubjects.tenantId),
          eq(expectations.subjectId, economicSubjects.id),
          eq(expectations.isCurrent, true),
        ),
      )
      .where(
        and(
          eq(economicSubjects.tenantId, ctx.tenantId),
          eq(economicSubjects.subjectKey, event.economicSubjectHint),
        ),
      )
      .limit(1);
    if (!current[0]) return { evaluated: [], nextCheckAt: null };
    subjectId = current[0].subject.id;
    expectationId = current[0].expectation.id;
    expectationVersion = current[0].expectation.version;
    expectedAmountMinor = current[0].expectation.expectedAmountMinor;
  }

  const common = {
    subjectId,
    subjectKey: event.economicSubjectHint,
    expectationId,
    expectationVersion,
  };
  const evaluated: string[] = [];
  let nextCheckAt: Date | null = null;

  if (event.eventType === 'PaymentCaptured') {
    await evaluateCtrl01MissingTransfer(db, ctx, {
      ...common,
      sellerAllocationMinor: expectedAmountMinor,
      captureEventTime: event.eventTime,
      graceSeconds: TRANSFER_GRACE_SECONDS,
      now,
    });
    evaluated.push('CTRL-01');
    const due = new Date(event.eventTime.getTime() + TRANSFER_GRACE_SECONDS * 1000);
    if (now < due) nextCheckAt = due;
  }

  if (event.eventType === 'TransferProcessed') {
    const recipient = String(
      references(event.entityReferences).recipient_account_id ?? 'unresolved',
    );
    await evaluateCtrl02SettlementTimeout(db, ctx, {
      ...common,
      expectedAmountMinor,
      recipientAccountId: recipient,
      transferProcessedTime: event.eventTime,
      slaSeconds: SETTLEMENT_SLA_SECONDS,
      now,
    });
    evaluated.push('CTRL-02');
    const due = new Date(event.eventTime.getTime() + SETTLEMENT_SLA_SECONDS * 1000);
    if (now < due) nextCheckAt = due;
  }

  if (event.eventType === 'SyntheticTransferFailed') {
    // An authoritative reversal discovered after processing must re-trigger
    // CTRL-01/CTRL-02 for the SAME subject/window the original
    // PaymentCaptured/TransferProcessed evidence used (backend PRD "known
    // semantic risks" §1) — otherwise the now-stale "transfer exists"/
    // "transfer settled" evaluations are never re-checked until some
    // unrelated event happens to nudge the subject again.
    const related = await db
      .select()
      .from(ingestEvents)
      .where(
        and(
          eq(ingestEvents.tenantId, ctx.tenantId),
          eq(ingestEvents.economicSubjectHint, event.economicSubjectHint),
        ),
      );
    const captured = related.find((row) => row.eventType === 'PaymentCaptured');
    if (captured) {
      await evaluateCtrl01MissingTransfer(db, ctx, {
        ...common,
        sellerAllocationMinor: expectedAmountMinor,
        captureEventTime: captured.eventTime,
        graceSeconds: TRANSFER_GRACE_SECONDS,
        now,
      });
      evaluated.push('CTRL-01');
      const due = new Date(captured.eventTime.getTime() + TRANSFER_GRACE_SECONDS * 1000);
      if (now < due) nextCheckAt = due;
    }
    const transferProcessed = related.find((row) => row.eventType === 'TransferProcessed');
    if (transferProcessed) {
      const recipient = String(
        references(transferProcessed.entityReferences).recipient_account_id ?? 'unresolved',
      );
      await evaluateCtrl02SettlementTimeout(db, ctx, {
        ...common,
        expectedAmountMinor,
        recipientAccountId: recipient,
        transferProcessedTime: transferProcessed.eventTime,
        slaSeconds: SETTLEMENT_SLA_SECONDS,
        now,
      });
      evaluated.push('CTRL-02');
      const due = new Date(transferProcessed.eventTime.getTime() + SETTLEMENT_SLA_SECONDS * 1000);
      if (now < due && (!nextCheckAt || due < nextCheckAt)) nextCheckAt = due;
    }
  }

  if (event.eventType === 'BankCreditObserved' || event.eventType.startsWith('SellerReceivable')) {
    const related = await db
      .select()
      .from(ingestEvents)
      .where(
        and(
          eq(ingestEvents.tenantId, ctx.tenantId),
          eq(ingestEvents.economicSubjectHint, event.economicSubjectHint),
        ),
      );
    const bank = related.find((row) => row.eventType === 'BankCreditObserved');
    const receivable = related.find((row) => row.eventType === 'SellerReceivableOpened');
    if (bank && receivable) {
      await evaluateCtrl03OpenReceivable(db, ctx, {
        ...common,
        expectedAmountMinor,
        receivableId: String(references(receivable.entityReferences).receivable_id ?? 'unresolved'),
        settlementVerifiedTime: bank.eventTime,
        graceSeconds: RECEIVABLE_GRACE_SECONDS,
        now,
      });
      evaluated.push('CTRL-03');
      const due = new Date(bank.eventTime.getTime() + RECEIVABLE_GRACE_SECONDS * 1000);
      if (now < due) nextCheckAt = due;
    }
    await evaluateCtrl05ConflictingBankEvidence(db, ctx, {
      ...common,
      expectedAmountMinor,
      evaluatedAt: now,
    });
    evaluated.push('CTRL-05');
  }

  if (event.eventType === 'RecoveryScheduled' || event.eventType === 'RecoverySuppressed') {
    // A `RecoverySuppressed` reversal must re-trigger CTRL-04 for the SAME
    // subject so a now-cleared violation is re-checked, and a LATER
    // authoritative RecoveryScheduled reschedule must be detectable again —
    // both read the anchor amount from the subject's PaymentCaptured event
    // (the "commercial intent amount" CTRL-04 protects), not from whichever
    // recovery-lifecycle event happened to trigger this run.
    const related = await db
      .select()
      .from(ingestEvents)
      .where(
        and(
          eq(ingestEvents.tenantId, ctx.tenantId),
          eq(ingestEvents.economicSubjectHint, event.economicSubjectHint),
        ),
      );
    const captured = related.find(
      (row) => row.eventType === 'PaymentCaptured' && row.amountMinor != null,
    );
    if (captured?.amountMinor != null) {
      await evaluateCtrl04DuplicateRecovery(db, ctx, {
        ...common,
        scheduledRecoveryAmountMinor: captured.amountMinor,
        evaluatedAt: now,
      });
      evaluated.push('CTRL-04');
    }
  }

  return { evaluated, nextCheckAt };
}

export async function evaluateConflictControl(
  db: Database,
  ctx: TenantContext,
  existingIngestEventId: string,
  evaluatedAt: Date,
) {
  const event = await db
    .select()
    .from(ingestEvents)
    .where(and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.id, existingIngestEventId)))
    .limit(1);
  const found = event[0];
  if (!found?.economicSubjectHint) return null;
  const current = await db
    .select({ subject: economicSubjects, expectation: expectations })
    .from(economicSubjects)
    .innerJoin(
      expectations,
      and(
        eq(expectations.tenantId, economicSubjects.tenantId),
        eq(expectations.subjectId, economicSubjects.id),
        eq(expectations.isCurrent, true),
      ),
    )
    .where(
      and(
        eq(economicSubjects.tenantId, ctx.tenantId),
        eq(economicSubjects.subjectKey, found.economicSubjectHint),
      ),
    )
    .limit(1);
  if (!current[0]) return null;
  return evaluateCtrl06DuplicateSafety(db, ctx, {
    subjectId: current[0].subject.id,
    expectationId: current[0].expectation.id,
    expectationVersion: current[0].expectation.version,
    existingIngestEventId,
    exposureAmountMinor: current[0].expectation.expectedAmountMinor,
    evaluatedAt,
  });
}
