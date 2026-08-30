import type { FastifyInstance } from 'fastify';
import type { Database } from '../../config/db.js';
import {
  CaseIdParam,
  InvestigationRequest,
  InvestigationAcceptedResponse,
} from '../../contracts/api-endpoints.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import {
  requestInvestigation,
  InvestigationCaseNotFoundError,
} from '../../modules/investigation/investigation-service.js';
import { CaseVersionConflictError } from '../../modules/cases/case-service.js';
import { problem } from './problem.js';

/** `POST /v1/cases/:id/investigations` (backend PRD §14.1). */
export function registerInvestigationRoutes(app: FastifyInstance, db: Database): void {
  app.post('/v1/cases/:id/investigations', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['investigator']))) return;

    const params = CaseIdParam.safeParse(req.params);
    const body = InvestigationRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid investigation request'));
    }

    try {
      const result = await requestInvestigation(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        expectedCaseVersion: body.data.expected_case_version,
        actorId: req.identity!.userId,
        actorRole: 'investigator',
      });
      return reply.code(202).send(
        InvestigationAcceptedResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: body.data.expected_case_version ?? 0,
          data: { investigation_id: result.requestId, status: 'accepted' },
        }),
      );
    } catch (error) {
      if (error instanceof InvestigationCaseNotFoundError) {
        return reply.code(422).send(problem(req, 'NOT_FOUND', 'case not found'));
      }
      if (error instanceof CaseVersionConflictError) {
        return reply.code(409).send(problem(req, 'VERSION_CONFLICT', 'case version conflict'));
      }
      throw error;
    }
  });
}
