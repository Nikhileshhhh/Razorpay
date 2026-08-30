import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../config/db.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import {
  listCases,
  getCaseSummary,
  InvalidCaseCursorError,
} from '../../modules/cases/case-queries.js';
import { getLatestInvestigation } from '../../modules/investigation/investigation-repository.js';
import { getCurrentPlan } from '../../modules/policy/plan-service.js';
import { getLatestPolicyDecision } from '../../modules/policy/policy-service.js';
import {
  CaseListResponse,
  CaseDetailResponse,
  ListCasesQuery,
  CaseIdParam,
} from '../../contracts/api-endpoints.js';

/**
 * Case query routes (backend PRD §14.1 `GET /v1/cases`, `GET /v1/cases/:id`).
 * Every response is validated against the SAME Zod schema used to generate
 * OpenAPI before being sent, so the route can never silently drift from the
 * documented contract.
 */
export function registerCaseRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/cases', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;

    const query = ListCasesQuery.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({
        schema_version: '1.0',
        error: {
          code: 'SCHEMA_INVALID',
          message: 'invalid query parameters',
          request_id: req.id,
          retryable: false,
          details: { kind: 'none' },
        },
      });
    }

    let page;
    try {
      page = await listCases(db, req.identity!.tenantContext, {
        state: query.data.state,
        controlId: query.data.control_id,
        minExposureMinor: query.data.min_exposure_minor
          ? BigInt(query.data.min_exposure_minor)
          : undefined,
        maxExposureMinor: query.data.max_exposure_minor
          ? BigInt(query.data.max_exposure_minor)
          : undefined,
        evidenceCoverage: query.data.evidence_coverage,
        ownerId: query.data.owner_id,
        policyStatus: query.data.policy_status,
        query: query.data.q,
        sort: query.data.sort,
        cursor: query.data.cursor,
        limit: query.data.limit ?? 50,
      });
    } catch (error) {
      if (error instanceof InvalidCaseCursorError) {
        return reply.code(400).send(schemaInvalid(req.id, 'invalid cursor'));
      }
      throw error;
    }

    const body = CaseListResponse.parse({
      schema_version: '1.0',
      request_id: randomUUID(),
      data: {
        items: page.items,
        page_info: { next_cursor: page.nextCursor, has_more: page.hasMore },
      },
    });
    return reply.code(200).send(body);
  });

  app.get('/v1/cases/:id', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;

    const params = CaseIdParam.safeParse(req.params);
    if (!params.success) {
      return reply.code(404).send(notFound(req.id));
    }

    const summary = await getCaseSummary(db, req.identity!.tenantContext, params.data.id);
    if (!summary) {
      return reply.code(404).send(notFound(req.id));
    }

    const ctx = req.identity!.tenantContext;
    const [investigation, plan, policyDecision] = await Promise.all([
      getLatestInvestigation(db, ctx, params.data.id),
      getCurrentPlan(db, ctx, params.data.id),
      getLatestPolicyDecision(db, ctx, params.data.id),
    ]);

    const body = CaseDetailResponse.parse({
      schema_version: '1.0',
      request_id: randomUUID(),
      data: {
        ...summary,
        finding_id: investigation?.finding?.finding_id ?? null,
        current_plan_id: plan?.id ?? null,
        latest_policy_decision_id: policyDecision?.decision_id ?? null,
        // Gate B4 populates a real graph-backed money path; B3 case rows
        // always have a subject/expectation so a path CAN be built once
        // provenance edges exist.
        money_path_available: true,
      },
    });
    return reply.code(200).send(body);
  });
}

function notFound(requestId: string) {
  return {
    schema_version: '1.0',
    error: {
      code: 'NOT_FOUND',
      message: 'case not found',
      request_id: requestId,
      retryable: false,
      details: { kind: 'none' },
    },
  };
}

function schemaInvalid(requestId: string, message: string) {
  return {
    schema_version: '1.0',
    error: {
      code: 'SCHEMA_INVALID',
      message,
      request_id: requestId,
      retryable: false,
      details: { kind: 'none' },
    },
  };
}
