import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import * as schema from '../../../src/config/db-schema.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { ensureSellerAllocationExpectation } from '../../../src/modules/expectations/expectation-service.js';
import { evaluateCtrl01MissingTransfer } from '../../../src/modules/invariants/ctrl-01-missing-transfer.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';
import { getCase } from '../../../src/modules/cases/case-service.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';

const SUBJECT_KEY = 'order:merchant-order-718:seller-42';
const CAPTURE_TIME = new Date('2026-08-25T05:20:00Z');
const GRACE_SECONDS = 3600;

function transferProcessed(): CanonicalEvent {
  return {
    event_id: 'evt_transfer_1',
    tenant_id: 'ten_demo',
    source_system: 'SYNTHETIC_ROUTE',
    source_account_id: null,
    source_event_id: null,
    source_event_type: 'synthetic.transfer.processed',
    event_type: 'TransferProcessed',
    schema_version: '1.0',
    event_time: '2026-08-25T07:00:00Z',
    ingested_at: '2026-08-25T07:00:01Z',
    source_entity_version: null,
    entity_references: { transfer_id: 'transfer_1' },
    economic_subject_hint: SUBJECT_KEY,
    amount_minor: '45500000',
    currency: 'INR',
    correlation_id: null,
    causation_id: null,
    payload_hash: `sha256:${'1'.repeat(64)}`,
    raw_payload_ref: 'db:ingest_events/evt_transfer_1',
    metadata: { environment: 'synthetic' },
    data: {},
  } as CanonicalEvent;
}

describe('CTRL-01: captured payment with missing expected transfer', () => {
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

  it('does not violate before the grace period expires', async () => {
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: SUBJECT_KEY,
      orderCaptureAmountMinor: 50000000n,
    });
    expect(expectation.sellerAllocationMinor).toBe(45500000n);
    expect(expectation.platformAllocationMinor).toBe(4500000n);

    const result = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey: SUBJECT_KEY,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: new Date(CAPTURE_TIME.getTime() + 1000), // 1s later, well within grace
    });
    expect(result.violated).toBe(false);
    expect(result.caseId).toBeNull();
  });

  it('opens exactly one ₹4,55,000 case once the grace period expires with no transfer evidence', async () => {
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: SUBJECT_KEY,
      orderCaptureAmountMinor: 50000000n,
    });

    const afterGrace = new Date(CAPTURE_TIME.getTime() + (GRACE_SECONDS + 60) * 1000);
    const first = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey: SUBJECT_KEY,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: afterGrace,
    });
    expect(first.violated).toBe(true);
    expect(first.caseCreated).toBe(true);
    expect(first.caseId).not.toBeNull();

    const persisted = await getCase(db, ctx, first.caseId as string);
    expect(persisted?.exposureAmountMinor).toBe(45500000n);
    expect(persisted?.currency).toBe('INR');
    expect(persisted?.lifecycleState).toBe('open');
    expect(persisted?.controlId).toBe('CTRL-01');

    // Re-running the identical evaluation is idempotent: same case, not re-created.
    const second = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey: SUBJECT_KEY,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: afterGrace,
    });
    expect(second.caseId).toBe(first.caseId);
    expect(second.caseCreated).toBe(false);
  });

  it('does not violate when transfer evidence already exists for the subject', async () => {
    const subjectKey = 'order:merchant-order-999:seller-99';
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50000000n,
    });

    const transferEvent = { ...transferProcessed(), economic_subject_hint: subjectKey };
    const accepted = await ingestAndProject(db, ctx, {
      event: transferEvent,
      rawBytes: JSON.stringify(transferEvent),
      signatureStatus: 'verified',
    });
    expect(accepted.outcome).toBe('accepted');

    const afterGrace = new Date(CAPTURE_TIME.getTime() + (GRACE_SECONDS + 60) * 1000);
    const result = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: afterGrace,
    });
    expect(result.violated).toBe(false);
    expect(result.caseId).toBeNull();
  });

  it('re-violates once a SyntheticTransferFailed reverses a previously-processed transfer', async () => {
    const subjectKey = 'order:merchant-order-777:seller-77';
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey,
      orderCaptureAmountMinor: 50000000n,
    });

    const transferEvent = {
      ...transferProcessed(),
      event_id: 'evt_transfer_777',
      economic_subject_hint: subjectKey,
      entity_references: { transfer_id: 'transfer_777' },
    };
    const accepted = await ingestAndProject(db, ctx, {
      event: transferEvent,
      rawBytes: JSON.stringify(transferEvent),
      signatureStatus: 'verified',
    });
    expect(accepted.outcome).toBe('accepted');

    const afterGrace = new Date(CAPTURE_TIME.getTime() + (GRACE_SECONDS + 60) * 1000);
    const clean = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: afterGrace,
    });
    expect(clean.violated).toBe(false);
    expect(clean.caseId).toBeNull();

    // Authoritative reversal discovered after processing: SyntheticTransferFailed
    // must become entity_current (transfer.failed outranks transfer.processed)
    // and invalidate the prior transfer as evidence.
    const failedEvent = {
      ...transferProcessed(),
      event_id: 'evt_transfer_777_failed',
      source_event_id: null,
      source_event_type: 'synthetic.transfer.failed',
      event_type: 'SyntheticTransferFailed',
      event_time: '2026-08-25T08:00:00Z',
      ingested_at: '2026-08-25T08:00:01Z',
      entity_references: { transfer_id: 'transfer_777' },
      economic_subject_hint: subjectKey,
      payload_hash: `sha256:${'2'.repeat(64)}`,
      raw_payload_ref: 'db:ingest_events/evt_transfer_777_failed',
    } as CanonicalEvent;
    const failedAccepted = await ingestAndProject(db, ctx, {
      event: failedEvent,
      rawBytes: JSON.stringify(failedEvent),
      signatureStatus: 'verified',
    });
    expect(failedAccepted.outcome).toBe('accepted');

    const reevaluated = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey,
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: CAPTURE_TIME,
      graceSeconds: GRACE_SECONDS,
      now: afterGrace,
    });
    expect(reevaluated.violated).toBe(true);
    expect(reevaluated.caseId).not.toBeNull();
    expect(reevaluated.caseCreated).toBe(true);
  });
});
