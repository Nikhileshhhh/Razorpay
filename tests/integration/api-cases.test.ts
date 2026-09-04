import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import Fastify from 'fastify';
import { createMigratedTestDatabase, type TestDatabase } from './helpers/test-db.js';
import * as schema from '../../src/config/db-schema.js';
import { seedIdentity } from '../../src/modules/demo/seed-identity.js';
import { createTenantContext } from '../../src/modules/identity/tenant-context.js';
import { registerCaseRoutes } from '../../src/api/routes/cases.js';
import { registerCaseDetailRoutes } from '../../src/api/routes/case-details.js';
import { ensureSellerAllocationExpectation } from '../../src/modules/expectations/expectation-service.js';
import { evaluateCtrl01MissingTransfer } from '../../src/modules/invariants/ctrl-01-missing-transfer.js';
import { ingestAndProject } from '../../src/modules/ingestion/pipeline.js';
import { createEntityLink } from '../../src/modules/provenance/provenance-service.js';
import { sealEvidenceSet } from '../../src/modules/evidence/evidence-set-service.js';
import type { CanonicalEvent } from '../../src/contracts/events/canonical-event.js';

/**
 * End-to-end HTTP test for the case query routes: demo auth (401/403),
 * real persisted state (not mocked), and contract-shaped responses.
 */
describe('GET /v1/cases and /v1/cases/:id', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let realCaseId: string;
  let candidateLinkId: string;
  let smallerCaseId: string;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await seedIdentity(db);

    const ctx = createTenantContext('ten_demo', 'demo');
    const expectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: 'order:merchant-order-718:seller-42',
      orderCaptureAmountMinor: 50000000n,
    });
    const captureTime = new Date('2026-08-25T05:20:00Z');
    const result = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: expectation.subjectId,
      subjectKey: 'order:merchant-order-718:seller-42',
      expectationId: expectation.expectationId,
      expectationVersion: expectation.expectationVersion,
      sellerAllocationMinor: expectation.sellerAllocationMinor,
      captureEventTime: captureTime,
      graceSeconds: 3600,
      now: new Date(captureTime.getTime() + 7200_000),
    });
    if (!result.caseId) throw new Error('expected a case to be created');
    realCaseId = result.caseId;

    const event = {
      event_id: 'evt_case_api_evidence',
      tenant_id: 'ten_demo',
      source_system: 'RAZORPAY_TEST',
      source_account_id: null,
      source_event_id: 'source_case_api_evidence',
      source_event_type: 'payment.captured',
      event_type: 'PaymentCaptured',
      schema_version: '1.0',
      event_time: '2026-08-25T05:20:00Z',
      ingested_at: '2026-08-25T05:20:01Z',
      source_entity_version: 1,
      entity_references: { payment_id: 'pay_case_api' },
      economic_subject_hint: 'order:merchant-order-718:seller-42',
      amount_minor: '50000000',
      currency: 'INR',
      correlation_id: 'case_api',
      causation_id: null,
      payload_hash: `sha256:${'0'.repeat(64)}`,
      raw_payload_ref: 'db:ingest_events/pending',
      metadata: { environment: 'test' },
      data: {},
    } as CanonicalEvent;
    const projected = await ingestAndProject(db, ctx, {
      event,
      rawBytes: JSON.stringify(event),
      signatureStatus: 'verified',
    });
    if (projected.outcome !== 'accepted') throw new Error('case evidence was not accepted');
    const evidenceSet = await sealEvidenceSet(db, ctx, [
      { evidenceId: projected.eventId, role: 'candidate_basis' },
    ]);
    candidateLinkId = await createEntityLink(db, ctx, {
      edgeType: 'OBSERVED_IN_BANK',
      sourceNodeKey: 'order:merchant-order-718:seller-42',
      targetNodeKey: 'bank_credit:candidate_case_api',
      confidenceClass: 'candidate',
      observation: 'observed',
      resolverVersion: 'candidate-test-v1',
      evidenceSetHash: evidenceSet.hash,
      score: '0.75',
    });

    // A second, smaller-exposure case (created AFTER the first, so it also
    // has a later opened_at) so filters and every sort order have two
    // distinguishable, real rows to order/filter over.
    const smallerExpectation = await ensureSellerAllocationExpectation(db, ctx, {
      subjectKey: 'order:merchant-order-small:seller-9',
      orderCaptureAmountMinor: 1_000_000n,
    });
    const smallerCaptureTime = new Date('2026-08-25T06:20:00Z');
    const smallerResult = await evaluateCtrl01MissingTransfer(db, ctx, {
      subjectId: smallerExpectation.subjectId,
      subjectKey: 'order:merchant-order-small:seller-9',
      expectationId: smallerExpectation.expectationId,
      expectationVersion: smallerExpectation.expectationVersion,
      sellerAllocationMinor: smallerExpectation.sellerAllocationMinor,
      captureEventTime: smallerCaptureTime,
      graceSeconds: 3600,
      now: new Date(smallerCaptureTime.getTime() + 7200_000),
    });
    if (!smallerResult.caseId) throw new Error('expected a second, smaller case to be created');
    smallerCaseId = smallerResult.caseId;

    app = Fastify({ logger: false });
    registerCaseRoutes(app, db);
    registerCaseDetailRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.teardown();
  });

  it('returns 401 with no x-demo-user-id header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cases' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TENANT_SCOPE_REQUIRED');
  });

  it('returns 401 for an unknown demo user id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases',
      headers: { 'x-demo-user-id': 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a viewer can list cases and sees the real ₹4,55,000 case, exposure-descending', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema_version).toBe('1.0');
    expect(body.data.items.some((c: { case_id: string }) => c.case_id === realCaseId)).toBe(true);
    const found = body.data.items.find((c: { case_id: string }) => c.case_id === realCaseId);
    expect(found.exposure).toEqual({ amount_minor: '45500000', currency: 'INR' });
    expect(found.control_id).toBe('CTRL-01');
  });

  it('accepts a bounded numeric limit from the URL query string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases?state=open&sort=-exposure_amount_minor&limit=1',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toHaveLength(1);
    expect(res.json().data.page_info.has_more).toBe(true);
  });

  it('cross-tenant: the other-tenant user never sees ten_demo cases', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases',
      headers: { 'x-demo-user-id': 'user_other_viewer' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.items.some((c: { case_id: string }) => c.case_id === realCaseId)).toBe(false);
  });

  it('returns full case detail for a real case id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cases/${realCaseId}`,
      headers: { 'x-demo-user-id': 'user_investigator' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.case_id).toBe(realCaseId);
    expect(body.data.lifecycle_state).toBe('open');
  });

  it('returns 404 for an unknown case id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases/case_does_not_exist',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('filters by min_exposure_minor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases?min_exposure_minor=100000000',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.items.some((c: { case_id: string }) => c.case_id === realCaseId)).toBe(false);
  });

  it('rejects malformed list cursors instead of silently restarting pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases?cursor=not-a-valid-cursor',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SCHEMA_INVALID');
  });

  it('supports atomic assignment, append-only notes, evidence, money path, and candidate review', async () => {
    const assigned = await app.inject({
      method: 'POST',
      url: `/v1/cases/${realCaseId}/assign`,
      headers: { 'x-demo-user-id': 'user_investigator', 'content-type': 'application/json' },
      payload: { schema_version: '1.0', expected_case_version: 0, owner_id: 'user_investigator' },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({
      resource_version: 1,
      data: { case_id: realCaseId, owner_id: 'user_investigator' },
    });

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/cases/${realCaseId}/assign`,
      headers: { 'x-demo-user-id': 'user_investigator', 'content-type': 'application/json' },
      payload: { schema_version: '1.0', expected_case_version: 0, owner_id: null },
    });
    expect(stale.statusCode).toBe(409);

    const note = await app.inject({
      method: 'POST',
      url: `/v1/cases/${realCaseId}/notes`,
      headers: { 'x-demo-user-id': 'user_investigator', 'content-type': 'application/json' },
      payload: { schema_version: '1.0', expected_case_version: 1, body: 'TEST_ONLY_CASE_NOTE' },
    });
    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      resource_version: 2,
      data: { body: 'TEST_ONLY_CASE_NOTE' },
    });

    const notes = await app.inject({
      method: 'GET',
      url: `/v1/cases/${realCaseId}/notes`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(notes.statusCode).toBe(200);
    expect(notes.json().data.items).toHaveLength(1);

    const evidence = await app.inject({
      method: 'GET',
      url: `/v1/cases/${realCaseId}/evidence`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().data.items[0]).not.toHaveProperty('raw_payload');

    const viewerPath = await app.inject({
      method: 'GET',
      url: `/v1/cases/${realCaseId}/money-path`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(viewerPath.statusCode).toBe(200);
    expect(viewerPath.json().data.edges).not.toContainEqual(
      expect.objectContaining({ link_id: candidateLinkId }),
    );

    const decision = await app.inject({
      method: 'POST',
      url: `/v1/cases/${realCaseId}/links/${candidateLinkId}/decision`,
      headers: { 'x-demo-user-id': 'user_investigator', 'content-type': 'application/json' },
      payload: {
        schema_version: '1.0',
        expected_case_version: 2,
        expected_link_version: 0,
        decision: 'confirm',
        reason: 'TEST_ONLY_DIRECT_INVESTIGATOR_CONFIRMATION',
      },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({ resource_version: 3, data: { link_version: 1 } });
    const originalCandidate = await db
      .select()
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.id, candidateLinkId));
    expect(originalCandidate[0]).toMatchObject({
      confidenceClass: 'candidate',
      reviewStatus: 'unreviewed',
      version: 0,
    });
    const reviews = await db
      .select()
      .from(schema.entityLinkReviews)
      .where(eq(schema.entityLinkReviews.linkId, candidateLinkId));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ decision: 'confirmed', reviewVersion: 1 });

    const investigatorPath = await app.inject({
      method: 'GET',
      url: `/v1/cases/${realCaseId}/money-path`,
      headers: { 'x-demo-user-id': 'user_investigator' },
    });
    expect(investigatorPath.statusCode).toBe(200);
    expect(investigatorPath.json().data.edges).toContainEqual(
      expect.objectContaining({ link_id: candidateLinkId, confidence_class: 'asserted' }),
    );
  });

  it('sorts ascending by exposure when sort=exposure_amount_minor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases?sort=exposure_amount_minor',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(ids.indexOf(smallerCaseId)).toBeLessThan(ids.indexOf(realCaseId));
  });

  it('sorts descending by exposure by default (-exposure_amount_minor)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cases?sort=-exposure_amount_minor',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(ids.indexOf(realCaseId)).toBeLessThan(ids.indexOf(smallerCaseId));
  });

  it('sorts by opened_at ascending and descending', async () => {
    const asc = await app.inject({
      method: 'GET',
      url: '/v1/cases?sort=opened_at',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(asc.statusCode).toBe(200);
    const ascIds = asc.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(ascIds.indexOf(realCaseId)).toBeLessThan(ascIds.indexOf(smallerCaseId));

    const desc = await app.inject({
      method: 'GET',
      url: '/v1/cases?sort=-opened_at',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(desc.statusCode).toBe(200);
    const descIds = desc.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(descIds.indexOf(smallerCaseId)).toBeLessThan(descIds.indexOf(realCaseId));
  });

  it('filters by state, control_id, max_exposure_minor, and free-text query', async () => {
    const byState = await app.inject({
      method: 'GET',
      url: '/v1/cases?state=open',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(byState.statusCode).toBe(200);
    const stateIds = byState.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(stateIds).toContain(realCaseId);
    expect(stateIds).toContain(smallerCaseId);

    const byControl = await app.inject({
      method: 'GET',
      url: '/v1/cases?control_id=CTRL-01',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(byControl.statusCode).toBe(200);
    expect(
      byControl.json().data.items.every((c: { control_id: string }) => c.control_id === 'CTRL-01'),
    ).toBe(true);

    const byMaxExposure = await app.inject({
      method: 'GET',
      url: '/v1/cases?max_exposure_minor=2000000',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(byMaxExposure.statusCode).toBe(200);
    const maxIds = byMaxExposure.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(maxIds).toContain(smallerCaseId);
    expect(maxIds).not.toContain(realCaseId);

    const byQuery = await app.inject({
      method: 'GET',
      url: '/v1/cases?q=order%3Amerchant-order-small',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(byQuery.statusCode).toBe(200);
    const queryIds = byQuery.json().data.items.map((c: { case_id: string }) => c.case_id);
    expect(queryIds).toContain(smallerCaseId);
    expect(queryIds).not.toContain(realCaseId);
  });

  it('returns 403 (not 401) when an authenticated viewer lacks the role a mutation requires', async () => {
    const assign = await app.inject({
      method: 'POST',
      url: `/v1/cases/${smallerCaseId}/assign`,
      headers: { 'x-demo-user-id': 'user_viewer', 'content-type': 'application/json' },
      payload: { schema_version: '1.0', expected_case_version: 0, owner_id: 'user_viewer' },
    });
    expect(assign.statusCode).toBe(403);
    expect(assign.json().error.code).toBe('POLICY_DENIED');

    const note = await app.inject({
      method: 'POST',
      url: `/v1/cases/${smallerCaseId}/notes`,
      headers: { 'x-demo-user-id': 'user_viewer', 'content-type': 'application/json' },
      payload: { schema_version: '1.0', expected_case_version: 0, body: 'should be forbidden' },
    });
    expect(note.statusCode).toBe(403);

    const decision = await app.inject({
      method: 'POST',
      url: `/v1/cases/${smallerCaseId}/links/${candidateLinkId}/decision`,
      headers: { 'x-demo-user-id': 'user_viewer', 'content-type': 'application/json' },
      payload: {
        schema_version: '1.0',
        expected_case_version: 0,
        expected_link_version: 0,
        decision: 'confirm',
        reason: 'should be forbidden',
      },
    });
    expect(decision.statusCode).toBe(403);
  });

  it('enforces the money-path link-load limit (422) instead of returning an unbounded graph', async () => {
    // `buildMoneyPath` loads every entity_link for the tenant within its
    // lookback window BEFORE traversing, and rejects if that raw set exceeds
    // MAX_LINKS_LOADED (500) — a real, DB-backed reproduction, not a mock.
    await pool.query(
      `insert into entity_links (id, tenant_id, edge_type, source_node_key, target_node_key, confidence_class, resolver_version, evidence_set_hash)
       select
         'link_traversal_' || g,
         'ten_demo',
         'DERIVED_FROM',
         'synthetic_node:traversal_src_' || g,
         'synthetic_node:traversal_dst_' || g,
         'verified',
         'traversal-limit-v1-' || g,
         'sha256:traversal-limit-fixture'
       from generate_series(1, 501) as g`,
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/cases/${smallerCaseId}/money-path`,
      headers: { 'x-demo-user-id': 'user_investigator' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('SCHEMA_INVALID');
  });
});
