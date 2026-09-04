import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  auditEntries,
  cases,
  investigations,
  outbox as outboxTable,
} from '../../config/db-schema.js';
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
  type ModelGateway,
  type ModelGatewayResult,
} from './model-gateway.js';
import {
  CaseVersionConflictError,
  lockControlLoopCase,
  transitionCaseInTransaction,
} from '../cases/case-service.js';
import { proposePlanInTransaction } from '../policy/plan-service.js';
import { money } from '../../domain/money/money.js';
import type { ToolParameters } from '../../contracts/plans.js';
import { authorizeTenantActorForUpdate } from '../identity/identity-repository.js';
import { contentHash } from '../../config/hashing.js';
import type { CaseLifecycleState } from '../../domain/state-machines/case-lifecycle.js';

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
): Promise<{ readonly requestId: string; readonly resourceVersion: number }> {
  return db.transaction(async (tx) => {
    await lockControlLoopCase(tx, ctx, input.caseId);
    const actor = await authorizeTenantActorForUpdate(tx, ctx, input.actorId, ['investigator']);
    const caseRows = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
      .limit(1);
    const caseRow = caseRows[0];
    if (!caseRow) throw new InvestigationCaseNotFoundError();
    if (input.expectedCaseVersion !== undefined && caseRow.version !== input.expectedCaseVersion) {
      throw new CaseVersionConflictError(input.caseId, input.expectedCaseVersion, caseRow.version);
    }
    const requestId = `investigation_req_${randomUUID()}`;
    await tx.insert(outboxTable).values({
      id: `outbox_${randomUUID()}`,
      tenantId: ctx.tenantId,
      topic: 'run-investigation.v1',
      domainEventId: requestId,
      payload: {
        tenant_id: ctx.tenantId,
        case_id: input.caseId,
        expected_case_version: input.expectedCaseVersion ?? null,
        actor_id: actor.userId,
      },
      status: 'pending',
    });
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'INVESTIGATION',
      artifactId: requestId,
      actorId: actor.userId,
      actorRole: 'investigator',
      details: {
        operation: 'investigation_requested',
        case_id: input.caseId,
        resource_version: caseRow.version,
      },
    });
    return { requestId, resourceVersion: caseRow.version };
  });
}

export interface RunInvestigationInput {
  readonly caseId: string;
  readonly expectedCaseVersion?: number;
  readonly actorId: string;
  /** Test-only crash injection proving retry repair after the immutable insert. */
  readonly failAfterInsertForTest?: boolean;
}

export interface RunInvestigationResult {
  readonly investigationId: string;
  readonly resultType: 'FINDING' | 'ABSTENTION' | 'SAFE_FAILURE';
}

export async function callGatewayWithRetry(
  gateway: ModelGateway,
  request: Parameters<ModelGateway['investigate']>[0],
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
  const caseRow = await db.transaction(async (tx) => {
    await lockControlLoopCase(tx, ctx, input.caseId);
    await authorizeTenantActorForUpdate(tx, ctx, input.actorId, ['investigator']);
    const rows = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new InvestigationCaseNotFoundError();
    if (input.expectedCaseVersion !== undefined && row.version !== input.expectedCaseVersion) {
      throw new CaseVersionConflictError(input.caseId, input.expectedCaseVersion, row.version);
    }
    return row;
  });

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
        .select()
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
    await ensureInvestigationArtifacts(db, ctx, input, existingCheck[0]);
    return {
      investigationId: existingCheck[0].id,
      resultType: classifyInvestigationResult(existingCheck[0]),
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
    await db.transaction(async (tx) => {
      await lockControlLoopCase(tx, ctx, input.caseId);
      await authorizeTenantActorForUpdate(tx, ctx, input.actorId, ['investigator']);
      const currentRows = await tx
        .select({ version: cases.version })
        .from(cases)
        .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
        .limit(1);
      if (!currentRows[0]) throw new InvestigationCaseNotFoundError();
      if (
        input.expectedCaseVersion !== undefined &&
        currentRows[0].version !== input.expectedCaseVersion
      ) {
        throw new CaseVersionConflictError(
          input.caseId,
          input.expectedCaseVersion,
          currentRows[0].version,
        );
      }
      await tx.insert(investigations).values({
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
    });
  } catch (error) {
    if (isUniqueViolation(error, 'investigations_uq')) {
      const raced = await db
        .select()
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
        await ensureInvestigationArtifacts(db, ctx, input, raced[0]);
        return {
          investigationId: raced[0].id,
          resultType: classifyInvestigationResult(raced[0]),
        };
      }
    }
    throw error;
  }

  const insertedRows = await db
    .select()
    .from(investigations)
    .where(and(eq(investigations.tenantId, ctx.tenantId), eq(investigations.id, investigationId)))
    .limit(1);
  if (input.failAfterInsertForTest) throw new Error('simulated post-investigation-insert crash');
  await ensureInvestigationArtifacts(db, ctx, input, insertedRows[0]!);
  return { investigationId, resultType: classifyInvestigationResult(insertedRows[0]!) };
}

function classifyInvestigationResult(
  row: typeof investigations.$inferSelect,
): RunInvestigationResult['resultType'] {
  if (row.failureClass) return 'SAFE_FAILURE';
  const output = row.output as Record<string, unknown> | null;
  return output && typeof output.finding_code === 'string' ? 'FINDING' : 'ABSTENTION';
}

function stableEffectId(prefix: string, investigationId: string, effect: string): string {
  return `${prefix}_${contentHash({ investigationId, effect }).slice(7, 39)}`;
}

/**
 * Retry-repairable downstream materialization. The investigation row is the
 * immutable source of truth; audit, plan, and lifecycle effects are ensured in
 * one case-serialized transaction and use deterministic identities.
 */
async function ensureInvestigationArtifacts(
  db: Database,
  ctx: TenantContext,
  input: RunInvestigationInput,
  investigation: typeof investigations.$inferSelect,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockControlLoopCase(tx, ctx, input.caseId);
    const actor = await authorizeTenantActorForUpdate(tx, ctx, input.actorId, ['investigator']);
    const caseRows = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, input.caseId)))
      .limit(1);
    let caseRow = caseRows[0];
    if (!caseRow) throw new InvestigationCaseNotFoundError();

    const resultType = classifyInvestigationResult(investigation);
    await tx
      .insert(auditEntries)
      .values({
        id: stableEffectId('audit', investigation.id, 'investigation_persisted'),
        tenantId: ctx.tenantId,
        artifactType: 'INVESTIGATION',
        artifactId: investigation.id,
        artifactHash: investigation.evidenceSetHash,
        actorId: actor.userId,
        actorRole: 'investigator',
        modelId: investigation.modelId,
        promptVersion: investigation.promptVersion,
        evidenceSetHash: investigation.evidenceSetHash,
        details: {
          result_type: resultType,
          failure_class: investigation.failureClass,
          gateway_mode: investigation.gatewayMode,
        },
      })
      .onConflictDoNothing({ target: auditEntries.id });

    const output = investigation.output as Record<string, unknown> | null;
    const isFinding = output !== null && typeof output.finding_code === 'string';
    if (isFinding) {
      const finding = output as Finding;
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
      await proposePlanInTransaction(tx, ctx, {
        caseId: input.caseId,
        templateId,
        parameters,
        authorityLevel: findingCode === 'MISSING_EXPECTED_TRANSFER' ? 'L3' : 'L2',
        maximumAmountImpact:
          findingCode === 'MISSING_EXPECTED_TRANSFER'
            ? exposure
            : money(0n, caseRow.currency as 'INR'),
      });
    }

    const terminalStates: ReadonlySet<string> = new Set([
      'reconciled',
      'escalated',
      'rejected',
      'expired',
      'cancelled',
      'closed_no_action',
    ]);
    if (terminalStates.has(caseRow.lifecycleState)) return;

    const transition = async (toState: CaseLifecycleState, effect: string) => {
      const nextVersion = await transitionCaseInTransaction(tx, ctx, {
        caseId: input.caseId,
        toState,
        reason: `investigation:${effect}`,
        expectedVersion: caseRow!.version,
        actorId: actor.userId,
        actorRole: 'investigator',
        evidenceIds: [...((output?.supporting_evidence_ids as string[] | undefined) ?? [])],
        transitionId: stableEffectId('trans', investigation.id, effect),
        auditId: stableEffectId('audit', investigation.id, `transition_${effect}`),
      });
      caseRow = { ...caseRow!, lifecycleState: toState, version: nextVersion };
    };

    if (caseRow.lifecycleState === 'candidate') await transition('open', 'candidate_to_open');
    if (caseRow.lifecycleState === 'open' || caseRow.lifecycleState === 'abstained') {
      await transition('investigating', 'to_investigating');
    }
    if (isFinding) {
      if (caseRow.lifecycleState === 'investigating') {
        await transition('recommendation_ready', 'finding_ready');
      }
    } else if (caseRow.lifecycleState !== 'abstained') {
      await transition('abstained', 'abstained');
    }
  });
}
