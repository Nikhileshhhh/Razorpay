import { z } from 'zod';
import { Money, SignedMoney } from './common/money.js';
import { PageInfo } from './common/pagination.js';
import { CanonicalEvent } from './events/canonical-event.js';
import { InternalEvent } from './events/internal-events.js';
import { SourceAuthorityRecord } from './authority.js';
import { EvidenceRecord, EvidenceSetRef } from './evidence.js';
import { CaseDetail, CaseSummary, MoneyPath } from './cases.js';
import {
  EvidenceContract as EvidenceContractSchema,
  Finding,
  ModelInvestigationOutput,
} from './findings.js';
import { AgentResultClaim, ClaimEvaluation } from './agent-claims.js';
import { Plan, RegisteredToolRequest, RegisteredToolResult } from './plans.js';
import { PolicyDecisionRecord, PolicyInputProjection } from './policy.js';
import { ApprovalDecisionBasis, ApprovalRecord, ApprovalRequest } from './approvals.js';
import { ActionRecord } from './actions.js';
import { VerificationContract, VerificationResult } from './verification.js';
import { ReconciliationResult } from './reconciliation.js';
import { AuditRecord } from './audit.js';
import { ErrorEnvelope } from './errors.js';
import * as api from './api-endpoints.js';

/**
 * Single source of truth for OpenAPI composition. Plain and browser-safe (no
 * zod-to-openapi import): it lists named component schemas and route specs that
 * reference components by NAME. `openapi.ts` consumes it at the composition
 * boundary and composes response envelopes with `$ref`s to the named records.
 */

export interface NamedSchema {
  name: string;
  schema: z.ZodTypeAny;
}

/**
 * Named components. Each entry is the SINGLE authoritative schema used both for
 * runtime validation and OpenAPI generation — there is no weaker OpenAPI-only
 * twin, so the public contract cannot advertise a payload the runtime rejects.
 */
export const COMPONENTS: readonly NamedSchema[] = [
  // value objects
  { name: 'Money', schema: Money },
  { name: 'SignedMoney', schema: SignedMoney },
  { name: 'PageInfo', schema: PageInfo },
  // events
  { name: 'CanonicalEvent', schema: CanonicalEvent },
  { name: 'InternalEvent', schema: InternalEvent },
  // evidence / authority
  { name: 'SourceAuthorityRecord', schema: SourceAuthorityRecord },
  { name: 'EvidenceRecord', schema: EvidenceRecord },
  { name: 'EvidenceSetRef', schema: EvidenceSetRef },
  { name: 'EvidenceContract', schema: EvidenceContractSchema },
  // cases / findings
  { name: 'CaseSummary', schema: CaseSummary },
  { name: 'CaseDetail', schema: CaseDetail },
  { name: 'MoneyPath', schema: MoneyPath },
  { name: 'Finding', schema: Finding },
  { name: 'ModelInvestigationOutput', schema: ModelInvestigationOutput },
  // agent
  { name: 'AgentResultClaim', schema: AgentResultClaim },
  { name: 'ClaimEvaluation', schema: ClaimEvaluation },
  // plans / tools
  { name: 'Plan', schema: Plan },
  { name: 'RegisteredToolRequest', schema: RegisteredToolRequest },
  { name: 'RegisteredToolResult', schema: RegisteredToolResult },
  // policy / approval / action / verification / reconciliation / audit
  { name: 'PolicyInputProjection', schema: PolicyInputProjection },
  { name: 'PolicyDecisionRecord', schema: PolicyDecisionRecord },
  { name: 'ApprovalDecisionBasis', schema: ApprovalDecisionBasis },
  { name: 'ApprovalRecord', schema: ApprovalRecord },
  { name: 'ActionRecord', schema: ActionRecord },
  { name: 'VerificationContract', schema: VerificationContract },
  { name: 'VerificationResult', schema: VerificationResult },
  { name: 'VerificationView', schema: api.VerificationView },
  { name: 'ReconciliationResult', schema: ReconciliationResult },
  { name: 'AuditRecord', schema: AuditRecord },
  { name: 'ErrorEnvelope', schema: ErrorEnvelope },
  // request bodies
  { name: 'ImportRequest', schema: api.ImportRequest },
  { name: 'InvestigationRequest', schema: api.InvestigationRequest },
  { name: 'EvaluatePolicyRequest', schema: api.EvaluatePolicyRequest },
  { name: 'ApprovalRequest', schema: ApprovalRequest },
  { name: 'ApproveRequest', schema: api.ApproveRequest },
  { name: 'RejectRequest', schema: api.RejectRequest },
  { name: 'ExecuteRequest', schema: api.ExecuteRequest },
  { name: 'VerificationCheckRequest', schema: api.VerificationCheckRequest },
  { name: 'DemoResetRequest', schema: api.DemoResetRequest },
  { name: 'DemoAdvanceRequest', schema: api.DemoAdvanceRequest },
  { name: 'AssignCaseRequest', schema: api.AssignCaseRequest },
  { name: 'AddCaseNoteRequest', schema: api.AddCaseNoteRequest },
  { name: 'LinkDecisionRequest', schema: api.LinkDecisionRequest },
  { name: 'RequestMoreEvidenceRequest', schema: api.RequestMoreEvidenceRequest },
  // response data shapes
  { name: 'EventAccepted', schema: api.EventAccepted },
  { name: 'WebhookAccepted', schema: api.WebhookAccepted },
  { name: 'ImportAccepted', schema: api.ImportAccepted },
  { name: 'InvestigationAccepted', schema: api.InvestigationAccepted },
  { name: 'ClaimAccepted', schema: api.ClaimAccepted },
  { name: 'AgentResultView', schema: api.AgentResultView },
  { name: 'DemoStatus', schema: api.DemoStatus },
  { name: 'DemoAdvanceStatus', schema: api.DemoAdvanceStatus },
  { name: 'EvidenceTimelineItem', schema: api.EvidenceTimelineItem },
  { name: 'CaseNoteRecord', schema: api.CaseNoteRecord },
  { name: 'CaseAssignmentResult', schema: api.CaseAssignmentResult },
  { name: 'LinkDecisionResult', schema: api.LinkDecisionResult },
  { name: 'ControlLoopView', schema: api.ControlLoopView },
  { name: 'ApprovalListItem', schema: api.ApprovalListItem },
];

export type ResponseKind = 'api' | 'mutation' | 'list' | 'error';

export interface RouteResponse {
  status: number;
  description: string;
  kind: ResponseKind;
  /** Component name of the response DATA record (or ErrorEnvelope for errors). */
  data: string;
}

export interface RouteRequest {
  params?: z.AnyZodObject;
  query?: z.AnyZodObject;
  /** Component name of the request body schema. */
  body?: string;
  /** Raw (non-JSON-parsed) request body, e.g. the Razorpay webhook. */
  rawBody?: { description: string };
}

export interface RouteSpec {
  method: 'get' | 'post';
  path: string;
  summary: string;
  request?: RouteRequest;
  responses: RouteResponse[];
}

const errs = (...statuses: number[]): RouteResponse[] =>
  statuses.map((status) => ({
    status,
    description: 'Error',
    kind: 'error' as const,
    data: 'ErrorEnvelope',
  }));

const ok = (
  status: number,
  description: string,
  kind: ResponseKind,
  data: string,
): RouteResponse => ({
  status,
  description,
  kind,
  data,
});

export const API_ROUTES: readonly RouteSpec[] = [
  {
    method: 'post',
    path: '/v1/events',
    summary: 'Ingest a canonical/signed adapter event',
    request: { body: 'CanonicalEvent' },
    responses: [
      ok(202, 'Durably accepted', 'mutation', 'EventAccepted'),
      ...errs(400, 401, 403, 409, 413, 503),
    ],
  },
  {
    method: 'post',
    path: '/v1/webhooks/razorpay',
    summary: 'Razorpay webhook receiver',
    request: {
      rawBody: {
        description:
          'Raw request bytes. HMAC-SHA256 is verified over the EXACT raw bytes BEFORE ' +
          'JSON parsing. Specific Razorpay webhook types are not enumerated here.',
      },
    },
    responses: [
      ok(202, 'Accepted / duplicate', 'mutation', 'WebhookAccepted'),
      ...errs(400, 401, 409, 413, 503),
    ],
  },
  {
    method: 'post',
    path: '/v1/imports',
    summary: 'Import a synthetic dataset manifest',
    request: { body: 'ImportRequest' },
    responses: [ok(202, 'Import accepted', 'mutation', 'ImportAccepted'), ...errs(400, 413, 422)],
  },
  {
    method: 'get',
    path: '/v1/cases',
    summary: 'List cases (cursor pagination, allowlisted filters)',
    request: { query: api.ListCasesQuery },
    responses: [ok(200, 'Case page', 'list', 'CaseSummary'), ...errs(400, 403)],
  },
  {
    method: 'get',
    path: '/v1/cases/:id',
    summary: 'Get a case',
    request: { params: api.CaseIdParam },
    responses: [ok(200, 'Case detail', 'api', 'CaseDetail'), ...errs(403, 404)],
  },
  {
    method: 'get',
    path: '/v1/cases/:id/money-path',
    summary: 'Get the expected-vs-observed money path',
    request: { params: api.CaseIdParam },
    responses: [ok(200, 'Money path', 'api', 'MoneyPath'), ...errs(403, 404, 422)],
  },
  {
    method: 'get',
    path: '/v1/cases/:id/evidence',
    summary: 'List role-redacted case evidence',
    request: { params: api.CaseIdParam, query: api.CaseTimelineQuery },
    responses: [
      ok(200, 'Case evidence timeline', 'list', 'EvidenceTimelineItem'),
      ...errs(400, 403, 404),
    ],
  },
  {
    method: 'get',
    path: '/v1/cases/:id/notes',
    summary: 'List append-only case notes',
    request: { params: api.CaseIdParam, query: api.CaseTimelineQuery },
    responses: [ok(200, 'Case notes', 'list', 'CaseNoteRecord'), ...errs(400, 403, 404)],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/assign',
    summary: 'Assign or unassign a case',
    request: { params: api.CaseIdParam, body: 'AssignCaseRequest' },
    responses: [
      ok(200, 'Case assignment changed', 'mutation', 'CaseAssignmentResult'),
      ...errs(403, 409, 422),
    ],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/notes',
    summary: 'Append an operator case note',
    request: { params: api.CaseIdParam, body: 'AddCaseNoteRequest' },
    responses: [
      ok(201, 'Case note appended', 'mutation', 'CaseNoteRecord'),
      ...errs(403, 409, 422),
    ],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/links/:linkId/decision',
    summary: 'Review a candidate provenance link',
    request: { params: api.CaseLinkParam, body: 'LinkDecisionRequest' },
    responses: [
      ok(200, 'Candidate link reviewed', 'mutation', 'LinkDecisionResult'),
      ...errs(403, 409, 422),
    ],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/investigations',
    summary: 'Request an AI investigation',
    request: { params: api.CaseIdParam, body: 'InvestigationRequest' },
    responses: [
      ok(202, 'Investigation accepted', 'mutation', 'InvestigationAccepted'),
      ...errs(409, 422, 503),
    ],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/evaluate-policy',
    summary: 'Evaluate policy for the current plan',
    request: { params: api.CaseIdParam, body: 'EvaluatePolicyRequest' },
    responses: [ok(200, 'Policy decision', 'mutation', 'PolicyDecisionRecord'), ...errs(409, 422)],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/request-approval',
    summary: 'Request approval for a plan',
    request: { params: api.CaseIdParam, body: 'ApprovalRequest' },
    responses: [ok(200, 'Approval requested', 'mutation', 'ApprovalRecord'), ...errs(409, 422)],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/approve',
    summary: 'Approve a plan (server derives approver identity)',
    request: { params: api.CaseIdParam, body: 'ApproveRequest' },
    responses: [ok(200, 'Approved', 'mutation', 'ApprovalRecord'), ...errs(403, 409, 422)],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/reject',
    summary: 'Reject a plan',
    request: { params: api.CaseIdParam, body: 'RejectRequest' },
    responses: [ok(200, 'Rejected', 'mutation', 'ApprovalRecord'), ...errs(403, 409, 422)],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/request-more-evidence',
    summary: 'Request more evidence on the current decision basis',
    request: { params: api.CaseIdParam, body: 'RequestMoreEvidenceRequest' },
    responses: [
      ok(200, 'More evidence requested', 'mutation', 'ApprovalRecord'),
      ...errs(403, 409, 422),
    ],
  },
  {
    method: 'get',
    path: '/v1/approvals',
    summary: 'List approvals (cursor pagination, allowlisted filters)',
    request: { query: api.ListApprovalsQuery },
    responses: [ok(200, 'Approval page', 'list', 'ApprovalListItem'), ...errs(400, 403)],
  },
  {
    method: 'get',
    path: '/v1/cases/:id/control-loop',
    summary: 'Get the current investigation/plan/policy/approval/action summary',
    request: { params: api.CaseIdParam },
    responses: [ok(200, 'Control-loop view', 'api', 'ControlLoopView'), ...errs(403, 404)],
  },
  {
    method: 'post',
    path: '/v1/cases/:id/execute',
    summary: 'Execute an approved plan',
    request: { params: api.CaseIdParam, body: 'ExecuteRequest' },
    responses: [ok(202, 'Action reserved', 'mutation', 'ActionRecord'), ...errs(403, 409, 422)],
  },
  {
    method: 'get',
    path: '/v1/cases/:id/verification',
    summary: 'Get verification contract + result',
    request: { params: api.CaseIdParam },
    responses: [ok(200, 'Verification view', 'api', 'VerificationView'), ...errs(403, 404)],
  },
  {
    method: 'post',
    path: '/v1/actions/:id/verification-checks',
    summary: 'Run a verification check for an action',
    request: { params: api.ActionIdParam, body: 'VerificationCheckRequest' },
    responses: [
      ok(200, 'Verification evaluated', 'mutation', 'VerificationResult'),
      ...errs(409, 422),
    ],
  },
  {
    method: 'get',
    path: '/v1/cases/:id/audit',
    summary: 'Audit replay (cursor pagination, filters)',
    request: { params: api.CaseIdParam, query: api.AuditQuery },
    responses: [ok(200, 'Audit page', 'list', 'AuditRecord'), ...errs(403, 404)],
  },
  {
    method: 'post',
    path: '/v1/agent-results',
    summary: 'Record an untrusted agent result claim',
    request: { body: 'AgentResultClaim' },
    responses: [ok(201, 'Claim accepted', 'mutation', 'ClaimAccepted'), ...errs(400, 409, 422)],
  },
  {
    method: 'get',
    path: '/v1/agent-results/:id',
    summary: 'Get an agent result claim and its evaluations',
    request: { params: api.AgentResultIdParam },
    responses: [ok(200, 'Claim detail', 'api', 'AgentResultView'), ...errs(403, 404)],
  },
  {
    method: 'post',
    path: '/v1/demo/reset',
    summary: 'Reset the deterministic demo (demo environment only)',
    request: { body: 'DemoResetRequest' },
    responses: [ok(200, 'Reset', 'mutation', 'DemoStatus'), ...errs(403, 409)],
  },
  {
    method: 'post',
    path: '/v1/demo/scenarios/:id/advance',
    summary: 'Advance a demo scenario step (demo environment only)',
    request: { params: api.ScenarioIdParam, body: 'DemoAdvanceRequest' },
    responses: [ok(200, 'Advanced', 'mutation', 'DemoAdvanceStatus'), ...errs(403, 409)],
  },
];
