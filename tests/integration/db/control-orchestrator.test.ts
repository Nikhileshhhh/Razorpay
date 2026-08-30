import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { cases } from '../../../src/config/db-schema.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';
import { evaluateAffectedControls } from '../../../src/modules/invariants/control-orchestrator.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';

const SUBJECT_KEY = 'order:orchestrator-reversal:seller-1';
const CAPTURE_TIME = new Date('2026-08-25T05:00:00Z');
const TRANSFER_TIME = new Date('2026-08-25T05:10:00Z');
const FAILED_TIME = new Date('2026-08-25T05:20:00Z');
const GRACE_SECONDS = 3_600;

function canonical(
  id: string,
  eventType: string,
  eventTime: string,
  refs: Record<string, string>,
  amountMinor: bigint,
): CanonicalEvent {
  return {
    event_id: `evt_${id}`,
    tenant_id: 'ten_demo',
    source_system: 'SYNTHETIC_ROUTE',
    source_account_id: null,
    source_event_id: `source_${id}`,
    source_event_type: eventType,
    event_type: eventType,
    schema_version: '1.0',
    event_time: eventTime,
    ingested_at: eventTime,
    source_entity_version: null,
    entity_references: refs,
    economic_subject_hint: SUBJECT_KEY,
    amount_minor: amountMinor.toString(),
    currency: 'INR',
    correlation_id: null,
    causation_id: null,
    payload_hash: `sha256:${id.padEnd(64, '0').slice(0, 64)}`,
    raw_payload_ref: `db:ingest_events/${id}`,
    metadata: { environment: 'synthetic' },
    data: {},
  } as CanonicalEvent;
}

describe('control orchestrator: SyntheticTransferFailed re-triggers CTRL-01/CTRL-02', () => {
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

  it('re-evaluates CTRL-01 and CTRL-02 and opens a case once a processed transfer is reversed', async () => {
    const captured = canonical(
      'orch_capture',
      'PaymentCaptured',
      CAPTURE_TIME.toISOString(),
      { payment_id: 'payment_orch' },
      50_000_000n,
    );
    const capturedAccepted = await ingestAndProject(db, ctx, {
      event: captured,
      rawBytes: JSON.stringify(captured),
      signatureStatus: 'verified',
    });
    if (capturedAccepted.outcome !== 'accepted') throw new Error('capture not accepted');

    const firstRun = await evaluateAffectedControls(
      db,
      ctx,
      capturedAccepted.eventId,
      new Date(CAPTURE_TIME.getTime() + 1_000),
    );
    expect(firstRun.evaluated).toContain('CTRL-01');

    const transfer = canonical(
      'orch_transfer',
      'TransferProcessed',
      TRANSFER_TIME.toISOString(),
      { transfer_id: 'transfer_orch', recipient_account_id: 'recipient_orch' },
      45_500_000n,
    );
    const transferAccepted = await ingestAndProject(db, ctx, {
      event: transfer,
      rawBytes: JSON.stringify(transfer),
      signatureStatus: 'verified',
    });
    if (transferAccepted.outcome !== 'accepted') throw new Error('transfer not accepted');

    const afterGrace = new Date(CAPTURE_TIME.getTime() + (GRACE_SECONDS + 60) * 1000);
    await evaluateAffectedControls(db, ctx, transferAccepted.eventId, afterGrace);

    // Transfer evidence exists and is current: CTRL-01 must stay clean, so no
    // case exists yet for this subject.
    const cleanRun = await evaluateAffectedControls(db, ctx, capturedAccepted.eventId, afterGrace);
    expect(cleanRun.evaluated).toContain('CTRL-01');
    const casesBeforeReversal = await db
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, 'ten_demo'), eq(cases.controlId, 'CTRL-01')));
    expect(casesBeforeReversal).toHaveLength(0);

    const failed = canonical(
      'orch_failed',
      'SyntheticTransferFailed',
      FAILED_TIME.toISOString(),
      { transfer_id: 'transfer_orch', recipient_account_id: 'recipient_orch' },
      45_500_000n,
    );
    const failedAccepted = await ingestAndProject(db, ctx, {
      event: failed,
      rawBytes: JSON.stringify(failed),
      signatureStatus: 'verified',
    });
    if (failedAccepted.outcome !== 'accepted') throw new Error('failure not accepted');

    // This is the exact wiring path a real `evaluate-controls.v1` outbox job
    // would take (see src/worker/job-handlers.ts) for the reversal event.
    const reversalRun = await evaluateAffectedControls(db, ctx, failedAccepted.eventId, afterGrace);
    expect(reversalRun.evaluated).toContain('CTRL-01');
    expect(reversalRun.evaluated).toContain('CTRL-02');

    const casesAfterReversal = await db
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, 'ten_demo'), eq(cases.controlId, 'CTRL-01')));
    expect(casesAfterReversal).toHaveLength(1);
    expect(casesAfterReversal[0]?.lifecycleState).toBe('open');
    expect(casesAfterReversal[0]?.exposureAmountMinor).toBe(45_500_000n);
  });
});

describe('control orchestrator: RecoverySuppressed/reschedule re-trigger CTRL-04', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ctx = createTenantContext('ten_demo', 'demo');
  const subjectKey = 'order:orchestrator-recovery:seller-1';
  const captureTime = new Date('2026-08-25T06:00:00Z');

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

  function event(
    id: string,
    eventType: string,
    eventTime: string,
    refs: Record<string, string>,
    amountMinor: bigint,
  ): CanonicalEvent {
    return {
      event_id: `evt_${id}`,
      tenant_id: 'ten_demo',
      source_system: 'SYNTHETIC_RECOVERY',
      source_account_id: null,
      source_event_id: `source_${id}`,
      source_event_type: eventType,
      event_type: eventType,
      schema_version: '1.0',
      event_time: eventTime,
      ingested_at: eventTime,
      source_entity_version: null,
      entity_references: refs,
      economic_subject_hint: subjectKey,
      amount_minor: amountMinor.toString(),
      currency: 'INR',
      correlation_id: null,
      causation_id: null,
      payload_hash: `sha256:${id.padEnd(64, '0').slice(0, 64)}`,
      raw_payload_ref: `db:ingest_events/${id}`,
      metadata: { environment: 'synthetic' },
      data: {},
    } as CanonicalEvent;
  }

  it('re-evaluates CTRL-04 through the real outbox/worker path when a recovery is suppressed and later rescheduled', async () => {
    const captured = event(
      'rec_capture',
      'PaymentCaptured',
      captureTime.toISOString(),
      { payment_id: 'payment_rec' },
      12_000_000n,
    );
    const capturedAccepted = await ingestAndProject(db, ctx, {
      event: captured,
      rawBytes: JSON.stringify(captured),
      signatureStatus: 'verified',
    });
    if (capturedAccepted.outcome !== 'accepted') throw new Error('capture not accepted');
    // Establishes the (economic_subjects, expectations) rows the ELSE branch
    // of evaluateAffectedControls looks up for non-PaymentCaptured events.
    await evaluateAffectedControls(db, ctx, capturedAccepted.eventId, captureTime);

    const scheduled = event(
      'rec_scheduled',
      'RecoveryScheduled',
      '2026-08-25T06:10:00Z',
      { recovery_id: 'recovery_orch' },
      12_000_000n,
    );
    const scheduledAccepted = await ingestAndProject(db, ctx, {
      event: scheduled,
      rawBytes: JSON.stringify(scheduled),
      signatureStatus: 'verified',
    });
    if (scheduledAccepted.outcome !== 'accepted') throw new Error('schedule not accepted');

    // This is the exact wiring path a real `evaluate-controls.v1` outbox job
    // would take (see src/worker/job-handlers.ts) for the RecoveryScheduled
    // event — it must reach CTRL-04 and open a case.
    const scheduleRun = await evaluateAffectedControls(
      db,
      ctx,
      scheduledAccepted.eventId,
      new Date('2026-08-25T10:00:00Z'),
    );
    expect(scheduleRun.evaluated).toContain('CTRL-04');
    const casesAfterSchedule = await db
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, 'ten_demo'), eq(cases.controlId, 'CTRL-04')));
    expect(casesAfterSchedule).toHaveLength(1);

    const suppressed = event(
      'rec_suppressed',
      'RecoverySuppressed',
      '2026-08-25T06:20:00Z',
      { recovery_id: 'recovery_orch' },
      12_000_000n,
    );
    const suppressedAccepted = await ingestAndProject(db, ctx, {
      event: suppressed,
      rawBytes: JSON.stringify(suppressed),
      signatureStatus: 'verified',
    });
    if (suppressedAccepted.outcome !== 'accepted') throw new Error('suppression not accepted');

    // A RecoverySuppressed event must ALSO reach CTRL-04 through the same
    // real path — proving reevaluation is actually wired, not merely
    // correct when called directly.
    const suppressRun = await evaluateAffectedControls(
      db,
      ctx,
      suppressedAccepted.eventId,
      new Date('2026-08-25T10:00:00Z'),
    );
    expect(suppressRun.evaluated).toContain('CTRL-04');
    const cleanEvaluation = await db
      .select()
      .from(schema.invariantEvaluations)
      .where(
        and(
          eq(schema.invariantEvaluations.tenantId, 'ten_demo'),
          eq(schema.invariantEvaluations.controlId, 'CTRL-04'),
          eq(schema.invariantEvaluations.subjectId, casesAfterSchedule[0]!.subjectId),
        ),
      )
      .orderBy(schema.invariantEvaluations.evaluationVersion);
    expect(cleanEvaluation.at(-1)?.result).toBe('clean');

    const rescheduled = event(
      'rec_rescheduled',
      'RecoveryScheduled',
      '2026-08-25T06:30:00Z',
      { recovery_id: 'recovery_orch' },
      12_000_000n,
    );
    const rescheduledAccepted = await ingestAndProject(db, ctx, {
      event: rescheduled,
      rawBytes: JSON.stringify(rescheduled),
      signatureStatus: 'verified',
    });
    if (rescheduledAccepted.outcome !== 'accepted') throw new Error('reschedule not accepted');

    const rescheduleRun = await evaluateAffectedControls(
      db,
      ctx,
      rescheduledAccepted.eventId,
      new Date('2026-08-25T12:00:00Z'),
    );
    expect(rescheduleRun.evaluated).toContain('CTRL-04');
    const finalEvaluation = await db
      .select()
      .from(schema.invariantEvaluations)
      .where(
        and(
          eq(schema.invariantEvaluations.tenantId, 'ten_demo'),
          eq(schema.invariantEvaluations.controlId, 'CTRL-04'),
          eq(schema.invariantEvaluations.subjectId, casesAfterSchedule[0]!.subjectId),
        ),
      )
      .orderBy(schema.invariantEvaluations.evaluationVersion);
    expect(finalEvaluation.at(-1)?.result).toBe('violated');
  });
});
