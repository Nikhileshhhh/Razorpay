import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import * as schema from '../../../src/config/db-schema.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { acceptEvidence } from '../../../src/modules/ingestion/ingestion-service.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';
import { projectIngestEvent } from '../../../src/modules/projection/projector.js';
import {
  auditEntries,
  entityCurrent,
  entityRevisions,
  eventConflicts,
  ingestEvents,
  outbox,
} from '../../../src/config/db-schema.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';
import { replayTenantProjections } from '../../../src/modules/projection/replay.js';
import { dispatchPendingOutbox } from '../../../src/worker/outbox-dispatcher.js';
import type PgBoss from 'pg-boss';

function paymentCaptured(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    event_id: 'evt_test_1',
    tenant_id: 'ten_demo',
    source_system: 'RAZORPAY_TEST',
    source_account_id: null,
    source_event_id: 'razorpay_evt_1',
    source_event_type: 'payment.captured',
    event_type: 'PaymentCaptured',
    schema_version: '1.0',
    event_time: '2026-08-25T05:20:00Z',
    ingested_at: '2026-08-25T05:20:02Z',
    source_entity_version: null,
    entity_references: { order_id: 'order_718', payment_id: 'pay_901' },
    economic_subject_hint: 'order:merchant-order-718:seller-42',
    amount_minor: '50000000',
    currency: 'INR',
    correlation_id: 'corr_order_718',
    causation_id: null,
    payload_hash: `sha256:${'0'.repeat(64)}`,
    raw_payload_ref: 'db:ingest_events/evt_test_1',
    metadata: { environment: 'test' },
    data: {},
    ...overrides,
  } as CanonicalEvent;
}

describe('ingestion + projection (backend PRD §9)', () => {
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

  beforeEach(async () => {
    // Each test uses a distinct source_event_id / entity to stay independent
    // without paying for a fresh database per test.
  });

  it('accepts a new event and durably journals it', async () => {
    const event = paymentCaptured({ source_event_id: 'razorpay_evt_accept_1' });
    const outcome = await acceptEvidence(db, ctx, {
      event,
      rawBytes: JSON.stringify(event),
      signatureStatus: 'verified',
    });
    expect(outcome.outcome).toBe('accepted');
  });

  it('exact same source_event_id + same hash returns duplicate, no new row', async () => {
    const event = paymentCaptured({ source_event_id: 'razorpay_evt_dup_test' });
    const raw = JSON.stringify(event);
    const first = await acceptEvidence(db, ctx, {
      event,
      rawBytes: raw,
      signatureStatus: 'verified',
    });
    const second = await acceptEvidence(db, ctx, {
      event,
      rawBytes: raw,
      signatureStatus: 'verified',
    });
    expect(first.outcome).toBe('accepted');
    expect(second.outcome).toBe('duplicate');
    if (second.outcome === 'duplicate') {
      expect(second.eventId).toBe(first.outcome === 'accepted' ? first.eventId : undefined);
    }
  });

  it('serializes concurrent same-id delivery into one acceptance and one projection job', async () => {
    const event = paymentCaptured({
      event_id: 'evt_concurrent_same',
      source_event_id: 'razorpay_evt_concurrent_same',
    });
    const raw = Buffer.from(JSON.stringify(event));
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        acceptEvidence(db, ctx, { event, rawBytes: raw, signatureStatus: 'verified' }),
      ),
    );
    expect(outcomes.filter((item) => item.outcome === 'accepted')).toHaveLength(1);
    expect(outcomes.filter((item) => item.outcome === 'duplicate')).toHaveLength(7);
    const acceptedId = outcomes.find((item) => item.outcome === 'accepted');
    if (!acceptedId || acceptedId.outcome !== 'accepted') throw new Error('accepted event missing');
    const journal = await db
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'razorpay_evt_concurrent_same'));
    expect(journal).toHaveLength(1);
    expect(Buffer.compare(journal[0]!.rawBytes, raw)).toBe(0);
    const work = await db.select().from(outbox).where(eq(outbox.domainEventId, acceptedId.eventId));
    expect(work.map((item) => item.topic)).toEqual(['project-evidence.v1']);
    const audits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.artifactId, acceptedId.eventId));
    expect(audits).toHaveLength(8);
  });

  it('same source_event_id + different hash is quarantined as a conflict, never overwrites', async () => {
    const event = paymentCaptured({ source_event_id: 'razorpay_evt_conflict_test' });
    await acceptEvidence(db, ctx, {
      event,
      rawBytes: JSON.stringify(event),
      signatureStatus: 'verified',
    });
    const modified = paymentCaptured({
      source_event_id: 'razorpay_evt_conflict_test',
      amount_minor: '1',
    });
    const conflictOutcome = await acceptEvidence(db, ctx, {
      event: modified,
      rawBytes: JSON.stringify(modified),
      signatureStatus: 'verified',
    });
    expect(conflictOutcome.outcome).toBe('conflict');

    const conflicts = await db
      .select()
      .from(eventConflicts)
      .where(eq(eventConflicts.sourceEventId, 'razorpay_evt_conflict_test'));
    expect(conflicts.length).toBe(1);
  });

  it('fallback dedupe (no source_event_id) never merges two distinct equal-value events', async () => {
    const eventA = paymentCaptured({
      event_id: 'evt_fb_a',
      source_event_id: null,
      event_time: '2026-08-25T06:00:00Z',
    });
    const eventB = paymentCaptured({
      event_id: 'evt_fb_b',
      source_event_id: null,
      event_time: '2026-08-25T06:00:01Z', // distinct event_time -> distinct fallback key
    });
    const a = await acceptEvidence(db, ctx, {
      event: eventA,
      rawBytes: JSON.stringify(eventA),
      signatureStatus: 'verified',
    });
    const b = await acceptEvidence(db, ctx, {
      event: eventB,
      rawBytes: JSON.stringify(eventB),
      signatureStatus: 'verified',
    });
    expect(a.outcome).toBe('accepted');
    expect(b.outcome).toBe('accepted');
  });

  it('projection creates entity_current and entity_revisions for a new accepted event', async () => {
    const event = paymentCaptured({
      source_event_id: 'razorpay_evt_proj_1',
      entity_references: { payment_id: 'pay_proj_1' },
    });
    const outcome = await ingestAndProject(db, ctx, {
      event,
      rawBytes: JSON.stringify(event),
      signatureStatus: 'verified',
    });
    expect(outcome.outcome).toBe('accepted');

    const current = await db
      .select()
      .from(entityCurrent)
      .where(eq(entityCurrent.entityKey, 'payment:pay_proj_1'));
    expect(current).toHaveLength(1);
    expect(current[0]?.entityType).toBe('payment');

    const revisions = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.entityKey, 'payment:pay_proj_1'));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.businessState).toBe('captured');
  });

  it('projection is idempotent: projecting the same ingest event twice does nothing the second time', async () => {
    const event = paymentCaptured({
      source_event_id: 'razorpay_evt_proj_idem',
      entity_references: { payment_id: 'pay_proj_idem' },
    });
    const accepted = await acceptEvidence(db, ctx, {
      event,
      rawBytes: JSON.stringify(event),
      signatureStatus: 'verified',
    });
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');
    const first = await projectIngestEvent(db, ctx, accepted.eventId);
    const second = await projectIngestEvent(db, ctx, accepted.eventId);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('already_applied');

    const revisions = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.entityKey, 'payment:pay_proj_idem'));
    expect(revisions).toHaveLength(1);
  });

  it('an out-of-order (earlier) late event does not regress entity_current', async () => {
    const later = paymentCaptured({
      event_id: 'evt_ooo_later',
      source_event_id: 'razorpay_evt_ooo_later',
      entity_references: { payment_id: 'pay_ooo_1' },
      event_time: '2026-08-25T10:00:00Z',
    });
    const earlier = paymentCaptured({
      event_id: 'evt_ooo_earlier',
      source_event_id: 'razorpay_evt_ooo_earlier',
      entity_references: { payment_id: 'pay_ooo_1' },
      event_time: '2026-08-25T09:00:00Z',
    });

    // Later event arrives FIRST (out-of-order delivery).
    await ingestAndProject(db, ctx, {
      event: later,
      rawBytes: JSON.stringify(later),
      signatureStatus: 'verified',
    });
    await ingestAndProject(db, ctx, {
      event: earlier,
      rawBytes: JSON.stringify(earlier),
      signatureStatus: 'verified',
    });

    const current = await db
      .select()
      .from(entityCurrent)
      .where(eq(entityCurrent.entityKey, 'payment:pay_ooo_1'));
    const currentRevision = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.id, current[0]?.currentRevisionId ?? ''));
    // Current must still point at the LATER event_time, not the earlier one.
    expect(currentRevision[0]?.eventTime.toISOString()).toBe(
      new Date('2026-08-25T10:00:00Z').toISOString(),
    );

    // Both revisions remain in history.
    const allRevisions = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.entityKey, 'payment:pay_ooo_1'));
    expect(allRevisions).toHaveLength(2);
  });

  it('source entity version outranks status and event-time ordering', async () => {
    const versionTwo = paymentCaptured({
      event_id: 'evt_source_version_2',
      source_event_id: 'razorpay_source_version_2',
      source_entity_version: 2,
      entity_references: { payment_id: 'pay_source_version' },
      event_time: '2026-08-25T09:00:00Z',
    });
    const versionOneLater = paymentCaptured({
      event_id: 'evt_source_version_1',
      source_event_id: 'razorpay_source_version_1',
      source_entity_version: 1,
      entity_references: { payment_id: 'pay_source_version' },
      event_time: '2026-08-25T11:00:00Z',
    });
    await ingestAndProject(db, ctx, {
      event: versionTwo,
      rawBytes: JSON.stringify(versionTwo),
      signatureStatus: 'verified',
    });
    await ingestAndProject(db, ctx, {
      event: versionOneLater,
      rawBytes: JSON.stringify(versionOneLater),
      signatureStatus: 'verified',
    });
    const current = await db
      .select({ revisionId: entityCurrent.currentRevisionId })
      .from(entityCurrent)
      .where(eq(entityCurrent.entityKey, 'payment:pay_source_version'));
    const revision = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.id, current[0]!.revisionId));
    expect(revision[0]?.sourceEntityVersion).toBe(2);
  });

  it('allowlisted status precedence prevents a late authorized event regressing captured', async () => {
    const captured = paymentCaptured({
      event_id: 'evt_status_captured',
      source_event_id: 'razorpay_status_captured',
      source_entity_version: null,
      entity_references: { payment_id: 'pay_status_precedence' },
      event_time: '2026-08-25T09:00:00Z',
    });
    const authorized = paymentCaptured({
      event_id: 'evt_status_authorized',
      source_event_id: 'razorpay_status_authorized',
      source_event_type: 'payment.authorized',
      event_type: 'PaymentAuthorized',
      source_entity_version: null,
      entity_references: { payment_id: 'pay_status_precedence' },
      event_time: '2026-08-25T11:00:00Z',
    } as Partial<CanonicalEvent>);
    await ingestAndProject(db, ctx, {
      event: captured,
      rawBytes: JSON.stringify(captured),
      signatureStatus: 'verified',
    });
    await ingestAndProject(db, ctx, {
      event: authorized,
      rawBytes: JSON.stringify(authorized),
      signatureStatus: 'verified',
    });
    const current = await db
      .select({ revisionId: entityCurrent.currentRevisionId })
      .from(entityCurrent)
      .where(eq(entityCurrent.entityKey, 'payment:pay_status_precedence'));
    const revision = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.id, current[0]!.revisionId));
    expect(revision[0]?.businessState).toBe('captured');
    const history = await db
      .select()
      .from(entityRevisions)
      .where(eq(entityRevisions.entityKey, 'payment:pay_status_precedence'));
    expect(history).toHaveLength(2);
  });

  it('replay is deterministic twice and emits no action or control work', async () => {
    const first = await replayTenantProjections(db, ctx);
    const second = await replayTenantProjections(db, ctx);
    expect(second).toEqual(first);
    expect(first.matchesShadow).toBe(true);
    const forbidden = await db.select().from(outbox).where(eq(outbox.topic, 'dispatch-action.v1'));
    expect(forbidden).toHaveLength(0);
  });

  it('recovers durable outbox work after a dispatcher failure without duplicate dispatch', async () => {
    await db.update(outbox).set({ status: 'dispatched', dispatchedAt: new Date() });
    const event = paymentCaptured({
      event_id: 'evt_outbox_recovery',
      source_event_id: 'razorpay_outbox_recovery',
    });
    const accepted = await acceptEvidence(db, ctx, {
      event,
      rawBytes: JSON.stringify(event),
      signatureStatus: 'verified',
    });
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted evidence');

    const failedBoss = {
      createQueue: async () => undefined,
      send: async () => {
        throw new Error('TEST_ONLY_QUEUE_UNAVAILABLE');
      },
    } as unknown as PgBoss;
    expect(await dispatchPendingOutbox(db, failedBoss)).toBe(1);
    const failed = await db.select().from(outbox).where(eq(outbox.domainEventId, accepted.eventId));
    expect(failed[0]?.status).toBe('failed');

    const sent: unknown[] = [];
    const recoveredBoss = {
      createQueue: async () => undefined,
      send: async (_topic: string, payload: unknown) => {
        sent.push(payload);
        return 'TEST_ONLY_JOB_ID';
      },
    } as unknown as PgBoss;
    expect(await dispatchPendingOutbox(db, recoveredBoss)).toBe(1);
    expect(sent).toEqual([
      expect.objectContaining({ tenant_id: 'ten_demo', ingest_event_id: accepted.eventId }),
    ]);
    expect(await dispatchPendingOutbox(db, recoveredBoss)).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
