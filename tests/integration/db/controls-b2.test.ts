import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import {
  expectationInputs,
  expectations,
  invariantEvaluations,
} from '../../../src/config/db-schema.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { acceptEvidence } from '../../../src/modules/ingestion/ingestion-service.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';
import { ensureSellerAllocationExpectation } from '../../../src/modules/expectations/expectation-service.js';
import { evaluateCtrl02SettlementTimeout } from '../../../src/modules/invariants/ctrl-02-settlement-timeout.js';
import { evaluateCtrl03OpenReceivable } from '../../../src/modules/invariants/ctrl-03-open-receivable.js';
import { evaluateCtrl04DuplicateRecovery } from '../../../src/modules/invariants/ctrl-04-duplicate-recovery.js';
import { evaluateCtrl05ConflictingBankEvidence } from '../../../src/modules/invariants/ctrl-05-conflicting-bank-evidence.js';
import { evaluateCtrl06DuplicateSafety } from '../../../src/modules/invariants/ctrl-06-duplicate-safety.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';

function canonical(
  id: string,
  eventType: string,
  subjectKey: string,
  amountMinor: bigint,
  refs: Record<string, string>,
  data: Record<string, unknown> = {},
): CanonicalEvent {
  return {
    event_id: `canonical_${id}`,
    tenant_id: 'ten_demo',
    source_system: eventType === 'BankCreditObserved' ? 'SYNTHETIC_BANK' : 'SYNTHETIC_ROUTE',
    source_account_id: null,
    source_event_id: `source_${id}`,
    source_event_type: eventType,
    event_type: eventType,
    schema_version: '1.0',
    event_time: '2026-08-25T05:20:00Z',
    ingested_at: '2026-08-25T05:20:01Z',
    source_entity_version: 1,
    entity_references: refs,
    economic_subject_hint: subjectKey,
    amount_minor: amountMinor.toString(),
    currency: 'INR',
    correlation_id: id,
    causation_id: null,
    payload_hash: `sha256:${'0'.repeat(64)}`,
    raw_payload_ref: `db:ingest_events/${id}`,
    metadata: { environment: 'synthetic' },
    data,
  } as CanonicalEvent;
}

describe('all deterministic B2 controls', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ctx = createTenantContext('ten_demo', 'demo');

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await seedIdentity(db);
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  async function expectation(subjectKey: string) {
    return ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50_000_000n,
    });
  }

  async function journal(event: CanonicalEvent) {
    const raw = JSON.stringify(event);
    const result = await acceptEvidence(db, ctx, {
      event,
      rawBytes: raw,
      signatureStatus: 'verified',
    });
    if (result.outcome !== 'accepted') throw new Error('fixture evidence was not accepted');
    return result.eventId;
  }

  // CTRL-02/CTRL-03 consult the latest authoritative projected state
  // (`entity_current`) for transfer/receivable evidence, not the raw
  // ingestion journal, so their fixtures must run projection.
  async function journalAndProject(event: CanonicalEvent) {
    const raw = JSON.stringify(event);
    const result = await ingestAndProject(db, ctx, {
      event,
      rawBytes: raw,
      signatureStatus: 'verified',
    });
    if (result.outcome !== 'accepted') throw new Error('fixture evidence was not accepted');
    return result.eventId;
  }

  it('versions an expectation when its authoritative input set changes', async () => {
    const subjectKey = 'order:expectation-version:seller-1';
    const firstEvidence = await journal(
      canonical('expectation_input_a', 'PaymentCaptured', subjectKey, 50_000_000n, {
        payment_id: 'payment_expectation_a',
      }),
    );
    const first = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50_000_000n,
      inputEvidenceIds: [firstEvidence],
    });
    const same = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50_000_000n,
      inputEvidenceIds: [firstEvidence],
    });
    expect(same.expectationId).toBe(first.expectationId);
    const secondEvidence = await journal(
      canonical('expectation_input_b', 'PaymentCaptured', subjectKey, 50_000_000n, {
        payment_id: 'payment_expectation_b',
      }),
    );
    const changed = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50_000_000n,
      inputEvidenceIds: [firstEvidence, secondEvidence],
    });
    expect(changed.expectationVersion).toBe(2);
    expect(changed.expectationId).not.toBe(first.expectationId);
    expect(changed.sellerAllocationMinor).toBe(45_500_000n);
    expect(changed.platformAllocationMinor).toBe(4_500_000n);
    const history = await db
      .select()
      .from(expectations)
      .where(eq(expectations.subjectId, first.subjectId));
    expect(history).toHaveLength(2);
    expect(history.filter((row) => row.isCurrent)).toHaveLength(1);
    const inputs = await db
      .select()
      .from(expectationInputs)
      .where(eq(expectationInputs.expectationId, changed.expectationId));
    expect(inputs.map((row) => row.evidenceId).sort()).toEqual(
      [firstEvidence, secondEvidence].sort(),
    );
  });

  it('CTRL-02 requires matching amount, currency and recipient bank evidence', async () => {
    const subjectKey = 'order:ctrl02:seller-1';
    const exp = await expectation(subjectKey);
    await journalAndProject(
      canonical('ctrl02_transfer', 'TransferProcessed', subjectKey, exp.sellerAllocationMinor, {
        transfer_id: 'transfer_ctrl02',
        recipient_account_id: 'recipient_ctrl02',
      }),
    );
    const input = {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      expectedAmountMinor: exp.sellerAllocationMinor,
      recipientAccountId: 'recipient_ctrl02',
      transferProcessedTime: new Date('2026-08-25T05:20:00Z'),
      slaSeconds: 3600,
      now: new Date('2026-08-25T07:20:00Z'),
    };
    expect((await evaluateCtrl02SettlementTimeout(db, ctx, input)).violated).toBe(true);
    await journal(
      canonical('ctrl02_wrong_bank', 'BankCreditObserved', subjectKey, 1n, {
        bank_credit_id: 'bank_ctrl02_wrong',
        recipient_account_id: 'recipient_ctrl02',
      }),
    );
    expect((await evaluateCtrl02SettlementTimeout(db, ctx, input)).violated).toBe(true);
    await journal(
      canonical('ctrl02_bank', 'BankCreditObserved', subjectKey, exp.sellerAllocationMinor, {
        bank_credit_id: 'bank_ctrl02',
        recipient_account_id: 'recipient_ctrl02',
      }),
    );
    expect((await evaluateCtrl02SettlementTimeout(db, ctx, input)).violated).toBe(false);
  });

  it('CTRL-02 stops violating once a SyntheticTransferFailed reverses the processed transfer', async () => {
    const subjectKey = 'order:ctrl02-reversal:seller-1';
    const exp = await expectation(subjectKey);
    await journalAndProject(
      canonical('ctrl02r_transfer', 'TransferProcessed', subjectKey, exp.sellerAllocationMinor, {
        transfer_id: 'transfer_ctrl02r',
        recipient_account_id: 'recipient_ctrl02r',
      }),
    );
    const input = {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      expectedAmountMinor: exp.sellerAllocationMinor,
      recipientAccountId: 'recipient_ctrl02r',
      transferProcessedTime: new Date('2026-08-25T05:20:00Z'),
      slaSeconds: 3600,
      now: new Date('2026-08-25T07:20:00Z'),
    };
    expect((await evaluateCtrl02SettlementTimeout(db, ctx, input)).violated).toBe(true);
    await journalAndProject(
      canonical(
        'ctrl02r_failed',
        'SyntheticTransferFailed',
        subjectKey,
        exp.sellerAllocationMinor,
        {
          transfer_id: 'transfer_ctrl02r',
          recipient_account_id: 'recipient_ctrl02r',
        },
      ),
    );
    expect((await evaluateCtrl02SettlementTimeout(db, ctx, input)).violated).toBe(false);
  });

  it('CTRL-03 is clean only after the matching receivable closes', async () => {
    const subjectKey = 'order:ctrl03:seller-1';
    const exp = await expectation(subjectKey);
    await journal(
      canonical('ctrl03_bank', 'BankCreditObserved', subjectKey, exp.sellerAllocationMinor, {
        bank_credit_id: 'bank_ctrl03',
      }),
    );
    await journalAndProject({
      ...canonical('ctrl03_open', 'SellerReceivableOpened', subjectKey, exp.sellerAllocationMinor, {
        receivable_id: 'receivable_ctrl03',
      }),
      event_time: '2026-08-25T05:20:00Z',
    });
    const input = {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      expectedAmountMinor: exp.sellerAllocationMinor,
      receivableId: 'receivable_ctrl03',
      settlementVerifiedTime: new Date('2026-08-25T05:20:00Z'),
      graceSeconds: 3600,
      now: new Date('2026-08-25T07:20:00Z'),
    };
    expect((await evaluateCtrl03OpenReceivable(db, ctx, input)).violated).toBe(true);
    await journalAndProject({
      ...canonical(
        'ctrl03_close',
        'SellerReceivableClosed',
        subjectKey,
        exp.sellerAllocationMinor,
        {
          receivable_id: 'receivable_ctrl03',
        },
      ),
      event_time: '2026-08-25T06:00:00Z',
    });
    expect((await evaluateCtrl03OpenReceivable(db, ctx, input)).violated).toBe(false);

    // A later authoritative reopening of the SAME receivable must cause the
    // control to re-violate, even though an older close event exists. This
    // relies on `receivable` being ordered by event_time (not the static
    // state-precedence table, which cannot express a cyclic open/close/open
    // lifecycle) — see `isCyclicEntityType` in entity-mapping.ts.
    await journalAndProject({
      ...canonical(
        'ctrl03_reopen',
        'SellerReceivableOpened',
        subjectKey,
        exp.sellerAllocationMinor,
        {
          receivable_id: 'receivable_ctrl03',
        },
      ),
      event_time: '2026-08-25T06:30:00Z',
    });
    expect((await evaluateCtrl03OpenReceivable(db, ctx, input)).violated).toBe(true);
  });

  it('CTRL-04 flags only an amount-matched capture plus scheduled recovery', async () => {
    const subjectKey = 'order:ctrl04:seller-1';
    const exp = await expectation(subjectKey);
    await journal(
      canonical('ctrl04_capture', 'PaymentCaptured', subjectKey, 12_000_000n, {
        payment_id: 'payment_ctrl04',
      }),
    );
    await journalAndProject(
      canonical('ctrl04_recovery_wrong', 'RecoveryScheduled', subjectKey, 1n, {
        recovery_id: 'recovery_ctrl04_wrong',
      }),
    );
    const clean = await evaluateCtrl04DuplicateRecovery(db, ctx, {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      scheduledRecoveryAmountMinor: 12_000_000n,
      evaluatedAt: new Date('2026-08-25T10:00:00Z'),
    });
    expect(clean.violated).toBe(false);
    await journalAndProject(
      canonical('ctrl04_recovery', 'RecoveryScheduled', subjectKey, 12_000_000n, {
        recovery_id: 'recovery_ctrl04',
      }),
    );
    const violated = await evaluateCtrl04DuplicateRecovery(db, ctx, {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      scheduledRecoveryAmountMinor: 12_000_000n,
      evaluatedAt: new Date('2026-08-25T10:00:00Z'),
    });
    expect(violated).toMatchObject({ violated: true, preventedAmountMinor: 12_000_000n });

    // A later authoritative RecoverySuppressed must clear the violation...
    await journalAndProject({
      ...canonical('ctrl04_suppressed', 'RecoverySuppressed', subjectKey, 12_000_000n, {
        recovery_id: 'recovery_ctrl04',
      }),
      event_time: '2026-08-25T09:00:00Z',
    });
    const clearedAfterSuppression = await evaluateCtrl04DuplicateRecovery(db, ctx, {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      scheduledRecoveryAmountMinor: 12_000_000n,
      evaluatedAt: new Date('2026-08-25T11:00:00Z'),
    });
    expect(clearedAfterSuppression.violated).toBe(false);

    // ...and a LATER authoritative reschedule must be detectable again, even
    // though an older suppression event exists for the same recovery.
    await journalAndProject({
      ...canonical('ctrl04_rescheduled', 'RecoveryScheduled', subjectKey, 12_000_000n, {
        recovery_id: 'recovery_ctrl04',
      }),
      event_time: '2026-08-25T09:30:00Z',
    });
    const violatedAfterReschedule = await evaluateCtrl04DuplicateRecovery(db, ctx, {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      scheduledRecoveryAmountMinor: 12_000_000n,
      evaluatedAt: new Date('2026-08-25T12:00:00Z'),
    });
    expect(violatedAfterReschedule.violated).toBe(true);
  });

  it('CTRL-05 preserves and flags conflicting UTR evidence', async () => {
    const subjectKey = 'order:ctrl05:seller-1';
    const exp = await expectation(subjectKey);
    await journal(
      canonical(
        'ctrl05_a',
        'BankCreditObserved',
        subjectKey,
        exp.sellerAllocationMinor,
        { bank_credit_id: 'bank_ctrl05_a', recipient_account_id: 'recipient_a' },
        { utr: 'TEST_ONLY_UTR_A' },
      ),
    );
    const input = {
      subjectId: exp.subjectId,
      subjectKey,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      expectedAmountMinor: exp.sellerAllocationMinor,
      evaluatedAt: new Date('2026-08-25T10:00:00Z'),
    };
    expect((await evaluateCtrl05ConflictingBankEvidence(db, ctx, input)).violated).toBe(false);
    await journal(
      canonical(
        'ctrl05_b',
        'BankCreditObserved',
        subjectKey,
        exp.sellerAllocationMinor,
        { bank_credit_id: 'bank_ctrl05_b', recipient_account_id: 'recipient_a' },
        { utr: 'TEST_ONLY_UTR_B' },
      ),
    );
    expect((await evaluateCtrl05ConflictingBankEvidence(db, ctx, input)).violated).toBe(true);
  });

  it('CTRL-06 treats exact retry as clean and conflicting bytes as one violation', async () => {
    const subjectKey = 'order:ctrl06:seller-1';
    const exp = await expectation(subjectKey);
    const original = canonical('ctrl06_original', 'PaymentCaptured', subjectKey, 50_000_000n, {
      payment_id: 'payment_ctrl06',
    });
    const raw = JSON.stringify(original);
    const accepted = await acceptEvidence(db, ctx, {
      event: original,
      rawBytes: raw,
      signatureStatus: 'verified',
    });
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted evidence');
    await acceptEvidence(db, ctx, { event: original, rawBytes: raw, signatureStatus: 'verified' });
    const input = {
      subjectId: exp.subjectId,
      expectationId: exp.expectationId,
      expectationVersion: exp.expectationVersion,
      existingIngestEventId: accepted.eventId,
      exposureAmountMinor: exp.sellerAllocationMinor,
      evaluatedAt: new Date('2026-08-25T10:00:00Z'),
    };
    expect((await evaluateCtrl06DuplicateSafety(db, ctx, input)).violated).toBe(false);
    const modified = { ...original, amount_minor: '1' } as CanonicalEvent;
    await acceptEvidence(db, ctx, {
      event: modified,
      rawBytes: JSON.stringify(modified),
      signatureStatus: 'verified',
    });
    expect((await evaluateCtrl06DuplicateSafety(db, ctx, input)).violated).toBe(true);
    expect((await evaluateCtrl06DuplicateSafety(db, ctx, input)).caseCreated).toBe(false);
    const versions = await db
      .select()
      .from(invariantEvaluations)
      .where(
        and(
          eq(invariantEvaluations.tenantId, 'ten_demo'),
          eq(invariantEvaluations.controlId, 'CTRL-06'),
          eq(invariantEvaluations.subjectId, exp.subjectId),
        ),
      );
    expect(versions.map((row) => row.evaluationVersion).sort()).toEqual([1, 2]);
  });
});
