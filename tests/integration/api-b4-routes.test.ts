import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/config/db-schema.js';
import { registerB4CoreRoutes } from '../../src/api/routes/b4-core.js';
import { registerB4DemoRoutes } from '../../src/api/routes/b4-demo.js';
import { installSafeErrorHandler } from '../../src/api/safe-error-handler.js';
import { seedIdentity } from '../../src/modules/demo/seed-identity.js';
import { seedSourceConnections } from '../../src/modules/demo/seed-sources.js';
import { seedPolicyBundle } from '../../src/modules/policy/policy-bundle.js';
import { seedVerificationContracts } from '../../src/modules/verification/verification-contracts-seed.js';
import { EnvSchema, type Env } from '../../src/config/env.js';
import { createMigratedTestDatabase, type TestDatabase } from './helpers/test-db.js';
import { canonicalJsonStringify } from '../../src/config/hashing.js';
import { buildOpenApiDocument } from '../../src/contracts/openapi.js';

/**
 * Backend PRD §14, §19.3: every B4 route validates against the same
 * authoritative schema used by OpenAPI, enforces demo identity/role at the
 * HTTP boundary, and never leaks a raw DB/provider error. This is real
 * request-level (`inject`) coverage — previously ZERO existed for any B4
 * route. Seeding is deliberately light (identity/sources/policy/contracts +
 * a few direct fixture rows), not a full `resetDemoDatabase()`, since these
 * tests exercise the route boundary, not the measured-dataset pipeline
 * (covered by `tests/integration/db/b4-manifest.test.ts`).
 */
describe('B4 HTTP route auth, validation, tenant scope, and envelopes', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let env: Env;

  const CASE_ID = 'case_api_b4';
  const ACTION_ID = 'action_api_b4';
  const CLAIM_ID = 'claim_api_b4';

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    env = EnvSchema.parse({ MONEYTRACE_ENV: 'test', NODE_ENV: 'test' });

    await seedIdentity(db);
    await seedSourceConnections(db);
    await seedPolicyBundle(db);
    await seedVerificationContracts(db);
    // `user_other_viewer` already has the `viewer` role in `ten_other` from
    // `seedIdentity` — reused here as the cross-tenant negative-test actor.

    // A minimal real case (so verification/audit GETs have something to
    // return) plus a minimal real action reaching VERIFICATION_PENDING.
    await db.insert(schema.economicSubjects).values({
      id: 'subject_api_b4',
      tenantId: 'ten_demo',
      subjectType: 'seller_allocation',
      subjectKey: 'order:api-b4:seller-1',
      amountMinor: 100n,
      currency: 'INR',
    });
    await db.insert(schema.expectations).values({
      id: 'expectation_api_b4',
      tenantId: 'ten_demo',
      subjectId: 'subject_api_b4',
      version: 1,
      ruleId: 'seller_allocation_rule',
      ruleVersion: 'contract_v4',
      expectedAmountMinor: 91n,
      currency: 'INR',
      expectedTerminalState: 'bank_credit_verified',
    });
    await db.insert(schema.cases).values({
      id: CASE_ID,
      tenantId: 'ten_demo',
      caseDedupeKey: 'dedupe_api_b4',
      subjectId: 'subject_api_b4',
      expectationId: 'expectation_api_b4',
      controlId: 'CTRL-01',
      lifecycleState: 'executing',
      exposureAmountMinor: 91n,
      currency: 'INR',
      evidenceCoverage: 'complete',
      version: 0,
    });
    await db.insert(schema.plans).values({
      id: 'plan_api_b4',
      tenantId: 'ten_demo',
      caseId: CASE_ID,
      templateId: 'SIMULATE_TRANSFER_REMEDIATION',
      version: 1,
      status: 'AUTHORIZED',
      isCurrent: true,
      parameters: { tool_id: 'SIMULATE_TRANSFER_REMEDIATION', economic_subject: 'subject_api_b4' },
      planHash: `sha256:${'b'.repeat(64)}`,
      authorityLevel: 'L2',
      maximumAmountImpactMinor: 91n,
      currency: 'INR',
    });
    await db.insert(schema.actions).values({
      id: ACTION_ID,
      tenantId: 'ten_demo',
      caseId: CASE_ID,
      planId: 'plan_api_b4',
      toolId: 'SIMULATE_TRANSFER_REMEDIATION',
      idempotencyKey: 'idempotency_api_b4',
      requestHash: `sha256:${'c'.repeat(64)}`,
      status: 'VERIFICATION_PENDING',
    });
    await db.insert(schema.verificationRuns).values({
      id: 'verification_run_api_b4',
      tenantId: 'ten_demo',
      actionId: ACTION_ID,
      contractKey: 'TRANSFER_REMEDIATION_VERIFICATION',
      contractVersion: 'v1',
      status: 'VERIFICATION_PENDING',
      evidenceIds: [],
      version: 0,
    });
    await db.insert(schema.verificationRunHeads).values({
      tenantId: 'ten_demo',
      actionId: ACTION_ID,
      currentRunId: 'verification_run_api_b4',
      contractKey: 'TRANSFER_REMEDIATION_VERIFICATION',
      contractVersion: 'v1',
      status: 'VERIFICATION_PENDING',
      version: 0,
    });
    await db.insert(schema.auditEntries).values({
      id: 'audit_api_b4_action_reserved',
      tenantId: 'ten_demo',
      artifactType: 'ACTION',
      artifactId: ACTION_ID,
      actorRole: 'worker',
      details: { operation: 'action_reserved', case_id: CASE_ID },
    });

    // A real accepted, non-quarantined, signature-verified evidence row for
    // the agent-results POST test's non-empty `evidence_refs` (Gate B4
    // remediation: claims must bind to real evidence, backend PRD §13.3).
    await db.insert(schema.ingestEvents).values({
      id: 'evt_api_b4_capture',
      tenantId: 'ten_demo',
      sourceSystem: 'SYNTHETIC_RAZORPAY_FIXTURE',
      sourceAccountId: 'acct_demo_razorpay_fixture',
      sourceEventId: 'evt_api_b4_capture',
      sourceEventType: 'PaymentCaptured',
      eventType: 'PaymentCaptured',
      eventTime: new Date('2026-08-25T01:00:00.000Z'),
      payloadHash: `sha256:${'f'.repeat(64)}`,
      rawPayload: { note: 'api-b4 route test fixture' },
      rawBytes: Buffer.from('api-b4-route-test-fixture'),
      rawRepresentation: 'exact_bytes',
      signatureStatus: 'verified',
      dedupeStatus: 'unique',
      quarantineStatus: 'none',
      fallbackDedupeKey: 'ten_demo|SYNTHETIC_RAZORPAY_FIXTURE|evt_api_b4_capture',
      amountMinor: 1_000_000n,
      currency: 'INR',
      economicSubjectHint: 'order:api-b4:seller-1',
    });

    // A minimal real agent claim + evaluation head for the GET-by-id route.
    await db.insert(schema.agentResultClaims).values({
      id: CLAIM_ID,
      tenantId: 'ten_demo',
      externalAgentId: 'demo_agent_api_b4',
      externalClaimId: 'external_claim_api_b4',
      economicSubjectKey: 'order:api-b4:seller-1',
      claimedAmountMinor: 1_000_000n,
      currency: 'INR',
      resultType: 'RECOVERY',
      attributionMethod: 'CORRELATED',
      claimTime: new Date('2026-08-25T01:00:00.000Z'),
      evidenceRefs: [{ evidence_id: 'evt_api_b4_capture', evidence_type: 'captured_payment' }],
      requestHash: `sha256:${'d'.repeat(64)}`,
    });
    await db.insert(schema.claimEvaluations).values({
      id: 'claim_evaluation_api_b4',
      tenantId: 'ten_demo',
      claimId: CLAIM_ID,
      evaluationVersion: 0,
      status: 'PENDING',
    });
    await db.insert(schema.claimEvaluationHeads).values({
      tenantId: 'ten_demo',
      claimId: CLAIM_ID,
      currentEvaluationId: 'claim_evaluation_api_b4',
      status: 'PENDING',
      evaluationVersion: 0,
    });

    // A minimal demo manifest + scenario state so overview/data-health/status
    // return real (if mostly-zero) computed data rather than 500/throw.
    await db.insert(schema.demoSeedManifest).values({
      id: 'manifest_api_b4',
      tenantId: 'ten_demo',
      seedId: 'moneytrace_demo_v1',
      manifestHash: `sha256:${'e'.repeat(64)}`,
      metrics: {
        records_total: 0,
        records_matched: 0,
        unresolved_cases: 0,
        unsafe_candidate_matches_blocked: 0,
        unresolved_exposure: '0',
        verified_restored: '0',
        duplicate_collection_prevented: '0',
        reversed_recovery: '0',
      },
    });
    await db.insert(schema.demoScenarioState).values({
      id: 'scenario_state_claim-reversal',
      tenantId: 'ten_demo',
      scenarioId: 'claim-reversal',
      currentStep: 0,
      version: 0,
    });

    app = Fastify({ logger: false });
    installSafeErrorHandler(app);
    registerB4CoreRoutes(app, db, env);
    registerB4DemoRoutes(app, db, env);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.teardown();
  });

  // -- GET /v1/cases/:id/verification --------------------------------------

  it('verification GET: 401 without identity, 403 for a role without viewer, 200 for a viewer', async () => {
    const noAuth = await app.inject({ method: 'GET', url: `/v1/cases/${CASE_ID}/verification` });
    expect(noAuth.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/verification`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.data.action_status).toBe('VERIFICATION_PENDING');
  });

  it('verification GET: cross-tenant opaque 404, unknown case 404', async () => {
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/verification`,
      headers: { 'x-demo-user-id': 'user_other_viewer' },
    });
    expect(crossTenant.statusCode).toBe(404);

    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/cases/case_does_not_exist/verification',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  // -- POST /v1/actions/:id/verification-checks ----------------------------

  it('verification-checks POST: 401, 403 (viewer-only role forbidden), 422 malformed body, 404 unknown action', async () => {
    const noAuth = await app.inject({
      method: 'POST',
      url: `/v1/actions/${ACTION_ID}/verification-checks`,
      payload: {},
    });
    expect(noAuth.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/actions/${ACTION_ID}/verification-checks`,
      headers: { 'x-demo-user-id': 'user_viewer' },
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);

    const malformed = await app.inject({
      method: 'POST',
      url: `/v1/actions/${ACTION_ID}/verification-checks`,
      headers: { 'x-demo-user-id': 'user_operator' },
      payload: { not_a_registered_field: true },
    });
    expect(malformed.statusCode).toBe(422);

    const unknownAction = await app.inject({
      method: 'POST',
      url: '/v1/actions/action_does_not_exist/verification-checks',
      headers: { 'x-demo-user-id': 'user_operator' },
      payload: { schema_version: '1.0' },
    });
    expect(unknownAction.statusCode).toBe(404);
  });

  // -- GET /v1/cases/:id/audit and /audit/export ---------------------------

  it('audit GET: 401, 400 invalid cursor, 200 valid, and export requires auditor/platform_operator', async () => {
    const noAuth = await app.inject({ method: 'GET', url: `/v1/cases/${CASE_ID}/audit` });
    expect(noAuth.statusCode).toBe(401);

    const badCursor = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/audit?cursor=not-a-valid-cursor-token-at-all`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    // Passes the cursor charset check but fails base64url/BigInt decoding
    // (`decodeCursor` in `audit-service.ts`) — an exact 400, not a guess.
    expect(badCursor.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/audit`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.items.length).toBeGreaterThan(0);

    const exportForbidden = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/audit/export`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(exportForbidden.statusCode).toBe(403);

    const exportOk = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/audit/export`,
      headers: { 'x-demo-user-id': 'user_operator' },
    });
    expect(exportOk.statusCode).toBe(200);
    expect(exportOk.headers['x-moneytrace-content-sha256']).toBeTruthy();
    expect(exportOk.json().data.content_sha256).toBe(
      exportOk.headers['x-moneytrace-content-sha256'],
    );
  });

  // -- POST /v1/agent-results (connector-authenticated) --------------------

  it('agent-results POST: 401 without source auth, 422 malformed claim after valid HMAC, 201/200 on a valid claim', async () => {
    const noAuth = await app.inject({
      method: 'POST',
      url: '/v1/agent-results',
      payload: Buffer.from('{}'),
      headers: { 'content-type': 'application/json' },
    });
    expect(noAuth.statusCode).toBe(401);

    const secret = 'TEST_ONLY_synthetic_hmac_secret_do_not_use_in_prod';
    const malformedBytes = Buffer.from('{"not":"a valid claim"}', 'utf8');
    const malformedSig = createHmac('sha256', secret).update(malformedBytes).digest('hex');
    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/agent-results',
      payload: malformedBytes,
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-account': 'acct_demo_agent',
        'x-moneytrace-signature': malformedSig,
      },
    });
    // Signature is valid over these exact bytes and the account is
    // registered, so authentication succeeds; the body fails
    // `AgentResultClaim` schema validation — an exact 422, not a guess
    // between auth and schema failure.
    expect(malformed.statusCode).toBe(422);

    const claim = {
      schema_version: '1.0',
      external_claim_id: 'api_b4_new_claim',
      external_agent_id: 'demo_agent',
      tenant_id: 'ten_demo',
      economic_subject: 'order:api-b4:seller-1',
      claimed_amount: { amount_minor: '1000000', currency: 'INR' },
      result_type: 'RECOVERY',
      attribution_method: 'CORRELATED',
      correlation_id: 'api_b4_claim',
      claim_time: '2026-08-25T01:10:00.000Z',
      evidence_time: '2026-08-25T01:00:00.000Z',
      evidence_refs: [{ evidence_id: 'evt_api_b4_capture', evidence_type: 'captured_payment' }],
    };
    const raw = Buffer.from(canonicalJsonStringify(claim), 'utf8');
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/agent-results',
      payload: raw,
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-account': 'acct_demo_agent',
        'x-moneytrace-signature': sig,
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().data.status).toBe('PENDING');

    const competingClaim = { ...claim, external_claim_id: 'api_b4_competing_claim' };
    const competingRaw = Buffer.from(canonicalJsonStringify(competingClaim), 'utf8');
    const competingSig = createHmac('sha256', secret).update(competingRaw).digest('hex');
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/agent-results',
      payload: competingRaw,
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-account': 'acct_demo_agent',
        'x-moneytrace-signature': competingSig,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('AGENT_ATTRIBUTION_CONFLICT');
  });

  it('agent-results GET: 401, 404 unknown, 200 known claim', async () => {
    const noAuth = await app.inject({ method: 'GET', url: `/v1/agent-results/${CLAIM_ID}` });
    expect(noAuth.statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/agent-results/claim_does_not_exist',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(unknown.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'GET',
      url: `/v1/agent-results/${CLAIM_ID}`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.claim.external_claim_id).toBe('external_claim_api_b4');
  });

  // -- /v1/imports, /v1/overview, /v1/data-health, /v1/demo/status ---------

  it('imports POST: 401, 403 for a non-demo-operator, 422 malformed body', async () => {
    const noAuth = await app.inject({ method: 'POST', url: '/v1/imports', payload: {} });
    expect(noAuth.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { 'x-demo-user-id': 'user_viewer' },
      payload: { schema_version: '1.0', seed_id: 'moneytrace_demo_v1', confirm: true },
    });
    expect(forbidden.statusCode).toBe(403);

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { 'x-demo-user-id': 'user_operator' },
      payload: { schema_version: '1.0', seed_id: 'not_a_registered_seed', confirm: true },
    });
    expect(malformed.statusCode).toBe(422);

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { 'x-demo-user-id': 'user_operator' },
      payload: { schema_version: '1.0', seed_id: 'moneytrace_demo_v1', confirm: true },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().resource_version).toBe(0);
    expect(accepted.json().data.status).toBe('pending');
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { 'x-demo-user-id': 'user_operator' },
      payload: { schema_version: '1.0', seed_id: 'moneytrace_demo_v1', confirm: true },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().resource_version).toBe(0);
  });

  it('overview/data-health/demo-status GET: 401 without identity, 403 for a role without viewer, 200 for a viewer', async () => {
    for (const path of ['/v1/overview', '/v1/data-health', '/v1/demo/status']) {
      const noAuth = await app.inject({ method: 'GET', url: path });
      expect(noAuth.statusCode, path).toBe(401);

      const ok = await app.inject({
        method: 'GET',
        url: path,
        headers: { 'x-demo-user-id': 'user_viewer' },
      });
      expect(ok.statusCode, path).toBe(200);
    }
  });

  it('demo reset/advance POST: 401 without identity, 403 for a non-demo-operator', async () => {
    const noAuthReset = await app.inject({ method: 'POST', url: '/v1/demo/reset', payload: {} });
    expect(noAuthReset.statusCode).toBe(401);

    const forbiddenReset = await app.inject({
      method: 'POST',
      url: '/v1/demo/reset',
      headers: { 'x-demo-user-id': 'user_viewer' },
      payload: { schema_version: '1.0', seed_id: 'moneytrace_demo_v1', confirm: true },
    });
    expect(forbiddenReset.statusCode).toBe(403);

    const noAuthAdvance = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/claim-reversal/advance',
      payload: {},
    });
    expect(noAuthAdvance.statusCode).toBe(401);

    const forbiddenAdvance = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/claim-reversal/advance',
      headers: { 'x-demo-user-id': 'user_viewer' },
      payload: { schema_version: '1.0', expected_step: 0 },
    });
    expect(forbiddenAdvance.statusCode).toBe(403);
  });

  it('demo advance: unknown scenario is a safe conflict, not a 500', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/unregistered-scenario/advance',
      headers: { 'x-demo-user-id': 'user_operator' },
      payload: { schema_version: '1.0', expected_step: 0 },
    });
    expect(unknown.statusCode).toBe(409);
  });

  // -- Runtime <-> OpenAPI parity for the B4 route inventory ----------------

  it('every B4 route registered above appears in the generated OpenAPI document', () => {
    const document = buildOpenApiDocument();
    const paths = Object.keys(document.paths ?? {});
    const requiredTemplates = [
      '/v1/cases/{id}/verification',
      '/v1/actions/{id}/verification-checks',
      '/v1/cases/{id}/audit',
      '/v1/cases/{id}/audit/export',
      '/v1/agent-results',
      '/v1/agent-results/{id}',
      '/v1/imports',
      '/v1/overview',
      '/v1/data-health',
      '/v1/demo/status',
      '/v1/demo/reset',
      '/v1/demo/scenarios/{id}/advance',
    ];
    for (const template of requiredTemplates) {
      const found = paths.some(
        (path) => path === template || path.replace(/:\w+/g, (m) => `{${m.slice(1)}}`) === template,
      );
      expect(found, `expected OpenAPI to document ${template}, got: ${paths.join(', ')}`).toBe(
        true,
      );
    }
  });
});
