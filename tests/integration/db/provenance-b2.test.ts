import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import type { CanonicalEvent } from '../../../src/contracts/events/canonical-event.js';
import { seedIdentity } from '../../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { acceptEvidence } from '../../../src/modules/ingestion/ingestion-service.js';
import {
  EvidenceSetInvalidError,
  sealEvidenceSet,
} from '../../../src/modules/evidence/evidence-set-service.js';
import {
  createEntityLink,
  LinkVersionConflictError,
  reviewEntityLink,
} from '../../../src/modules/provenance/provenance-service.js';
import { entityLinks, entityLinkReviews } from '../../../src/config/db-schema.js';
import { and, eq } from 'drizzle-orm';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';

function event(id: string): CanonicalEvent {
  return {
    event_id: `event_${id}`,
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
    economic_subject_hint: 'order:provenance:seller-1',
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

describe('sealed B2 evidence sets', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

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

  it('has an order-independent canonical hash, is immutable, and rejects cross-tenant evidence', async () => {
    const ctx = createTenantContext('ten_demo', 'demo');
    const ids: string[] = [];
    for (const suffix of ['a', 'b']) {
      const canonical = event(`provenance_${suffix}`);
      const accepted = await acceptEvidence(db, ctx, {
        event: canonical,
        rawBytes: JSON.stringify(canonical),
        signatureStatus: 'verified',
      });
      if (accepted.outcome !== 'accepted') throw new Error('fixture evidence not accepted');
      ids.push(accepted.eventId);
    }
    const first = await sealEvidenceSet(db, ctx, [
      { evidenceId: ids[0]!, role: 'primary' },
      { evidenceId: ids[1]!, role: 'corroborating' },
    ]);
    const reordered = await sealEvidenceSet(db, ctx, [
      { evidenceId: ids[1]!, role: 'corroborating' },
      { evidenceId: ids[0]!, role: 'primary' },
    ]);
    expect(reordered).toEqual(first);
    await expect(
      pool.query(`update evidence_sets set evidence_set_hash = 'sha256:changed' where id = $1`, [
        first.id,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      sealEvidenceSet(createDb(pool), createTenantContext('ten_other', 'demo'), [
        { evidenceId: ids[0]!, role: 'primary' },
      ]),
    ).rejects.toBeInstanceOf(EvidenceSetInvalidError);
  });

  it('candidate link review is append-only, concurrency-safe, and preserves the original on rejection', async () => {
    const ctx = createTenantContext('ten_demo', 'demo');
    const canonical = event('provenance_review');
    const accepted = await acceptEvidence(db, ctx, {
      event: canonical,
      rawBytes: JSON.stringify(canonical),
      signatureStatus: 'verified',
    });
    if (accepted.outcome !== 'accepted') throw new Error('fixture evidence not accepted');
    const set = await sealEvidenceSet(db, ctx, [{ evidenceId: accepted.eventId, role: 'primary' }]);

    const linkId = await createEntityLink(db, ctx, {
      edgeType: 'CANDIDATE_MATCH',
      sourceNodeKey: 'order:provenance-review:seller-1',
      targetNodeKey: 'payment:payment_provenance_review',
      confidenceClass: 'candidate',
      observation: 'observed',
      resolverVersion: 'resolver-v1',
      evidenceSetHash: set.hash,
    });
    const before = await db.select().from(entityLinks).where(eq(entityLinks.id, linkId));
    expect(before[0]?.reviewStatus).toBe('unreviewed');
    expect(before[0]?.version).toBe(0);

    // Two reviewers race on the SAME expectedVersion: exactly one must win,
    // the other must get a typed conflict, never a raw DB error.
    const results = await Promise.allSettled([
      reviewEntityLink(db, ctx, {
        linkId,
        expectedVersion: 0,
        decision: 'reject',
        reason: 'TEST_ONLY_reviewer_a_reason',
        reviewerId: 'user_investigator',
        reviewerRole: 'case_manager',
      }),
      reviewEntityLink(db, ctx, {
        linkId,
        expectedVersion: 0,
        decision: 'confirm',
        reason: 'TEST_ONLY_reviewer_b_reason',
        reviewerId: 'user_approver',
        reviewerRole: 'finance_approver',
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LinkVersionConflictError);

    // The original candidate link row is untouched by the review decision —
    // entity_links itself is append-only; only entity_link_reviews records
    // the outcome.
    const after = await db.select().from(entityLinks).where(eq(entityLinks.id, linkId));
    expect(after[0]?.confidenceClass).toBe('candidate');
    expect(after[0]?.sourceNodeKey).toBe(before[0]?.sourceNodeKey);
    expect(after[0]?.version).toBe(before[0]?.version);

    const reviews = await db
      .select()
      .from(entityLinkReviews)
      .where(and(eq(entityLinkReviews.tenantId, 'ten_demo'), eq(entityLinkReviews.linkId, linkId)));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.reviewVersion).toBe(1);

    // Both entity_links and entity_link_reviews are append-only.
    await expect(
      pool.query(`update entity_links set review_status = 'not_required' where id = $1`, [linkId]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(`update entity_link_reviews set decision = 'confirmed' where link_id = $1`, [
        linkId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });
});

function createDb(pool: pg.Pool): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(pool, { schema });
}
