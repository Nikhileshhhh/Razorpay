import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../config/db.js';
import type { Env } from '../../config/env.js';
import { resolveSyntheticHmacSecret } from '../../config/env.js';
import {
  ActionIdParam,
  AgentResultAcceptedResponse,
  AgentResultDetailResponse,
  AgentResultIdParam,
  AuditExportResponse,
  AuditListResponse,
  AuditQuery,
  CaseIdParam,
  VerificationCheckRequest,
  VerificationCheckResponse,
  VerificationResponse,
} from '../../contracts/api-endpoints.js';
import { AgentResultClaim } from '../../contracts/agent-claims.js';
import { getCase } from '../../modules/cases/case-service.js';
import {
  evaluateActionVerification,
  getCaseVerificationView,
  getVerificationHeadVersion,
  VerificationNotFoundError,
  VerificationVersionConflictError,
} from '../../modules/verification/verification-service.js';
import {
  buildCaseAuditExport,
  InvalidAuditCursorError,
  listCaseAudit,
} from '../../modules/audit/audit-service.js';
import {
  authenticateConnector,
  ConnectorAuthenticationError,
} from '../../modules/identity/connector-principal.js';
import {
  acceptAgentClaim,
  ClaimAttributionConflictError,
  ClaimEvidenceInvalidError,
  ClaimIdempotencyConflictError,
  getAgentClaimView,
} from '../../modules/claims/claim-service.js';
import { requireAnyRole, requireDemoIdentity } from '../middleware/demo-auth.js';
import { problem } from './problem.js';
import { PrototypeRateLimiter } from '../prototype-rate-limiter.js';

const MAX_CLAIM_BYTES = 256 * 1024;

export function registerB4CoreRoutes(app: FastifyInstance, db: Database, env: Env): void {
  const limiter = new PrototypeRateLimiter();
  app.get('/v1/cases/:id/verification', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const params = CaseIdParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    const row = await getCase(db, req.identity!.tenantContext, params.data.id);
    if (!row) return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    const view = await getCaseVerificationView(db, req.identity!.tenantContext, params.data.id);
    return reply.code(200).send(
      VerificationResponse.parse({
        schema_version: '1.0',
        request_id: req.id,
        data: view,
      }),
    );
  });

  app.post('/v1/actions/:id/verification-checks', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['case_manager', 'executor']))) return;
    if (
      !limiter.allow(`verification:${req.identity!.tenantContext.tenantId}:${req.identity!.userId}`)
    ) {
      return reply.code(429).send(problem(req, 'RATE_LIMITED', 'request rate exceeded', true));
    }
    const params = ActionIdParam.safeParse(req.params);
    const body = VerificationCheckRequest.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid verification request'));
    }
    try {
      const evaluated = await evaluateActionVerification(
        db,
        req.identity!.tenantContext,
        params.data.id,
        body.data.expected_verification_version,
      );
      const version = await getVerificationHeadVersion(
        db,
        req.identity!.tenantContext,
        params.data.id,
      );
      return reply.code(200).send(
        VerificationCheckResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: version,
          data: evaluated.result,
        }),
      );
    } catch (error) {
      if (error instanceof VerificationNotFoundError) {
        return reply.code(404).send(problem(req, 'NOT_FOUND', 'action not found'));
      }
      if (error instanceof VerificationVersionConflictError) {
        return reply
          .code(409)
          .send(problem(req, 'VERSION_CONFLICT', 'verification version changed'));
      }
      throw error;
    }
  });

  app.get('/v1/cases/:id/audit', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const params = CaseIdParam.safeParse(req.params);
    const query = AuditQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid audit query'));
    }
    if (!(await getCase(db, req.identity!.tenantContext, params.data.id))) {
      return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    }
    try {
      const page = await listCaseAudit(db, req.identity!.tenantContext, {
        caseId: params.data.id,
        cursor: query.data.cursor,
        limit: query.data.limit,
        artifactType: query.data.artifact_type,
        viewerRoles: req.identity!.roles,
      });
      return reply.code(200).send(
        AuditListResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          data: {
            items: page.items,
            page_info: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        }),
      );
    } catch (error) {
      if (error instanceof InvalidAuditCursorError) {
        return reply.code(400).send(problem(req, 'SCHEMA_INVALID', 'invalid audit cursor'));
      }
      throw error;
    }
  });

  app.get('/v1/cases/:id/audit/export', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['auditor', 'platform_operator']))) return;
    const params = CaseIdParam.safeParse(req.params);
    if (!params.success || !(await getCase(db, req.identity!.tenantContext, params.data.id))) {
      return reply.code(404).send(problem(req, 'NOT_FOUND', 'case not found'));
    }
    const bundle = await buildCaseAuditExport(
      db,
      req.identity!.tenantContext,
      params.data.id,
      req.identity!.roles,
    );
    reply.header('x-moneytrace-content-sha256', bundle.contentSha256);
    return reply.code(200).send(
      AuditExportResponse.parse({
        schema_version: '1.0',
        request_id: req.id,
        data: {
          schema_version: '1.0',
          case_id: params.data.id,
          generated_at: bundle.generatedAt,
          content_sha256: bundle.contentSha256,
          entries: bundle.entries,
        },
      }),
    );
  });

  void app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: MAX_CLAIM_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.post('/v1/agent-results', async (req, reply) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : null;
      const account = header(req, 'x-moneytrace-source-account');
      if (!limiter.allow(`agent-result:${account ?? req.ip}`)) {
        return reply.code(429).send(problem(req, 'RATE_LIMITED', 'request rate exceeded', true));
      }
      if (!raw || !account) {
        return reply.code(401).send(problem(req, 'POLICY_DENIED', 'source authentication failed'));
      }
      try {
        const principal = await authenticateConnector(db, {
          sourceSystem: 'SYNTHETIC_AGENT',
          externalAccountId: account,
          rawBytes: raw,
          providedSignature: header(req, 'x-moneytrace-signature'),
          secret: resolveSyntheticHmacSecret(env),
        });
        let json: unknown;
        try {
          json = JSON.parse(raw.toString('utf8')) as unknown;
        } catch {
          json = null;
        }
        const claim = AgentResultClaim.safeParse(json);
        if (!claim.success) {
          return reply.code(422).send(problem(req, 'SCHEMA_INVALID', 'invalid agent claim'));
        }
        const accepted = await acceptAgentClaim(db, principal, claim.data);
        const view = await getAgentClaimView(db, principal.tenantContext, accepted.claimId);
        const version = view?.evaluations.at(-1)?.evaluation_version ?? 0;
        return reply.code(accepted.idempotentReplay ? 200 : 201).send(
          AgentResultAcceptedResponse.parse({
            schema_version: '1.0',
            request_id: req.id,
            resource_version: version,
            data: {
              claim_id: accepted.claimId,
              status: accepted.status,
              idempotent_replay: accepted.idempotentReplay,
            },
          }),
        );
      } catch (error) {
        if (error instanceof ConnectorAuthenticationError) {
          return reply
            .code(401)
            .send(problem(req, 'POLICY_DENIED', 'source authentication failed'));
        }
        if (error instanceof ClaimIdempotencyConflictError) {
          return reply
            .code(409)
            .send(problem(req, 'IDEMPOTENCY_BODY_CONFLICT', 'claim key conflict'));
        }
        if (error instanceof ClaimAttributionConflictError) {
          return reply
            .code(409)
            .send(problem(req, 'AGENT_ATTRIBUTION_CONFLICT', 'claim attribution conflict'));
        }
        if (error instanceof ClaimEvidenceInvalidError) {
          return reply
            .code(403)
            .send(problem(req, 'TENANT_SCOPE_REQUIRED', 'claim evidence unavailable'));
        }
        throw error;
      }
    });
  });

  app.get('/v1/agent-results/:id', async (req, reply) => {
    if (!(await requireDemoIdentity(db, req, reply))) return;
    if (!(await requireAnyRole(req, reply, ['viewer']))) return;
    const params = AgentResultIdParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send(problem(req, 'NOT_FOUND', 'claim not found'));
    const view = await getAgentClaimView(db, req.identity!.tenantContext, params.data.id);
    if (!view) return reply.code(404).send(problem(req, 'NOT_FOUND', 'claim not found'));
    return reply.code(200).send(
      AgentResultDetailResponse.parse({
        schema_version: '1.0',
        request_id: req.id,
        data: view,
      }),
    );
  });
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
