import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/config/db-schema.js';
import { registerInvestigationRoutes } from '../../src/api/routes/investigations.js';
import { registerPolicyRoutes } from '../../src/api/routes/policy.js';
import { registerApprovalRoutes } from '../../src/api/routes/approvals.js';
import { registerActionRoutes } from '../../src/api/routes/actions.js';
import { registerCaseDetailRoutes } from '../../src/api/routes/case-details.js';
import { installSafeErrorHandler } from '../../src/api/safe-error-handler.js';
import { seedIdentity } from '../../src/modules/demo/seed-identity.js';
import { createMigratedTestDatabase, type TestDatabase } from './helpers/test-db.js';

const CASE_ID = 'case_api_b3';
const HASH = `sha256:${'a'.repeat(64)}`;

describe('B3 HTTP route auth, validation, tenant scope, and envelopes', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await seedIdentity(db);
    await db.insert(schema.memberships).values({
      id: 'mem_user_other_viewer_investigator',
      tenantId: 'ten_other',
      userId: 'user_other_viewer',
      role: 'investigator',
    });
    await db.insert(schema.economicSubjects).values({
      id: 'subject_api_b3',
      tenantId: 'ten_demo',
      subjectType: 'seller_allocation',
      subjectKey: 'order:api-b3:seller-1',
      amountMinor: 100n,
      currency: 'INR',
    });
    await db.insert(schema.expectations).values({
      id: 'expectation_api_b3',
      tenantId: 'ten_demo',
      subjectId: 'subject_api_b3',
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
      caseDedupeKey: 'dedupe_api_b3',
      subjectId: 'subject_api_b3',
      expectationId: 'expectation_api_b3',
      controlId: 'CTRL-01',
      lifecycleState: 'open',
      exposureAmountMinor: 91n,
      currency: 'INR',
      evidenceCoverage: 'complete',
      version: 0,
    });

    app = Fastify({ logger: false });
    installSafeErrorHandler(app);
    registerInvestigationRoutes(app, db);
    registerPolicyRoutes(app, db);
    registerApprovalRoutes(app, db);
    registerActionRoutes(app, db);
    registerCaseDetailRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.teardown();
  });

  const mutations = [
    {
      path: `/v1/cases/${CASE_ID}/investigations`,
      user: 'user_investigator',
      valid: { schema_version: '1.0', expected_case_version: 999 },
    },
    {
      path: `/v1/cases/${CASE_ID}/evaluate-policy`,
      user: 'user_investigator',
      valid: { schema_version: '1.0', plan_id: 'plan_missing', expected_plan_version: 1 },
    },
    {
      path: `/v1/cases/${CASE_ID}/request-approval`,
      user: 'user_investigator',
      valid: {
        schema_version: '1.0',
        plan_id: 'plan_missing',
        expected_case_version: 0,
        expected_plan_version: 1,
      },
    },
    {
      path: `/v1/cases/${CASE_ID}/approve`,
      user: 'user_approver',
      valid: {
        schema_version: '1.0',
        approval_id: 'approval_missing',
        decision_basis_hash: HASH,
      },
    },
    {
      path: `/v1/cases/${CASE_ID}/reject`,
      user: 'user_approver',
      valid: {
        schema_version: '1.0',
        approval_id: 'approval_missing',
        decision_basis_hash: HASH,
        reason: 'test rejection',
      },
    },
    {
      path: `/v1/cases/${CASE_ID}/request-more-evidence`,
      user: 'user_approver',
      valid: {
        schema_version: '1.0',
        approval_id: 'approval_missing',
        decision_basis_hash: HASH,
        reason: 'test evidence request',
      },
    },
    {
      path: `/v1/cases/${CASE_ID}/execute`,
      user: 'user_operator',
      valid: { schema_version: '1.0', plan_id: 'plan_missing', decision_basis_hash: HASH },
    },
  ] as const;

  it.each(mutations)('rejects missing identity on $path with a standard 401', async ({ path }) => {
    const response = await app.inject({ method: 'POST', url: path, payload: {} });
    expectSafeError(response, 401, 'TENANT_SCOPE_REQUIRED');
  });

  it.each(mutations)(
    'rejects a viewer without the mutation role on $path with a standard 403',
    async ({ path }) => {
      const response = await app.inject({
        method: 'POST',
        url: path,
        headers: { 'x-demo-user-id': 'user_viewer' },
        payload: {},
      });
      expectSafeError(response, 403, 'POLICY_DENIED');
    },
  );

  it.each(mutations)('rejects malformed strict input on $path', async ({ path, user }) => {
    const response = await app.inject({
      method: 'POST',
      url: path,
      headers: { 'x-demo-user-id': user },
      payload: { schema_version: '1.0', unexpected: true },
    });
    expectSafeError(response, 422, 'SCHEMA_INVALID');
  });

  it.each(mutations)(
    'accepts the required role through auth on $path and returns a typed domain error',
    async ({ path, user, valid }) => {
      const response = await app.inject({
        method: 'POST',
        url: path,
        headers: { 'x-demo-user-id': user },
        payload: valid,
      });
      expect([409, 422]).toContain(response.statusCode);
      expect(response.json()).toMatchObject({
        schema_version: '1.0',
        error: { retryable: false, details: { kind: 'none' } },
      });
    },
  );

  it('returns the persisted case version for a valid investigation request and 409 for stale input', async () => {
    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/cases/${CASE_ID}/investigations`,
      headers: { 'x-demo-user-id': 'user_investigator' },
      payload: { schema_version: '1.0', expected_case_version: 0 },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().resource_version).toBe(0);

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/cases/${CASE_ID}/investigations`,
      headers: { 'x-demo-user-id': 'user_investigator' },
      payload: { schema_version: '1.0', expected_case_version: 1 },
    });
    expectSafeError(stale, 409, 'VERSION_CONFLICT');
  });

  it('treats a cross-tenant case id as opaque/not found', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/cases/${CASE_ID}/investigations`,
      headers: { 'x-demo-user-id': 'user_other_viewer' },
      payload: { schema_version: '1.0' },
    });
    expectSafeError(response, 422, 'NOT_FOUND');
  });

  it('covers the B3 read routes and malformed approval-list query', async () => {
    const missing = await app.inject({ method: 'GET', url: '/v1/approvals' });
    expectSafeError(missing, 401, 'TENANT_SCOPE_REQUIRED');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toEqual([]);

    const malformed = await app.inject({
      method: 'GET',
      url: '/v1/approvals?limit=0',
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expectSafeError(malformed, 400, 'SCHEMA_INVALID');

    const view = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/control-loop`,
      headers: { 'x-demo-user-id': 'user_viewer' },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().data.case_id).toBe(CASE_ID);

    const crossTenant = await app.inject({
      method: 'GET',
      url: `/v1/cases/${CASE_ID}/control-loop`,
      headers: { 'x-demo-user-id': 'user_other_viewer' },
    });
    expectSafeError(crossTenant, 404, 'NOT_FOUND');
  });
});

function expectSafeError(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
): void {
  expect(response.statusCode).toBe(status);
  expect(response.json()).toMatchObject({
    schema_version: '1.0',
    error: { code, retryable: false, details: { kind: 'none' } },
  });
}
