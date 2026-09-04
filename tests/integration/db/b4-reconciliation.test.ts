import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import { resetDemoDatabase } from '../../../src/modules/demo/reset.js';
import { runDemoScenarioStep } from '../../../src/modules/demo/scenario-runner.js';
import type { Database } from '../../../src/config/db.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import {
  CanonicalEvent,
  type CanonicalEvent as CanonicalEventValue,
} from '../../../src/contracts/events/canonical-event.js';
import type {
  CanonicalEventType,
  SourceSystem,
} from '../../../src/contracts/events/event-types.js';
import { canonicalJsonStringify, contentHash } from '../../../src/config/hashing.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';
import { evaluateAffectedControls } from '../../../src/modules/invariants/control-orchestrator.js';
import {
  reconcileExpectation,
  ReconciliationNotFoundError,
} from '../../../src/modules/reconciliation/reconciliation-service.js';
import { observeReceivableClosure } from '../../../src/modules/reconciliation/closure-service.js';
import { dispatchAction } from '../../../src/modules/actions/action-dispatch.js';
import { runInvestigation } from '../../../src/modules/investigation/investigation-service.js';

const TENANT_ID = 'ten_demo';
const CLOCK = new Date('2026-08-25T05:20:00.000Z');
const env = { MONEYTRACE_ENV: 'test' as const, MODEL_PROVIDER: 'stub' };

const SOURCE_ACCOUNTS: Readonly<Record<string, string>> = {
  SYNTHETIC_RAZORPAY_FIXTURE: 'acct_demo_razorpay_fixture',
  SYNTHETIC_ERP: 'acct_demo_erp',
  SYNTHETIC_BANK: 'acct_demo_bank',
  SYNTHETIC_ROUTE: 'acct_demo_route',
};

interface EvidenceInput {
  readonly key: string;
  readonly subject: string;
  readonly type: CanonicalEventType;
  readonly source: SourceSystem;
  readonly occurredAt: string;
  readonly amountMinor?: bigint;
  readonly references: Record<string, string>;
  readonly data?: Record<string, unknown>;
  readonly causationId?: string;
}

function buildEvent(input: EvidenceInput): CanonicalEventValue {
  return CanonicalEvent.parse({
    schema_version: '1.0',
    event_id: `recontest_${input.key}`,
    tenant_id: TENANT_ID,
    source_system: input.source,
    source_account_id: SOURCE_ACCOUNTS[input.source] ?? `acct_${input.source}`,
    source_event_id: `recontest_${input.key}`,
    source_event_type: input.type,
    event_type: input.type,
    event_time: input.occurredAt,
    ingested_at: CLOCK.toISOString(),
    source_entity_version: 1,
    entity_references: input.references,
    economic_subject_hint: input.subject,
    amount_minor: input.amountMinor?.toString() ?? null,
    currency: input.amountMinor === undefined ? null : 'INR',
    correlation_id: `recontest_${input.subject.replaceAll(':', '_')}`,
    causation_id: input.causationId ?? null,
    payload_hash: contentHash({ recontest_event: input.key }),
    raw_payload_ref: `db:recontest/${input.key}`,
    metadata: { environment: 'synthetic' },
    data: input.data ?? {},
  });
}

async function ingestEvidence(db: Database, input: EvidenceInput): Promise<string> {
  const ctx = createTenantContext(TENANT_ID, 'demo');
  const event = buildEvent(input);
  const outcome = await ingestAndProject(db, ctx, {
    event,
    rawBytes: canonicalJsonStringify(event),
    rawRepresentation: 'canonical_row',
    signatureStatus: 'verified',
    sourceIdentity: `${input.source}:${SOURCE_ACCOUNTS[input.source] ?? input.source}`,
  });
  if (outcome.outcome === 'accepted') {
    await evaluateAffectedControls(db, ctx, outcome.eventId, CLOCK);
  }
  return outcome.outcome === 'conflict' ? '' : outcome.eventId;
}

/** Seed a missing-transfer obligation that opens a CTRL-01 case + ₹4.55L expectation. */
async function seedObligation(db: Database, prefix: string, subject: string): Promise<void> {
  await ingestEvidence(db, {
    key: `${prefix}_order_paid`,
    subject,
    type: 'OrderPaid',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: '2026-08-25T00:00:00.000Z',
    amountMinor: 50_000_000n,
    references: { order_id: `${prefix}_order` },
  });
  await ingestEvidence(db, {
    key: `${prefix}_capture`,
    subject,
    type: 'PaymentCaptured',
    source: 'SYNTHETIC_RAZORPAY_FIXTURE',
    occurredAt: '2026-08-25T00:00:00.000Z',
    amountMinor: 50_000_000n,
    references: { order_id: `${prefix}_order`, payment_id: `${prefix}_payment` },
  });
  await ingestEvidence(db, {
    key: `${prefix}_receivable_open`,
    subject,
    type: 'SellerReceivableOpened',
    source: 'SYNTHETIC_ERP',
    occurredAt: '2026-08-25T00:01:00.000Z',
    amountMinor: 45_500_000n,
    references: {
      receivable_id: `${prefix}_receivable`,
      recipient_account_id: `${prefix}_recipient`,
    },
  });
  // A real investigation is a prerequisite for `rebuildDecisionBasis` to
  // produce a complete basis for ANY plan on this case (backend PRD §12.3),
  // including the auto-proposed CLOSE_RECEIVABLE_AFTER_RECONCILIATION plan
  // reconciliation creates once allocated — never skipped, matching the
  // real control-loop order the named scenarios also follow.
  const found = await findCaseForSubject(db, subject);
  await runInvestigation(db, createTenantContext(TENANT_ID, 'demo'), env, {
    caseId: found.id,
    actorId: 'user_investigator',
  });
}

async function findCaseForSubject(db: Database, subject: string) {
  const rows = await db
    .select({ id: schema.cases.id })
    .from(schema.cases)
    .innerJoin(schema.economicSubjects, eq(schema.economicSubjects.id, schema.cases.subjectId))
    .where(
      and(
        eq(schema.cases.tenantId, TENANT_ID),
        eq(schema.economicSubjects.subjectKey, subject),
        eq(schema.cases.controlId, 'CTRL-01'),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error(`no CTRL-01 case for ${subject}`);
  return rows[0];
}

async function expectationIdFor(db: Database, subject: string): Promise<string> {
  const subjectRows = await db
    .select({ id: schema.economicSubjects.id })
    .from(schema.economicSubjects)
    .where(
      and(
        eq(schema.economicSubjects.tenantId, TENANT_ID),
        eq(schema.economicSubjects.subjectKey, subject),
      ),
    )
    .limit(1);
  const subjectId = subjectRows[0]?.id;
  if (!subjectId) throw new Error(`no economic subject for ${subject}`);
  const rows = await db
    .select({ id: schema.expectations.id })
    .from(schema.expectations)
    .where(
      and(
        eq(schema.expectations.tenantId, TENANT_ID),
        eq(schema.expectations.subjectId, subjectId),
        eq(schema.expectations.isCurrent, true),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error(`no current expectation for ${subject}`);
  return rows[0].id;
}

describe('Gate B4 reconciliation adversarial coverage', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await resetDemoDatabase(pool, db, 'demo');
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  it('treats a recipient settlement without independent bank evidence as unresolved (settlement is not bank proof)', async () => {
    const subject = 'recon:settlement-only';
    await seedObligation(db, 'settlement_only', subject);
    // Only a recipient settlement — no BankCreditObserved. Settlement processing
    // is acknowledgement, never independent bank-credit proof (PRD invariant).
    await ingestEvidence(db, {
      key: 'settlement_only_settlement',
      subject,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: {
        settlement_id: 'settlement_only_s',
        recipient_account_id: 'settlement_only_recipient',
      },
      data: {
        settlement_scope: 'RECIPIENT',
        utr: 'UTRSETTLEMENTONLY455',
        value_date: '2026-08-25',
      },
    });
    const expectationId = await expectationIdFor(db, subject);
    const result = await reconcileExpectation(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      expectationId,
      CLOCK,
    );
    expect(result.reconciliation.status).toBe('UNRESOLVED');
    expect(result.reconciliation.allocation).toBeNull();
    expect(result.closeActionId).toBeNull();
    const allocations = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.expectationId, expectationId));
    expect(allocations).toHaveLength(0);
  });

  it('abstains as ambiguous when more than one authoritative candidate pair matches one expectation', async () => {
    const subject = 'recon:ambiguous';
    await seedObligation(db, 'ambiguous', subject);
    const recipient = 'ambiguous_recipient';
    const utr = 'UTRAMBIG455';
    // Two recipient settlements that both pair with the single bank credit yield
    // two candidate allocations for one expectation. A single bank credit is used
    // so the bank-conflict control (CTRL-05) is not triggered — this isolates the
    // reconciliation cardinality guard rather than conflicting-evidence detection.
    for (const variant of ['a', 'b'] as const) {
      await ingestEvidence(db, {
        key: `ambiguous_settlement_${variant}`,
        subject,
        type: 'SettlementObserved',
        source: 'SYNTHETIC_ROUTE',
        occurredAt: '2026-08-25T05:05:00.000Z',
        amountMinor: 45_500_000n,
        references: { settlement_id: `ambiguous_s_${variant}`, recipient_account_id: recipient },
        data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
      });
    }
    await ingestEvidence(db, {
      key: 'ambiguous_bank',
      subject,
      type: 'BankCreditObserved',
      source: 'SYNTHETIC_BANK',
      occurredAt: '2026-08-25T05:10:00.000Z',
      amountMinor: 45_500_000n,
      references: { bank_credit_id: 'ambiguous_bank', recipient_account_id: recipient },
      data: { utr, value_date: '2026-08-25' },
    });
    const expectationId = await expectationIdFor(db, subject);
    const result = await reconcileExpectation(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      expectationId,
      CLOCK,
    );
    expect(result.reconciliation.status).toBe('AMBIGUOUS');
    expect(result.reconciliation.allocation).toBeNull();
    const allocations = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.expectationId, expectationId));
    expect(allocations).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditEntries)
      .where(eq(schema.auditEntries.artifactType, 'RECONCILIATION'));
    const ambiguous = audits.filter(
      (row) => (row.details as { operation?: string }).operation === 'reconciliation_ambiguous',
    );
    expect(ambiguous.length).toBeGreaterThanOrEqual(1);
  });

  it('denies cross-tenant reconciliation opaquely', async () => {
    const subject = 'recon:settlement-only';
    const expectationId = await expectationIdFor(db, subject);
    await expect(
      reconcileExpectation(db, createTenantContext('ten_other', 'demo'), expectationId, CLOCK),
    ).rejects.toBeInstanceOf(ReconciliationNotFoundError);
  });

  it('does not close a receivable on adapter ACK alone — only after correlated ERP closure evidence', async () => {
    const subject = 'scenario:missing-transfer-remediation';
    const ctx = createTenantContext(TENANT_ID, 'demo');
    // Drive the known-good flow to a dispatchable CLOSE action (steps 1..5).
    for (let step = 1; step <= 5; step += 1) {
      await runDemoScenarioStep(
        db,
        createTenantContext(TENANT_ID, 'demo'),
        env,
        'missing-transfer-remediation',
        step,
      );
    }
    const recipient = 'missing_transfer_recipient';
    const utr = 'UTRMISSINGTRANSFER455';
    await ingestEvidence(db, {
      key: 'noack_transfer',
      subject,
      type: 'TransferProcessed',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:00:00.000Z',
      amountMinor: 45_500_000n,
      references: { transfer_id: 'noack_transfer', recipient_account_id: recipient },
    });
    await ingestEvidence(db, {
      key: 'noack_settlement',
      subject,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: { settlement_id: 'noack_settlement', recipient_account_id: recipient },
      data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
    });
    await ingestEvidence(db, {
      key: 'noack_bank',
      subject,
      type: 'BankCreditObserved',
      source: 'SYNTHETIC_BANK',
      occurredAt: '2026-08-25T05:10:00.000Z',
      amountMinor: 45_500_000n,
      references: { bank_credit_id: 'noack_bank', recipient_account_id: recipient },
      data: { utr, value_date: '2026-08-25' },
    });
    const expectationId = await expectationIdFor(db, subject);
    const reconciled = await reconcileExpectation(db, ctx, expectationId, CLOCK);
    expect(reconciled.reconciliation.status).toBe('ALLOCATED');
    expect(reconciled.closeActionId).not.toBeNull();
    // Dispatch the CLOSE action: the synthetic ERP adapter only ACKs; ACK is a
    // request, never observed closure.
    await dispatchAction(db, ctx, reconciled.closeActionId!);

    const closuresBefore = await db
      .select()
      .from(schema.receivableClosures)
      .where(eq(schema.receivableClosures.expectationId, expectationId));
    expect(closuresBefore).toHaveLength(0);
    const headsBefore = await db
      .select()
      .from(schema.verificationRunHeads)
      .where(eq(schema.verificationRunHeads.actionId, reconciled.closeActionId!));
    expect(headsBefore[0]?.status).toBe('VERIFICATION_PENDING');
    const caseBefore = await db
      .select({ state: schema.cases.lifecycleState })
      .from(schema.cases)
      .where(eq(schema.cases.expectationId, expectationId))
      .limit(1);
    expect(caseBefore[0]?.state).not.toBe('reconciled');

    // Now the correlated signed ERP closure evidence arrives.
    const closureEvidenceId = await ingestEvidence(db, {
      key: 'noack_receivable_close',
      subject,
      type: 'SellerReceivableClosed',
      source: 'SYNTHETIC_ERP',
      occurredAt: '2026-08-25T05:15:00.000Z',
      amountMinor: 0n,
      references: { receivable_id: 'missing_transfer_receivable', recipient_account_id: recipient },
      causationId: reconciled.closeActionId!,
    });
    await observeReceivableClosure(db, ctx, closureEvidenceId, CLOCK);

    const closuresAfter = await db
      .select()
      .from(schema.receivableClosures)
      .where(eq(schema.receivableClosures.expectationId, expectationId));
    expect(closuresAfter).toHaveLength(1);
    const headsAfter = await db
      .select()
      .from(schema.verificationRunHeads)
      .where(eq(schema.verificationRunHeads.actionId, reconciled.closeActionId!));
    expect(headsAfter[0]?.status).toBe('EFFECT_VERIFIED');

    // A retry after the receivable is already observed-closed must report
    // that persisted fact — never silently re-report "not yet closed".
    const retried = await reconcileExpectation(db, ctx, expectationId, CLOCK);
    expect(retried.reconciliation.status).toBe('ALLOCATED');
    expect(retried.reconciliation.closed_receivable_id).toBe(closuresAfter[0]!.id);
  });

  it('one bank line contested by TWO DIFFERENT expectations abstains for both — never an arbitrary winner', async () => {
    const subjectA = 'recon:contested-a';
    const subjectB = 'recon:contested-b';
    await seedObligation(db, 'contested_a', subjectA);
    await seedObligation(db, 'contested_b', subjectB);
    const recipient = 'contested_recipient';
    const utr = 'UTRCONTESTED455';
    // ONE physical bank credit — hinted (at ingestion) to subject A, but its
    // recipient/utr/date/amount also exactly match subject B's independent
    // settlement. The hint is only an ingestion-time guess, never ground
    // truth (see `tenantWideCandidates`), so this must be caught tenant-wide.
    await ingestEvidence(db, {
      key: 'contested_bank',
      subject: subjectA,
      type: 'BankCreditObserved',
      source: 'SYNTHETIC_BANK',
      occurredAt: '2026-08-25T05:10:00.000Z',
      amountMinor: 45_500_000n,
      references: { bank_credit_id: 'contested_bank', recipient_account_id: recipient },
      data: { utr, value_date: '2026-08-25' },
    });
    await ingestEvidence(db, {
      key: 'contested_settlement_a',
      subject: subjectA,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: { settlement_id: 'contested_settlement_a', recipient_account_id: recipient },
      data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
    });
    await ingestEvidence(db, {
      key: 'contested_settlement_b',
      subject: subjectB,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: { settlement_id: 'contested_settlement_b', recipient_account_id: recipient },
      data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
    });
    const ctx = createTenantContext(TENANT_ID, 'demo');
    const expectationA = await expectationIdFor(db, subjectA);
    const expectationB = await expectationIdFor(db, subjectB);

    const resultA = await reconcileExpectation(db, ctx, expectationA, CLOCK);
    expect(resultA.reconciliation.status).toBe('AMBIGUOUS');
    expect(resultA.reconciliation.allocation).toBeNull();
    const resultB = await reconcileExpectation(db, ctx, expectationB, CLOCK);
    expect(resultB.reconciliation.status).toBe('AMBIGUOUS');
    expect(resultB.reconciliation.allocation).toBeNull();

    // No allocation exists for either expectation — the contested bank line
    // was never auto-assigned to either side.
    const anyAllocation = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(
        and(
          eq(schema.reconciliationAllocations.tenantId, TENANT_ID),
          eq(schema.reconciliationAllocations.expectationId, expectationA),
        ),
      );
    const anyAllocationB = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(
        and(
          eq(schema.reconciliationAllocations.tenantId, TENANT_ID),
          eq(schema.reconciliationAllocations.expectationId, expectationB),
        ),
      );
    expect(anyAllocation).toHaveLength(0);
    expect(anyAllocationB).toHaveLength(0);

    const audits = await db
      .select()
      .from(schema.auditEntries)
      .where(eq(schema.auditEntries.artifactType, 'RECONCILIATION'));
    const contestedAudits = audits.filter(
      (row) =>
        (row.details as { operation?: string; reason?: string }).operation ===
          'reconciliation_ambiguous' &&
        (row.details as { reason?: string }).reason === 'contested_bank_line',
    );
    expect(contestedAudits.length).toBeGreaterThanOrEqual(2);
  });

  it('one expectation matching TWO independent bank credits is ambiguous, never an arbitrary pick', async () => {
    const subject = 'recon:two-banks';
    await seedObligation(db, 'two_banks', subject);
    const recipient = 'two_banks_recipient';
    const utr = 'UTRTWOBANKS455';
    await ingestEvidence(db, {
      key: 'two_banks_settlement',
      subject,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: { settlement_id: 'two_banks_settlement', recipient_account_id: recipient },
      data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
    });
    // Two independent BankCreditObserved rows both exactly match the single
    // settlement (a duplicated/erroneous bank feed) — neither is
    // authoritative over the other.
    for (const variant of ['x', 'y'] as const) {
      await ingestEvidence(db, {
        key: `two_banks_bank_${variant}`,
        subject,
        type: 'BankCreditObserved',
        source: 'SYNTHETIC_BANK',
        occurredAt: '2026-08-25T05:10:00.000Z',
        amountMinor: 45_500_000n,
        references: {
          bank_credit_id: `two_banks_bank_${variant}`,
          recipient_account_id: recipient,
        },
        data: { utr, value_date: '2026-08-25' },
      });
    }
    const expectationId = await expectationIdFor(db, subject);
    const result = await reconcileExpectation(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      expectationId,
      CLOCK,
    );
    expect(result.reconciliation.status).toBe('AMBIGUOUS');
    expect(result.reconciliation.allocation).toBeNull();
    const allocations = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.expectationId, expectationId));
    expect(allocations).toHaveLength(0);
  });

  it('two genuinely independent expectations reconciled in PARALLEL both allocate correctly (tenant-wide lock serializes without cross-contamination)', async () => {
    const subjectA = 'recon:parallel-a';
    const subjectB = 'recon:parallel-b';
    await seedObligation(db, 'parallel_a', subjectA);
    await seedObligation(db, 'parallel_b', subjectB);
    for (const [prefix, subject] of [
      ['parallel_a', subjectA],
      ['parallel_b', subjectB],
    ] as const) {
      const recipient = `${prefix}_recipient`;
      const utr = `UTR${prefix.toUpperCase().replaceAll('_', '')}455`;
      await ingestEvidence(db, {
        key: `${prefix}_settlement`,
        subject,
        type: 'SettlementObserved',
        source: 'SYNTHETIC_ROUTE',
        occurredAt: '2026-08-25T05:05:00.000Z',
        amountMinor: 45_500_000n,
        references: { settlement_id: `${prefix}_settlement`, recipient_account_id: recipient },
        data: { settlement_scope: 'RECIPIENT', utr, value_date: '2026-08-25' },
      });
      await ingestEvidence(db, {
        key: `${prefix}_bank`,
        subject,
        type: 'BankCreditObserved',
        source: 'SYNTHETIC_BANK',
        occurredAt: '2026-08-25T05:10:00.000Z',
        amountMinor: 45_500_000n,
        references: { bank_credit_id: `${prefix}_bank`, recipient_account_id: recipient },
        data: { utr, value_date: '2026-08-25' },
      });
    }
    const ctx = createTenantContext(TENANT_ID, 'demo');
    const expectationA = await expectationIdFor(db, subjectA);
    const expectationB = await expectationIdFor(db, subjectB);

    const [resultA, resultB] = await Promise.all([
      reconcileExpectation(db, ctx, expectationA, CLOCK),
      reconcileExpectation(db, ctx, expectationB, CLOCK),
    ]);
    expect(resultA.reconciliation.status).toBe('ALLOCATED');
    expect(resultB.reconciliation.status).toBe('ALLOCATED');
    expect(resultA.reconciliation.allocation?.bank_line_evidence_id).not.toBe(
      resultB.reconciliation.allocation?.bank_line_evidence_id,
    );
    const allocationsA = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.expectationId, expectationA));
    const allocationsB = await db
      .select()
      .from(schema.reconciliationAllocations)
      .where(eq(schema.reconciliationAllocations.expectationId, expectationB));
    expect(allocationsA).toHaveLength(1);
    expect(allocationsB).toHaveLength(1);
    expect(allocationsA[0]!.expectationId).toBe(expectationA);
    expect(allocationsB[0]!.expectationId).toBe(expectationB);
  });

  it('value-date tolerance: exactly 2 days apart matches, 3 days apart does not (UNRESOLVED)', async () => {
    const withinSubject = 'recon:value-date-within';
    const beyondSubject = 'recon:value-date-beyond';
    await seedObligation(db, 'value_date_within', withinSubject);
    await seedObligation(db, 'value_date_beyond', beyondSubject);

    await ingestEvidence(db, {
      key: 'value_date_within_settlement',
      subject: withinSubject,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: {
        settlement_id: 'value_date_within_settlement',
        recipient_account_id: 'value_date_within_recipient',
      },
      data: { settlement_scope: 'RECIPIENT', utr: 'UTRWITHIN455', value_date: '2026-08-25' },
    });
    await ingestEvidence(db, {
      key: 'value_date_within_bank',
      subject: withinSubject,
      type: 'BankCreditObserved',
      source: 'SYNTHETIC_BANK',
      occurredAt: '2026-08-27T05:10:00.000Z',
      amountMinor: 45_500_000n,
      references: {
        bank_credit_id: 'value_date_within_bank',
        recipient_account_id: 'value_date_within_recipient',
      },
      // Exactly 2 days after the settlement's value_date — at the boundary,
      // inclusive (`<=`), so this must still match.
      data: { utr: 'UTRWITHIN455', value_date: '2026-08-27' },
    });

    await ingestEvidence(db, {
      key: 'value_date_beyond_settlement',
      subject: beyondSubject,
      type: 'SettlementObserved',
      source: 'SYNTHETIC_ROUTE',
      occurredAt: '2026-08-25T05:05:00.000Z',
      amountMinor: 45_500_000n,
      references: {
        settlement_id: 'value_date_beyond_settlement',
        recipient_account_id: 'value_date_beyond_recipient',
      },
      data: { settlement_scope: 'RECIPIENT', utr: 'UTRBEYOND455', value_date: '2026-08-25' },
    });
    await ingestEvidence(db, {
      key: 'value_date_beyond_bank',
      subject: beyondSubject,
      type: 'BankCreditObserved',
      source: 'SYNTHETIC_BANK',
      occurredAt: '2026-08-28T05:10:00.000Z',
      amountMinor: 45_500_000n,
      references: {
        bank_credit_id: 'value_date_beyond_bank',
        recipient_account_id: 'value_date_beyond_recipient',
      },
      // 3 days after the settlement's value_date — outside the 2-day
      // tolerance window, so this must NOT be treated as a match.
      data: { utr: 'UTRBEYOND455', value_date: '2026-08-28' },
    });

    const ctx = createTenantContext(TENANT_ID, 'demo');
    const withinExpectation = await expectationIdFor(db, withinSubject);
    const beyondExpectation = await expectationIdFor(db, beyondSubject);

    const withinResult = await reconcileExpectation(db, ctx, withinExpectation, CLOCK);
    expect(withinResult.reconciliation.status).toBe('ALLOCATED');
    expect(withinResult.reconciliation.allocation?.bank_line_evidence_id).toBeTruthy();

    const beyondResult = await reconcileExpectation(db, ctx, beyondExpectation, CLOCK);
    expect(beyondResult.reconciliation.status).toBe('UNRESOLVED');
    expect(beyondResult.reconciliation.allocation).toBeNull();
  });
});
