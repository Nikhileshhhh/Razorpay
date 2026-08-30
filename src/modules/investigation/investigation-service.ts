import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { auditEntries, investigations, outbox as outboxTable } from '../../config/db-schema.js';
import { isUniqueViolation } from '../../config/errors.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { Env } from '../../config/env.js';
import type { Finding } from '../../contracts/findings.js';
import { FINDING_PLAN_TEMPLATE_MAP } from '../../contracts/plans.js';
import { collectCaseEvidencePool, sealCaseEvidence } from './evidence-classification.js';
import { createModelGateway } from './gateway-factory.js';
import { DEMO_GATEWAY_PROMPT_VERSION } from './demo-gateway.js';
import {
  InvestigationOutputInvalidError,
  validateInvestigationOutput,
} from './output-validator.js';
import {
  ModelGatewayTimeoutError,
  ModelGatewayUnavailableError,
  type ModelGatewayResult,
} from './model-gateway.js';
import { getCase, CaseVersionConflictError, transitionCase } from '../cases/case-service.js';
import { proposePlan } from '../policy/plan-service.js';
import { money } from '../../domain/money/money.js';
import type { ToolParameters } from '../../contracts/plans.js';

export class InvestigationCaseNotFoundError extends Error {
  constructor() {
    super('case not found');
    this.name = 'InvestigationCaseNotFoundError';
  }
}

export interface RequestInvestigationInput {
  readonly caseId: string;
  readonly expectedCaseVersion?: number;
  readonly actorId: string;
  readonly actorRole: string;
}

/**
 * `POST /v1/cases/:id/investigations` handler logic: validates the case and
 * expected-version guard, then enqueues DURABLE `run-investigation.v1` work
 * (backend PRD §11) rather than running the gateway call inline in the API
 * process. Returns a request-tracking id — the eventual persisted
 * `investigations` row is read back via `GET /v1/cases/:id/control-loop`.
 */
export async function requestInvestigation(
  db: Database,
  ctx: TenantContext,
  input: RequestInvestigationInput,
): Promise<{ readonly requestId: string }> {
  const caseRow = await getCase(db, ctx, input.caseId);
  if (!caseRow) throw new InvestigationCaseNotFoundError();
  if (input.expectedCaseVersion !== undefined && caseRow.version !== input.expectedCaseVersion) {
    throw new CaseVersionConflictError(input.caseId, input.expectedCaseVersion, caseRow.version);
  }

  const requestId = `investigation_req_${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.insert(outboxTable).values({
      id: `outbox_${randomUUID()}`,
      tenantId: ctx.tenantId,
      topic: 'run-investigation.v1',
      domainEventId: requestId,
      payload: {
        tenant_id: ctx.tenantId,
        case_id: input.caseId,
        expected_case_version: input.expectedCaseVersion ?? null,
        actor_id: input.actorId,
        actor_role: input.actorRole,
      },
      status: 'pending',
    });
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'INVESTIGATION',
      artifactId: requestId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      details: { operation: 'investigation_requested', case_id: input.caseId },
    });
  });
  return { requestId };
}

export interface RunInvestigationInput {
  readonly caseId: string;
  readonly expectedCaseVersion?: number;
  readonly actorId: string;
  readonly actorRole: string;
}

export interface RunInvestigationResult {
  readonly investigationId: string;
  readonly resultType: 'FINDING' | 'ABSTENTION' | 'SAFE_FAILURE';
}

async function callGatewayWithRetry(
  gateway: ReturnType<typeof createModelGateway>,
  request: Parameters<ReturnType<typeof createModelGateway>['investigate']>[0],
): Promise<ModelGatewayResult | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await gateway.investigate(request);
    } catch (error) {
      const retryable =
        error instanceof ModelGatewayTimeoutError || error instanceof ModelGatewayUnavailableError;
      if (!retryable || attempt === 1) return null;
    }
  }
  return null;
}

/**
 * Run (or idempotently reuse) an investigation for a case (backend PRD §11,
 * architecture §12). Deterministic exposure money is injected here from the
 * CASE record — never from model output. A validated `FINDING` auto-proposes
 * the ONE registered plan template it recommends; a validated `ABSTENTION`
 * (or any safe validation/provider failure) creates NO plan and moves the
 * case to `abstained` rather than guessing.
 */
export async function runInvestigation(
  db: Database,
  ctx: TenantContext,
  env: Pick<Env, 'MODEL_PROVIDER'> & { MODEL_API_URL?: string; MODEL_API_KEY?: string },
  input: RunInvestigationInput,
): Promise<RunInvestigationResult> {
  const caseRow = await getCase(db, ctx, input.caseId);
  if (!caseRow) throw new InvestigationCaseNotFoundError();
  if (input.expectedCaseVersion !== undefined && caseRow.version !== input.expectedCaseVersion) {
    throw new CaseVersionConflictError(input.caseId, input.expectedCaseVersion, caseRow.version);
  }

  const pool = await collectCaseEvidencePool(db, ctx, input.caseId);
  const sealed = await sealCaseEvidence(db, ctx, pool);

  const primaryGateway = createModelGateway(env);
  const promptVersion = DEMO_GATEWAY_PROMPT_VERSION;

  // Idempotency: (case_id, evidence_set_hash, prompt_version, model_config_hash) is
  // unique. We can only know model_config_hash after one gateway call, so we
  // probe with a first attempt result and then let the unique-violation path
  // (below) reconcile a genuine race.
  let gatewayResult = await callGatewayWithRetry(primaryGateway, {
    caseId: input.caseId,
    controlId: caseRow.controlId,
    evidenceSetHash: sealed.hash,
    promptVersion,
    pool,
  });
  let gatewayMode: 'offline_stub' | 'external_provider' = primaryGateway.mode;

  if (!gatewayResult && primaryGateway.mode === 'external_provider') {
    // Provider failure: rules-only degraded mode never blocks the case.
    gatewayResult = null;
    gatewayMode = 'offline_stub';
  }

  const existingCheck = gatewayResult
    ? await db
        .select({
          id: investigations.id,
          output: investigations.output,
          failureClass: investigations.failureClass,
        })
        .from(investigations)
        .where(
          and(
            eq(investigations.tenantId, ctx.tenantId),
            eq(investigations.caseId, input.caseId),
            eq(investigations.evidenceSetHash, sealed.hash),
            eq(investigations.promptVersion, promptVersion),
            eq(investigations.modelConfigHash, gatewayResult.modelConfigHash),
          ),
        )
        .limit(1)
    : [];
  if (existingCheck[0]) {
    return {
      investigationId: existingCheck[0].id,
      resultType: existingCheck[0].failureClass
        ? 'SAFE_FAILURE'
        : (existingCheck[0].output as { result_type: 'FINDING' | 'ABSTENTION' }).result_type,
    };
  }

  let failureClass: string | null = null;
  let finalOutput: Record<string, unknown> | null = null;
  let modelId = 'rules-only-fallback';
  let modelConfigHash = 'sha256:' + '0'.repeat(64);

  if (gatewayResult) {
    modelId = gatewayResult.modelId;
    modelConfigHash = gatewayResult.modelConfigHash;
    try {
      finalOutput = validateInvestigationOutput(gatewayResult.output, pool);
    } catch (error) {
      failureClass =
        error instanceof InvestigationOutputInvalidError ? error.failureClass : 'SCHEMA_INVALID';
    }
  } else {
    failureClass = 'PROVIDER_UNAVAILABLE';
  }

  // A safe failure (invalid/unavailable) becomes a deterministic rules-only
  // INSUFFICIENT_EVIDENCE abstention so the case can still be reasoned about.
  if (!finalOutput) {
    finalOutput = {
      schema_version: '1.0',
      result_type: 'ABSTENTION',
      abstention_reason: 'INSUFFICIENT_EVIDENCE',
      summary: 'Investigation could not produce a validated result; degraded rules-only mode.',
      explanation: 'The investigation output failed validation or the provider was unavailable.',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      missing_evidence_types: [],
      confidence_band: 'low',
      evidence_coverage: 'insufficient',
      recommended_plan_template_id: null,
    };
  }

  const investigationId = `investigation_${randomUUID()}`;
  const createdAt = new Date();
  const resultType = finalOutput.result_type as 'FINDING' | 'ABSTENTION';

  // Build the FINAL persisted artifact before the (append-only) insert: a
  // validated FINDING is replaced by the deterministic, exposure-injected
  // Finding record — the raw model claim is never what gets persisted/read.
  let finding: Finding | null = null;
  if (resultType === 'FINDING') {
    const findingCode = finalOutput.finding_code as
      'MISSING_EXPECTED_TRANSFER' | 'DUPLICATE_RECOVERY_RISK';
    const exposure = money(caseRow.exposureAmountMinor, caseRow.currency as 'INR');
    finding = {
      schema_version: '1.0',
      finding_id: `finding_${randomUUID()}`,
      case_id: input.caseId,
      finding_code: findingCode,
      summary: finalOutput.summary as string,
      confidence_band: finalOutput.confidence_band as Finding['confidence_band'],
      supporting_evidence_ids: finalOutput.supporting_evidence_ids as string[],
      contradicting_evidence_ids: finalOutput.contradicting_evidence_ids as string[],
      missing_evidence_types:
        finalOutput.missing_evidence_types as Finding['missing_evidence_types'],
      evidence_set_hash: sealed.hash,
      exposure: { amount_minor: exposure.amountMinor.toString(), currency: exposure.currency },
      created_at: createdAt.toISOString(),
      ...(gatewayResult && !failureClass
        ? {
            provenance: 'MODEL_VALIDATED',
            model_id: modelId,
            prompt_version: promptVersion,
            output_schema_version: '1.0',
          }
        : {
            provenance: 'RULES_ONLY',
            validator_id: 'moneytrace-rules-only-fallback',
            validator_version: 'v1',
          }),
    } as Finding;
  }

  try {
    await db.insert(investigations).values({
      id: investigationId,
      tenantId: ctx.tenantId,
      caseId: input.caseId,
      evidenceSetHash: sealed.hash,
      promptVersion,
      modelConfigHash,
      modelId,
      gatewayMode,
      output: finding ?? finalOutput,
      failureClass,
      createdAt,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'investigations_uq')) {
      const raced = await db
        .select({
          id: investigations.id,
          output: investigations.output,
          failureClass: investigations.failureClass,
        })
        .from(investigations)
        .where(
          and(
            eq(investigations.tenantId, ctx.tenantId),
            eq(investigations.caseId, input.caseId),
            eq(investigations.evidenceSetHash, sealed.hash),
            eq(investigations.promptVersion, promptVersion),
            eq(investigations.modelConfigHash, modelConfigHash),
          ),
        )
        .limit(1);
      if (raced[0]) {
        return {
          investigationId: raced[0].id,
          resultType: raced[0].failureClass
            ? 'SAFE_FAILURE'
            : (raced[0].output as { result_type: 'FINDING' | 'ABSTENTION' }).result_type,
        };
      }
    }
    throw error;
  }

  await db.insert(auditEntries).values({
    id: `audit_${randomUUID()}`,
    tenantId: ctx.tenantId,
    artifactType: 'INVESTIGATION',
    artifactId: investigationId,
    artifactHash: sealed.hash,
    actorId: input.actorId,
    actorRole: input.actorRole,
    modelId,
    promptVersion,
    evidenceSetHash: sealed.hash,
    details: {
      result_type: finalOutput.result_type,
      failure_class: failureClass,
      gateway_mode: gatewayMode,
    },
  });

  if (resultType === 'FINDING' && finding) {
    const findingCode = finding.finding_code;
    const templateId = FINDING_PLAN_TEMPLATE_MAP[findingCode];
    const exposure = money(caseRow.exposureAmountMinor, caseRow.currency as 'INR');

    const parameters: ToolParameters =
      findingCode === 'MISSING_EXPECTED_TRANSFER'
        ? {
            tool_id: 'SIMULATE_TRANSFER_REMEDIATION',
            economic_subject: caseRow.subjectId,
            expectation_id: caseRow.expectationId,
          }
        : {
            tool_id: 'SUPPRESS_SIMULATED_RECOVERY',
            economic_subject: caseRow.subjectId,
            recovery_id: null,
          };

    await proposePlan(db, ctx, {
      caseId: input.caseId,
      templateId,
      parameters,
      authorityLevel: findingCode === 'MISSING_EXPECTED_TRANSFER' ? 'L3' : 'L2',
      maximumAmountImpact:
        findingCode === 'MISSING_EXPECTED_TRANSFER'
          ? exposure
          : money(0n, caseRow.currency as 'INR'),
    });

    await safeTransition(db, ctx, input.caseId, caseRow.lifecycleState, 'investigating');
    await safeTransition(db, ctx, input.caseId, 'investigating', 'recommendation_ready');

    return { investigationId, resultType: 'FINDING' };
  }

  await safeTransition(db, ctx, input.caseId, caseRow.lifecycleState, 'investigating');
  await safeTransition(db, ctx, input.caseId, 'investigating', 'abstained');
  return { investigationId, resultType: failureClass ? 'SAFE_FAILURE' : 'ABSTENTION' };
}

async function safeTransition(
  db: Database,
  ctx: TenantContext,
  caseId: string,
  from: string,
  to: Parameters<typeof transitionCase>[2]['toState'],
): Promise<void> {
  const current = await getCase(db, ctx, caseId);
  if (!current || current.lifecycleState === to) return;
  try {
    await transitionCase(db, ctx, {
      caseId,
      toState: to,
      reason: `investigation:${from}->${to}`,
      expectedVersion: current.version,
    });
  } catch {
    // A forbidden/raced transition never blocks the already-persisted
    // investigation/plan artifacts, which remain the authoritative record.
  }
}
