import type { FastifyInstance } from 'fastify';
import type { Database } from '../../config/db.js';
import { getPool } from '../../config/db.js';
import type { Env } from '../../config/env.js';
import {
  DataHealthResponse,
  DemoAdvanceRequest,
  DemoAdvanceResponse,
  DemoResetRequest,
  DemoResetResponse,
  DemoStatusResponse,
  ImportAcceptedResponse,
  ImportRequest,
  OverviewResponse,
  ScenarioIdParam,
} from '../../contracts/api-endpoints.js';
import {
  advanceDemoScenario,
  DemoScenarioConflictError,
  enqueueDatasetImport,
  getDataHealth,
  getDemoStatus,
  getImportResult,
  getOverview,
} from '../../modules/demo/demo-service.js';
import { resetDemoDatabase } from '../../modules/demo/reset.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import { problem } from './problem.js';
import { PrototypeRateLimiter } from '../prototype-rate-limiter.js';
import {
  assertRegisteredDemoTenant,
  DemoTenantMismatchError,
} from '../../modules/demo/demo-tenant.js';

export function registerB4DemoRoutes(app: FastifyInstance, db: Database, env: Env): void {
  const limiter = new PrototypeRateLimiter(20, 60_000);
  app.post('/v1/imports', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['demo_operator']))) return;
    if (!allowMutation(limiter, req)) {
      return reply.code(429).send(problem(req, 'RATE_LIMITED', 'request rate exceeded', true));
    }
    const body = ImportRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid registered import'));
    }
    // Genuinely asynchronous (backend PRD §14.1): durably enqueue and
    // return immediately. The actual 500-record generation happens ONLY in
    // the worker (`process-import.v1`); this route never calls
    // `generateDemoDataset` — and therefore never adapter dispatch — itself.
    let imported = await getImportResult(db, req.identity!.tenantContext, body.data.seed_id);
    try {
      if (!imported || imported.status === 'pending') {
        await enqueueDatasetImport(db, req.identity!.tenantContext, body.data.seed_id);
        imported = await getImportResult(db, req.identity!.tenantContext, body.data.seed_id);
      }
    } catch (error) {
      if (error instanceof DemoTenantMismatchError) {
        return reply
          .code(403)
          .send(problem(req, 'TENANT_SCOPE_REQUIRED', 'demo tenant is not permitted'));
      }
      throw error;
    }
    if (!imported) throw new Error('registered import did not persist');
    const { resourceVersion, ...importData } = imported;
    return reply.code(imported.status === 'accepted' ? 200 : 202).send(
      ImportAcceptedResponse.parse({
        schema_version: '1.0',
        request_id: req.id,
        resource_version: resourceVersion,
        data: importData,
      }),
    );
  });

  app.get('/v1/overview', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const view = await getOverview(db, req.identity!.tenantContext);
    return reply
      .code(200)
      .send(OverviewResponse.parse({ schema_version: '1.0', request_id: req.id, data: view }));
  });

  app.get('/v1/data-health', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const view = await getDataHealth(db, req.identity!.tenantContext, env.MODEL_PROVIDER);
    return reply
      .code(200)
      .send(DataHealthResponse.parse({ schema_version: '1.0', request_id: req.id, data: view }));
  });

  app.get('/v1/demo/status', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const view = await getDemoStatus(db, req.identity!.tenantContext);
    return reply
      .code(200)
      .send(DemoStatusResponse.parse({ schema_version: '1.0', request_id: req.id, data: view }));
  });

  app.post('/v1/demo/reset', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['demo_operator']))) return;
    if (!allowMutation(limiter, req)) {
      return reply.code(429).send(problem(req, 'RATE_LIMITED', 'request rate exceeded', true));
    }
    const body = DemoResetRequest.safeParse(req.body);
    if (!body.success || !env.DATABASE_URL) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid demo reset'));
    }
    try {
      assertRegisteredDemoTenant(req.identity!.tenantContext);
    } catch (error) {
      if (error instanceof DemoTenantMismatchError) {
        return reply
          .code(403)
          .send(problem(req, 'TENANT_SCOPE_REQUIRED', 'demo tenant is not permitted'));
      }
      throw error;
    }
    const reset = await resetDemoDatabase(
      getPool(env.DATABASE_URL),
      db,
      env.MONEYTRACE_ENV,
      body.data.seed_id,
    );
    return reply.code(200).send(
      DemoResetResponse.parse({
        schema_version: '1.0',
        request_id: req.id,
        resource_version: reset.resourceVersion,
        data: { status: 'ok' },
      }),
    );
  });

  app.post('/v1/demo/scenarios/:id/advance', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['demo_operator']))) return;
    if (!allowMutation(limiter, req)) {
      return reply.code(429).send(problem(req, 'RATE_LIMITED', 'request rate exceeded', true));
    }
    const params = ScenarioIdParam.safeParse(req.params);
    const body = DemoAdvanceRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid scenario step'));
    }
    try {
      const advanced = await advanceDemoScenario(
        db,
        req.identity!.tenantContext,
        params.data.id,
        body.data.expected_step,
      );
      return reply.code(200).send(
        DemoAdvanceResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: advanced.version,
          data: { status: 'ok', step: advanced.step },
        }),
      );
    } catch (error) {
      if (error instanceof DemoScenarioConflictError) {
        return reply.code(409).send(problem(req, 'VERSION_CONFLICT', 'scenario step changed'));
      }
      if (error instanceof DemoTenantMismatchError) {
        return reply
          .code(403)
          .send(problem(req, 'TENANT_SCOPE_REQUIRED', 'demo tenant is not permitted'));
      }
      throw error;
    }
  });
}

function allowMutation(
  limiter: PrototypeRateLimiter,
  req: Parameters<typeof requireAnyRole>[0],
): boolean {
  return limiter.allow(
    `demo-mutation:${req.identity!.tenantContext.tenantId}:${req.identity!.userId}`,
  );
}
