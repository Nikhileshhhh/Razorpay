import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import * as schema from '../../../src/config/db-schema.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { ALL_APP_TABLES, resetDemoDatabase } from '../../../src/modules/demo/reset.js';
import { resolveIdentity } from '../../../src/modules/identity/identity-repository.js';
import { SEED_USERS } from '../../../src/modules/identity/seed-data.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';
import { acceptEvidence } from '../../../src/modules/ingestion/ingestion-service.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { ensureSellerAllocationExpectation } from '../../../src/modules/expectations/expectation-service.js';
import { evaluateCtrl01MissingTransfer } from '../../../src/modules/invariants/ctrl-01-missing-transfer.js';
import { createEntityLink } from '../../../src/modules/provenance/provenance-service.js';
import { sealEvidenceSet } from '../../../src/modules/evidence/evidence-set-service.js';

/**
 * `seedIdentity` (upsert-based) and `resetDemoDatabase` (truncate + reseed)
 * both converge to the exact same identity fixture, so this file safely shares
 * ONE ephemeral database across all its tests instead of paying for a fresh
 * CREATE DATABASE per test.
 */
describe('identity seeding and deterministic reset', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  it('seeds every documented demo user with the documented roles', async () => {
    await seedIdentity(db);
    for (const expected of SEED_USERS) {
      const identity = await resolveIdentity(db, expected.id);
      expect(identity, expected.id).not.toBeNull();
      expect(identity?.tenantContext.tenantId).toBe(expected.tenantId);
      expect([...(identity?.roles ?? [])].sort()).toEqual([...expected.roles].sort());
    }
  });

  it('resolveIdentity returns null for an unknown user (maps to 401 at the API boundary)', async () => {
    expect(await resolveIdentity(db, 'user_does_not_exist')).toBeNull();
  });

  it('cross-tenant: a user in ten_other never resolves into ten_demo', async () => {
    const other = await resolveIdentity(db, 'user_other_viewer');
    expect(other?.tenantContext.tenantId).toBe('ten_other');
    expect(other?.tenantContext.tenantId).not.toBe('ten_demo');
  });

  it('seeding twice does not duplicate memberships', async () => {
    await seedIdentity(db);
    await seedIdentity(db);
    const rows = await pool.query<{ n: number }>('select count(*)::int as n from memberships');
    const expectedCount = SEED_USERS.reduce((sum, u) => sum + u.roles.length, 0);
    expect(rows.rows[0]?.n).toBe(expectedCount);
  });

  // Two full resets, each driving the real 500-record dataset through
  // genuine service calls (backend PRD §16.1) — measured at ~2 minutes each,
  // well beyond Vitest's 30s default `testTimeout`.
  const RESET_TEST_TIMEOUT_MS = 300_000;

  it(
    'reset is idempotent: running it twice yields an identical manifest hash',
    async () => {
      const first = await resetDemoDatabase(pool, db, 'demo');
      const second = await resetDemoDatabase(pool, db, 'demo');
      expect(second.manifestHash).toBe(first.manifestHash);
      expect(first.resourceVersion).toBe(0);
      expect(second.resourceVersion).toBe(0);
      // And the identity fixture is restored exactly.
      const viewer = await resolveIdentity(db, 'user_viewer');
      expect(viewer?.tenantContext.tenantId).toBe('ten_demo');
    },
    RESET_TEST_TIMEOUT_MS,
  );

  it('reset refuses to run outside a demo-like environment', async () => {
    await expect(resetDemoDatabase(pool, db, 'production')).rejects.toThrow(/demo\/buildathon/i);
  });

  it('truncates every application table, not just identity — ingest_events, cases, entity_links, entity_link_reviews, and case_relationships included', async () => {
    await seedIdentity(db);
    const ctx = createTenantContext('ten_demo', 'demo');

    function canonicalEvent(id: string, subjectKey: string): CanonicalEvent {
      return {
        event_id: `evt_${id}`,
        tenant_id: 'ten_demo',
        source_system: 'RAZORPAY_TEST',
        source_account_id: null,
        source_event_id: `source_${id}`,
        source_event_type: 'payment.captured',
        event_type: 'PaymentCaptured',
        schema_version: '1.0',
        event_time: '2026-08-25T05:20:00Z',
        ingested_at: '2026-08-25T05:20:01Z',
        source_entity_version: 1,
        entity_references: { payment_id: `payment_${id}` },
        economic_subject_hint: subjectKey,
        amount_minor: '50000000',
        currency: 'INR',
        correlation_id: id,
        causation_id: null,
        payload_hash: `sha256:${'0'.repeat(64)}`,
        raw_payload_ref: `db:ingest_events/${id}`,
        metadata: { environment: 'test' },
        data: {},
      } as CanonicalEvent;
    }

    // Populate broad coverage: ingest_events, economic_subjects,
    // expectations, cases, case_transitions, audit_entries (all via
    // ingestion + CTRL-01), plus entity_links/entity_link_reviews (via
    // provenance) and case_relationships (a direct reopening link between
    // two real cases).
    const subjectA = 'order:reset-coverage-a:seller-1';
    const eventA = canonicalEvent('reset_a', subjectA);
    const acceptedA = await acceptEvidence(db, ctx, {
      event: eventA,
      rawBytes: JSON.stringify(eventA),
      signatureStatus: 'verified',
    });
    if (acceptedA.outcome !== 'accepted') throw new Error('fixture A not accepted');
    const expectationA = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: subjectA,
      orderCaptureAmountMinor: 50_000_000n,
    });
    const resultA = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectationA.subjectId,
      subjectKey: subjectA,
      expectationId: expectationA.expectationId,
      expectationVersion: expectationA.expectationVersion,
      sellerAllocationMinor: expectationA.sellerAllocationMinor,
      captureEventTime: new Date('2026-08-25T05:20:00Z'),
      graceSeconds: 1,
      now: new Date('2026-08-25T05:30:00Z'),
    });
    if (!resultA.caseId) throw new Error('expected CTRL-01 to open a case for fixture A');

    const subjectB = 'order:reset-coverage-b:seller-1';
    const eventB = canonicalEvent('reset_b', subjectB);
    const acceptedB = await acceptEvidence(db, ctx, {
      event: eventB,
      rawBytes: JSON.stringify(eventB),
      signatureStatus: 'verified',
    });
    if (acceptedB.outcome !== 'accepted') throw new Error('fixture B not accepted');
    const expectationB = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: subjectB,
      orderCaptureAmountMinor: 50_000_000n,
    });
    const resultB = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectationB.subjectId,
      subjectKey: subjectB,
      expectationId: expectationB.expectationId,
      expectationVersion: expectationB.expectationVersion,
      sellerAllocationMinor: expectationB.sellerAllocationMinor,
      captureEventTime: new Date('2026-08-25T05:20:00Z'),
      graceSeconds: 1,
      now: new Date('2026-08-25T05:30:00Z'),
    });
    if (!resultB.caseId) throw new Error('expected CTRL-01 to open a case for fixture B');

    await db.insert(schema.caseRelationships).values({
      id: 'case_rel_reset_coverage',
      tenantId: 'ten_demo',
      sourceCaseId: resultA.caseId,
      targetCaseId: resultB.caseId,
      relationshipType: 'reopened_from',
      reason: 'reset coverage fixture',
    });

    const set = await sealEvidenceSet(db, ctx, [
      { evidenceId: acceptedA.eventId, role: 'primary' },
    ]);
    const linkId = await createEntityLink(db, ctx, {
      edgeType: 'CANDIDATE_MATCH',
      sourceNodeKey: subjectA,
      targetNodeKey: 'payment:payment_reset_a',
      confidenceClass: 'candidate',
      observation: 'observed',
      resolverVersion: 'resolver-v1',
      evidenceSetHash: set.hash,
    });
    await db.insert(schema.entityLinkReviews).values({
      id: 'link_review_reset_coverage',
      tenantId: 'ten_demo',
      linkId,
      reviewVersion: 1,
      decision: 'confirmed',
      reviewerId: 'user_investigator',
      reason: 'reset coverage fixture',
    });

    // Confirm the fixtures actually landed before asserting they're gone.
    const populatedCounts = await Promise.all([
      db.select().from(schema.ingestEvents),
      db.select().from(schema.cases),
      db.select().from(schema.caseTransitions),
      db.select().from(schema.caseRelationships),
      db.select().from(schema.entityLinks),
      db.select().from(schema.entityLinkReviews),
      db.select().from(schema.auditEntries),
      db.select().from(schema.invariantEvaluations),
    ]);
    for (const rows of populatedCounts) expect(rows.length).toBeGreaterThan(0);

    await resetDemoDatabase(pool, db, 'demo');

    const postResetCounts = await Promise.all([
      db.select().from(schema.ingestEvents),
      db.select().from(schema.cases),
      db.select().from(schema.caseTransitions),
      db.select().from(schema.caseRelationships),
      db.select().from(schema.entityLinks),
      db.select().from(schema.entityLinkReviews),
      db.select().from(schema.auditEntries),
      db.select().from(schema.invariantEvaluations),
      db.select().from(schema.demoDatasetRecords),
    ]);
    // Gate B4 reset replaces arbitrary fixtures with the registered 500-record
    // dataset ledger and its deterministic cases/audit, while old
    // relationship and review fixtures remain absent. Each of the 500
    // dataset-ledger records is produced through the real acceptance/
    // projection/control (and, for one record, full investigation/policy/
    // action/verification) pipeline (backend PRD §16.1, ADR 0002 D9) — so it
    // genuinely spans several raw `ingest_events`/`case_transitions` rows
    // each, not a fixed 1:1 count; the exactly-500 guarantee is the
    // `demo_dataset_records` ledger itself, and the case count is exactly
    // deterministic by construction (16 unresolved CTRL-01 + 4 unsafe-
    // candidate CTRL-01 + 1 CTRL-04 duplicate-recovery-prevention).
    expect(postResetCounts[0].length).toBeGreaterThan(0);
    expect(postResetCounts[1]).toHaveLength(21);
    expect(postResetCounts[2].length).toBeGreaterThan(0);
    expect(postResetCounts[3]).toHaveLength(0);
    // Real projection now runs for every dataset record, which genuinely
    // creates direct-identifier provenance edges between related evidence
    // (e.g. order/payment/transfer chains) — architecture §10.3. Only
    // human-reviewed candidate decisions (`entity_link_reviews`) remain
    // absent, since nothing in dataset generation calls that review path.
    expect(postResetCounts[4].length).toBeGreaterThan(0);
    expect(postResetCounts[5]).toHaveLength(0);
    expect(postResetCounts[6].length).toBeGreaterThan(0);
    // Real control evaluation runs for every dataset record now (unlike a
    // hand-rolled fixture insert), so this is genuinely populated post-reset.
    expect(postResetCounts[7].length).toBeGreaterThan(0);
    expect(postResetCounts[8]).toHaveLength(500);

    // Identity is also restored alongside the registered dataset.
    const viewer = await resolveIdentity(db, 'user_viewer');
    expect(viewer?.tenantContext.tenantId).toBe('ten_demo');
  }, 180_000);

  it('a failure during reseeding rolls back the destructive truncate (data survives)', async () => {
    await seedIdentity(db);
    const before = await resolveIdentity(db, 'user_viewer');
    expect(before?.tenantContext.tenantId).toBe('ten_demo');
    const beforeRows = await db.select().from(schema.tenants);
    expect(beforeRows.length).toBeGreaterThan(0);

    // Reproduce reset's exact transactional shape — TRUNCATE every
    // application table, then a step that fails — using the SAME table list
    // `resetDemoDatabase` truncates, to prove the destructive TRUNCATE
    // genuinely participates in (and rolls back with) the surrounding
    // transaction, rather than silently committing early. `resetDemoDatabase`
    // itself has no natural failure point in its hardcoded, always-valid
    // reseed steps, so this exercises the underlying mechanism directly.
    const client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`truncate table ${ALL_APP_TABLES.join(', ')} cascade`);
      await expect(
        client.query(
          `insert into tenants (id, display_name, environment) values (null, 'x', 'demo')`,
        ),
      ).rejects.toThrow();
      await client.query('rollback');
    } finally {
      await client.end();
    }

    const after = await resolveIdentity(db, 'user_viewer');
    expect(after?.tenantContext.tenantId).toBe('ten_demo');
    const afterRows = await db.select().from(schema.tenants);
    expect(afterRows.length).toBe(beforeRows.length);
  });
});
