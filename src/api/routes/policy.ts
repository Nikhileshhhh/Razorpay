import type { FastifyInstance } from 'fastify';
import type { Database } from '../../config/db.js';
import {
  CaseIdParam,
  EvaluatePolicyRequest,
  PolicyDecisionResponse,
} from '../../contracts/api-endpoints.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import {
  evaluateCasePolicy,
  PolicyPlanVersionConflictError,
} from '../../modules/policy/policy-service.js';
import { PlanNotFoundError } from '../../modules/policy/plan-service.js';
import { problem } from './problem.js';

/** `POST /v1/cases/:id/evaluate-policy` (backend PRD §14.1, §12.2). */
export function registerPolicyRoutes(app: FastifyInstance, db: Database): void {
  app.post('/v1/cases/:id/evaluate-policy', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['case_manager']))) return;

    const params = CaseIdParam.safeParse(req.params);
    const body = EvaluatePolicyRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply
        .code(422)
        .send(problem(req, 'SCHEMA_INVALID', 'invalid policy evaluation request'));
    }

    try {
      const { record, plan } = await evaluateCasePolicy(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        planId: body.data.plan_id,
        expectedPlanVersion: body.data.expected_plan_version,
        actorId: req.identity!.userId,
      });
      return reply.code(200).send(
        PolicyDecisionResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: plan.version,
          data: record,
        }),
      );
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        return reply.code(422).send(problem(req, 'NOT_FOUND', 'plan not found'));
      }
      if (error instanceof PolicyPlanVersionConflictError) {
        return reply.code(409).send(problem(req, 'VERSION_CONFLICT', 'plan version conflict'));
      }
      throw error;
    }
  });
}
