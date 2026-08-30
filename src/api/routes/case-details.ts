import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../config/db.js';
import {
  AddCaseNoteRequest,
  AssignCaseRequest,
  CaseAssignmentResponse,
  CaseIdParam,
  CaseLinkParam,
  CaseNoteListResponse,
  CaseNoteResponse,
  CaseTimelineQuery,
  ControlLoopResponse,
  EvidenceTimelineResponse,
  LinkDecisionRequest,
  LinkDecisionResponse,
  MoneyPathResponse,
} from '../../contracts/api-endpoints.js';
import { buildControlLoopView } from '../../modules/cases/control-loop-service.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import {
  buildMoneyPath,
  MoneyPathLimitError,
} from '../../modules/provenance/money-path-service.js';
import {
  appendCaseNote,
  assignCase,
  CaseOperationNotFoundError,
  decideCandidateLink,
  listCaseEvidence,
  listCaseNotes,
} from '../../modules/cases/case-operations.js';
import { CaseVersionConflictError } from '../../modules/cases/case-service.js';

export function registerCaseDetailRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/cases/:id/money-path', async (req, reply) => {
    if (!(await viewer(db, req, reply))) return;
    const params = CaseIdParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    try {
      const includeCandidates = req.identity!.roles.includes('investigator');
      const path = await buildMoneyPath(
        db,
        req.identity!.tenantContext,
        params.data.id,
        includeCandidates,
      );
      if (!path) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
      return reply
        .code(200)
        .send(MoneyPathResponse.parse({ schema_version: '1.0', request_id: req.id, data: path }));
    } catch (error) {
      if (error instanceof MoneyPathLimitError) {
        return reply
          .code(422)
          .send(problem(req, 'SCHEMA_INVALID', 'money path traversal limit exceeded'));
      }
      throw error;
    }
  });

  app.get('/v1/cases/:id/evidence', async (req, reply) => {
    if (!(await viewer(db, req, reply))) return;
    const params = CaseIdParam.safeParse(req.params);
    const query = CaseTimelineQuery.safeParse(req.query);
    if (!params.success) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    if (!query.success)
      return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid timeline query'));
    try {
      const page = await listCaseEvidence(
        db,
        req.identity!.tenantContext,
        params.data.id,
        query.data.cursor,
        query.data.limit ?? 50,
      );
      if (!page) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
      return reply.code(200).send(
        EvidenceTimelineResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          data: {
            items: page.items,
            page_info: { next_cursor: page.nextCursor, has_more: page.hasMore },
          },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid timeline cursor') {
        return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid cursor'));
      }
      throw error;
    }
  });

  app.get('/v1/cases/:id/notes', async (req, reply) => {
    if (!(await viewer(db, req, reply))) return;
    const params = CaseIdParam.safeParse(req.params);
    const query = CaseTimelineQuery.safeParse(req.query);
    if (!params.success) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    if (!query.success)
      return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid timeline query'));
    try {
      const page = await listCaseNotes(
        db,
        req.identity!.tenantContext,
        params.data.id,
        query.data.cursor,
        query.data.limit ?? 50,
      );
      if (!page) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
      return reply.code(200).send(
        CaseNoteListResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          data: {
            items: page.items,
            page_info: { next_cursor: page.nextCursor, has_more: page.hasMore },
          },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid timeline cursor') {
        return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid cursor'));
      }
      throw error;
    }
  });

  app.get('/v1/cases/:id/control-loop', async (req, reply) => {
    if (!(await viewer(db, req, reply))) return;
    const params = CaseIdParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    const view = await buildControlLoopView(db, req.identity!.tenantContext, params.data.id);
    if (!view) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    return reply
      .code(200)
      .send(ControlLoopResponse.parse({ schema_version: '1.0', request_id: req.id, data: view }));
  });

  app.post('/v1/cases/:id/assign', async (req, reply) => {
    if (!(await authenticatedRole(db, req, reply, ['case_manager']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const body = AssignCaseRequest.safeParse(req.body);
    if (!params.success || !body.success)
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid assignment request'));
    try {
      const result = await assignCase(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        ownerId: body.data.owner_id,
        expectedVersion: body.data.expected_case_version,
        actorId: req.identity!.userId,
        actorRole: 'case_manager',
      });
      return reply.code(200).send(
        CaseAssignmentResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: result.version,
          data: { case_id: params.data.id, owner_id: result.ownerId },
        }),
      );
    } catch (error) {
      return mutationError(req, reply, error);
    }
  });

  app.post('/v1/cases/:id/notes', async (req, reply) => {
    if (!(await authenticatedRole(db, req, reply, ['investigator', 'case_manager']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const body = AddCaseNoteRequest.safeParse(req.body);
    if (!params.success || !body.success)
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid note request'));
    try {
      const result = await appendCaseNote(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        body: body.data.body,
        expectedVersion: body.data.expected_case_version,
        authorId: req.identity!.userId,
        actorRole: req.identity!.roles.includes('investigator') ? 'investigator' : 'case_manager',
      });
      return reply.code(201).send(
        CaseNoteResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: result.version,
          data: {
            note_id: result.noteId,
            case_id: params.data.id,
            author_id: req.identity!.userId,
            body: body.data.body,
            created_at: result.createdAt.toISOString(),
            case_version: result.version,
          },
        }),
      );
    } catch (error) {
      return mutationError(req, reply, error);
    }
  });

  app.post('/v1/cases/:id/links/:linkId/decision', async (req, reply) => {
    if (!(await authenticatedRole(db, req, reply, ['investigator']))) return;
    const params = CaseLinkParam.safeParse(req.params);
    const body = LinkDecisionRequest.safeParse(req.body);
    if (!params.success || !body.success)
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid link decision'));
    try {
      const result = await decideCandidateLink(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        linkId: params.data.linkId,
        expectedCaseVersion: body.data.expected_case_version,
        expectedLinkVersion: body.data.expected_link_version,
        decision: body.data.decision,
        reason: body.data.reason,
        actorId: req.identity!.userId,
        actorRole: 'investigator',
      });
      return reply.code(200).send(
        LinkDecisionResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: result.caseVersion,
          data: {
            case_id: params.data.id,
            link_id: params.data.linkId,
            decision: body.data.decision,
            link_version: result.linkVersion,
          },
        }),
      );
    } catch (error) {
      return mutationError(req, reply, error);
    }
  });
}

async function viewer(
  db: Database,
  req: FastifyRequest,
  reply: Parameters<typeof requireDemoIdentity>[2],
) {
  return authenticatedRole(db, req, reply, ['viewer']);
}

async function authenticatedRole(
  db: Database,
  req: FastifyRequest,
  reply: Parameters<typeof requireDemoIdentity>[2],
  roles: Parameters<typeof requireAnyRole>[2],
) {
  if (!(await requireDemoIdentity(db, req, reply))) return false;
  return requireAnyRole(req, reply, roles);
}

function mutationError(
  req: FastifyRequest,
  reply: Parameters<typeof requireDemoIdentity>[2],
  error: unknown,
) {
  if (error instanceof CaseVersionConflictError)
    return reply.code(409).send(problem(req, 'VERSION_CONFLICT', 'resource version conflict'));
  if (error instanceof CaseOperationNotFoundError)
    return reply.code(422).send(problem(req, 'NOT_FOUND', 'operation target not found'));
  throw error;
}

function problem(
  req: FastifyRequest,
  code: 'NOT_FOUND' | 'SCHEMA_INVALID' | 'VERSION_CONFLICT',
  message: string,
) {
  return {
    schema_version: '1.0',
    error: { code, message, request_id: req.id, retryable: false, details: { kind: 'none' } },
  };
}
