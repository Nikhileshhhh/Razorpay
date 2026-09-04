import type { FastifyInstance } from 'fastify';
import type { Database } from '../../config/db.js';
import { CaseIdParam, ExecuteRequest, ActionResponse } from '../../contracts/api-endpoints.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import {
  reserveAction,
  ActionPlanNotFoundError,
  ActionBasisStaleError,
  ActionApprovalMissingError,
  ActionIdempotencyBodyConflictError,
  ActionEnvironmentDeniedError,
  getActionResourceVersion,
} from '../../modules/actions/action-service.js';
import { problem } from './problem.js';

/** `POST /v1/cases/:id/execute` (backend PRD §14.1, §12.4). */
export function registerActionRoutes(app: FastifyInstance, db: Database): void {
  app.post('/v1/cases/:id/execute', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['executor']))) return;

    const params = CaseIdParam.safeParse(req.params);
    const body = ExecuteRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid execute request'));
    }

    try {
      const action = await reserveAction(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        planId: body.data.plan_id,
        decisionBasisHash: body.data.decision_basis_hash,
        actorId: req.identity!.userId,
      });
      const resourceVersion = await getActionResourceVersion(
        db,
        req.identity!.tenantContext,
        action.action_id,
      );
      return reply.code(202).send(
        ActionResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: resourceVersion,
          data: action,
        }),
      );
    } catch (error) {
      if (error instanceof ActionPlanNotFoundError) {
        return reply.code(422).send(problem(req, 'NOT_FOUND', 'plan not found or not authorized'));
      }
      if (error instanceof ActionBasisStaleError) {
        return reply.code(409).send(problem(req, 'APPROVAL_STALE', 'decision basis is stale'));
      }
      if (error instanceof ActionApprovalMissingError) {
        return reply
          .code(403)
          .send(problem(req, 'APPROVAL_FORBIDDEN', 'no current approved approval'));
      }
      if (error instanceof ActionEnvironmentDeniedError) {
        return reply.code(403).send(problem(req, 'POLICY_DENIED', 'actions are disabled'));
      }
      if (error instanceof ActionIdempotencyBodyConflictError) {
        return reply
          .code(409)
          .send(
            problem(req, 'IDEMPOTENCY_BODY_CONFLICT', 'same idempotency key, different request'),
          );
      }
      throw error;
    }
  });
}
