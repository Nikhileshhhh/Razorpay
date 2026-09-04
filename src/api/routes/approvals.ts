import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../config/db.js';
import {
  CaseIdParam,
  ApproveRequest,
  RejectRequest,
  RequestMoreEvidenceRequest,
  ApprovalResponse,
  ListApprovalsQuery,
  ApprovalListResponse,
} from '../../contracts/api-endpoints.js';
import { ApprovalRequest } from '../../contracts/approvals.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import {
  requestApproval,
  decideApproval,
  listApprovals,
  ApprovalNotFoundError,
  ApprovalPreconditionError,
  ApprovalStaleError,
  ApprovalSelfApprovalError,
  ApprovalStateConflictError,
  InvalidApprovalCursorError,
  getApprovalResourceVersion,
} from '../../modules/approvals/approval-service.js';
import { problem } from './problem.js';

export function registerApprovalRoutes(app: FastifyInstance, db: Database): void {
  app.post('/v1/cases/:id/request-approval', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['case_manager']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const body = ApprovalRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid approval request'));
    }
    try {
      const record = await requestApproval(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        planId: body.data.plan_id,
        expectedCaseVersion: body.data.expected_case_version,
        expectedPlanVersion: body.data.expected_plan_version,
        reason: body.data.reason,
        requesterId: req.identity!.userId,
      });
      const resourceVersion = await getApprovalResourceVersion(
        db,
        req.identity!.tenantContext,
        record.approval_id,
      );
      return reply.code(200).send(
        ApprovalResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: resourceVersion,
          data: record,
        }),
      );
    } catch (error) {
      return approvalError(req, reply, error);
    }
  });

  app.post('/v1/cases/:id/approve', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['finance_approver']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const body = ApproveRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid approve request'));
    }
    try {
      const record = await decideApproval(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        approvalId: body.data.approval_id,
        decisionBasisHash: body.data.decision_basis_hash,
        decision: 'approve',
        reason: body.data.reason,
        approverId: req.identity!.userId,
      });
      const resourceVersion = await getApprovalResourceVersion(
        db,
        req.identity!.tenantContext,
        record.approval_id,
      );
      return reply.code(200).send(
        ApprovalResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: resourceVersion,
          data: record,
        }),
      );
    } catch (error) {
      return approvalError(req, reply, error);
    }
  });

  app.post('/v1/cases/:id/reject', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['finance_approver']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const body = RejectRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid reject request'));
    }
    try {
      const record = await decideApproval(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        approvalId: body.data.approval_id,
        decisionBasisHash: body.data.decision_basis_hash,
        decision: 'reject',
        reason: body.data.reason,
        approverId: req.identity!.userId,
      });
      const resourceVersion = await getApprovalResourceVersion(
        db,
        req.identity!.tenantContext,
        record.approval_id,
      );
      return reply.code(200).send(
        ApprovalResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: resourceVersion,
          data: record,
        }),
      );
    } catch (error) {
      return approvalError(req, reply, error);
    }
  });

  app.post('/v1/cases/:id/request-more-evidence', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['finance_approver']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const body = RequestMoreEvidenceRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply
        .code(422)
        .send(problem(req, 'SCHEMA_INVALID', 'invalid request-more-evidence request'));
    }
    try {
      const record = await decideApproval(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        approvalId: body.data.approval_id,
        decisionBasisHash: body.data.decision_basis_hash,
        decision: 'request_more_evidence',
        reason: body.data.reason,
        approverId: req.identity!.userId,
      });
      const resourceVersion = await getApprovalResourceVersion(
        db,
        req.identity!.tenantContext,
        record.approval_id,
      );
      return reply.code(200).send(
        ApprovalResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: resourceVersion,
          data: record,
        }),
      );
    } catch (error) {
      return approvalError(req, reply, error);
    }
  });

  app.get('/v1/approvals', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const query = ListApprovalsQuery.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid approvals query'));
    }
    try {
      const page = await listApprovals(db, req.identity!.tenantContext, {
        state: query.data.state,
        caseId: query.data.case_id,
        cursor: query.data.cursor,
        limit: query.data.limit ?? 50,
      });
      return reply.code(200).send(
        ApprovalListResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          data: {
            items: page.items.map((item) => ({
              approval: item.approval,
              case_id: item.caseId,
              amount_impact: { amount_minor: item.amountImpactMinor, currency: 'INR' },
            })),
            page_info: { next_cursor: page.nextCursor, has_more: page.hasMore },
          },
        }),
      );
    } catch (error) {
      if (error instanceof InvalidApprovalCursorError) {
        return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid cursor'));
      }
      throw error;
    }
  });
}

function approvalError(req: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ApprovalNotFoundError) {
    return reply.code(422).send(problem(req, 'NOT_FOUND', 'approval not found'));
  }
  if (error instanceof ApprovalPreconditionError) {
    return reply.code(422).send(problem(req, 'SCHEMA_INVALID', error.message));
  }
  if (error instanceof ApprovalStaleError) {
    return reply.code(409).send(problem(req, 'APPROVAL_STALE', 'approval decision basis is stale'));
  }
  if (error instanceof ApprovalSelfApprovalError) {
    return reply
      .code(403)
      .send(problem(req, 'APPROVAL_FORBIDDEN', 'preparer cannot approve their own plan'));
  }
  if (error instanceof ApprovalStateConflictError) {
    return reply.code(409).send(problem(req, 'VERSION_CONFLICT', error.message));
  }
  throw error;
}
