import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction, DbExecutor } from '../../config/db.js';
import {
  actions,
  agentClaimEvidenceBindings,
  agentResultClaims,
  cases,
  claimEvaluationHeads,
  claimEvaluations,
  economicSubjects,
  ingestEvents,
  outbox,
  verificationRunHeads,
  verificationRuns,
} from '../../config/db-schema.js';
import { isUniqueViolation } from '../../config/errors.js';
import { contentHash } from '../../config/hashing.js';
import type { AgentResultClaim, ClaimEvaluation } from '../../contracts/agent-claims.js';
import { computeRetainedValue } from '../../domain/money/retained-value.js';
import {
  assertAgentClaimTransition,
  type AgentClaimState,
} from '../../domain/state-machines/agent-claim.js';
import { appendAuditEntry } from '../audit/audit-writer.js';
import type { ConnectorPrincipal } from '../identity/connector-principal.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { evidenceTypeForCanonicalEvent } from '../investigation/evidence-classification.js';

export class ClaimIdempotencyConflictError extends Error {
  constructor() {
    super('same claim key has a different request body');
    this.name = 'ClaimIdempotencyConflictError';
  }
}

export class ClaimEvidenceInvalidError extends Error {
  constructor() {
    super('claim evidence is invalid or outside the authenticated tenant/subject');
    this.name = 'ClaimEvidenceInvalidError';
  }
}

export class ClaimAttributionConflictError extends Error {
  constructor() {
    super('authoritative capture evidence is already attributed to another claim');
    this.name = 'ClaimAttributionConflictError';
  }
}

export interface AcceptClaimResult {
  readonly claimId: string;
  readonly status: AgentClaimState;
  readonly idempotentReplay: boolean;
}

function stringReference(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function toEvaluation(row: typeof claimEvaluations.$inferSelect): ClaimEvaluation {
  const base = {
    schema_version: '1.0' as const,
    claim_id: row.claimId,
    evaluation_version: row.evaluationVersion,
    created_at: row.createdAt.toISOString(),
  };
  if (row.status === 'VERIFIED' || row.status === 'PARTIALLY_VERIFIED') {
    return {
      ...base,
      status: row.status,
      verified_amount: { amount_minor: row.verifiedAmountMinor!.toString(), currency: 'INR' },
    };
  }
  if (row.status === 'REVERSED') {
    return {
      ...base,
      status: 'REVERSED',
      verified_amount: { amount_minor: '0', currency: 'INR' },
    };
  }
  return {
    ...base,
    status: row.status as 'PENDING' | 'REJECTED' | 'UNRESOLVED',
    verified_amount: null,
  };
}

export async function acceptAgentClaim(
  db: Database,
  principal: ConnectorPrincipal,
  claim: AgentResultClaim,
  now = new Date(),
): Promise<AcceptClaimResult> {
  if (
    principal.sourceSystem !== 'SYNTHETIC_AGENT' ||
    claim.tenant_id !== principal.tenantContext.tenantId
  ) {
    throw new ClaimEvidenceInvalidError();
  }
  const ctx = principal.tenantContext;
  const requestHash = contentHash(claim);
  try {
    return await db.transaction(async (tx) => {
      const key = `${ctx.tenantId}|${claim.external_agent_id}|${claim.external_claim_id}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      const existing = await tx
        .select({ claim: agentResultClaims, head: claimEvaluationHeads })
        .from(agentResultClaims)
        .leftJoin(
          claimEvaluationHeads,
          and(
            eq(claimEvaluationHeads.tenantId, agentResultClaims.tenantId),
            eq(claimEvaluationHeads.claimId, agentResultClaims.id),
          ),
        )
        .where(
          and(
            eq(agentResultClaims.tenantId, ctx.tenantId),
            eq(agentResultClaims.externalAgentId, claim.external_agent_id),
            eq(agentResultClaims.externalClaimId, claim.external_claim_id),
          ),
        )
        .limit(1);
      if (existing[0]) {
        if (existing[0].claim.requestHash !== requestHash)
          throw new ClaimIdempotencyConflictError();
        return {
          claimId: existing[0].claim.id,
          status: (existing[0].head?.status ?? 'PENDING') as AgentClaimState,
          idempotentReplay: true,
        };
      }
      const evidenceIds = [...new Set(claim.evidence_refs.map((ref) => ref.evidence_id))].sort();
      for (const evidenceId of evidenceIds) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|claim-evidence|${evidenceId}`}, 0))`,
        );
      }
      const evidence = await tx
        .select({
          id: ingestEvents.id,
          eventType: ingestEvents.eventType,
          subject: ingestEvents.economicSubjectHint,
          quarantine: ingestEvents.quarantineStatus,
          signature: ingestEvents.signatureStatus,
        })
        .from(ingestEvents)
        .where(and(eq(ingestEvents.tenantId, ctx.tenantId), inArray(ingestEvents.id, evidenceIds)));
      const evidenceById = new Map(evidence.map((item) => [item.id, item]));
      if (
        evidence.length !== evidenceIds.length ||
        claim.evidence_refs.length !== evidenceIds.length ||
        evidence.some(
          (item) =>
            item.subject !== claim.economic_subject ||
            item.quarantine !== 'none' ||
            item.signature !== 'verified',
        ) ||
        claim.evidence_refs.some((reference) => {
          const item = evidenceById.get(reference.evidence_id);
          return !item || evidenceTypeForCanonicalEvent(item.eventType) !== reference.evidence_type;
        }) ||
        !claim.evidence_refs.some((reference) => reference.evidence_type === 'captured_payment')
      ) {
        throw new ClaimEvidenceInvalidError();
      }
      const claimId = `claim_${randomUUID()}`;
      const evaluationId = `claim_evaluation_${randomUUID()}`;
      await tx.insert(agentResultClaims).values({
        id: claimId,
        tenantId: ctx.tenantId,
        externalAgentId: claim.external_agent_id,
        externalClaimId: claim.external_claim_id,
        economicSubjectKey: claim.economic_subject,
        claimedAmountMinor: BigInt(claim.claimed_amount.amount_minor),
        currency: 'INR',
        resultType: claim.result_type,
        attributionMethod: claim.attribution_method,
        correlationId: claim.correlation_id ?? null,
        claimTime: new Date(claim.claim_time),
        evidenceTime: claim.evidence_time ? new Date(claim.evidence_time) : null,
        evidenceRefs: claim.evidence_refs,
        requestHash,
        createdAt: now,
      });
      await tx.insert(agentClaimEvidenceBindings).values(
        claim.evidence_refs.map((reference) => ({
          id: `claim_binding_${contentHash({ claimId, evidenceId: reference.evidence_id }).slice(7)}`,
          tenantId: ctx.tenantId,
          claimId,
          ingestEventId: reference.evidence_id,
          evidenceType: reference.evidence_type,
          createdAt: now,
        })),
      );
      await tx.insert(claimEvaluations).values({
        id: evaluationId,
        tenantId: ctx.tenantId,
        claimId,
        evaluationVersion: 0,
        status: 'PENDING',
        createdAt: now,
      });
      await tx.insert(claimEvaluationHeads).values({
        tenantId: ctx.tenantId,
        claimId,
        currentEvaluationId: evaluationId,
        status: 'PENDING',
        evaluationVersion: 0,
        updatedAt: now,
      });
      await appendAuditEntry(tx, ctx, {
        artifactType: 'AGENT_CLAIM',
        artifactId: claimId,
        artifactHash: requestHash,
        actorId: null,
        actorRole: 'worker',
        deterministicId: `audit_claim_${claimId}`,
        details: { operation: 'agent_claim_accepted', claim_id: claimId, idempotent_replay: false },
      });
      await tx.insert(outbox).values({
        id: `outbox_claim_${claimId}`,
        tenantId: ctx.tenantId,
        topic: 'reevaluate-claim.v1',
        domainEventId: claimId,
        payload: { tenant_id: ctx.tenantId, claim_id: claimId },
        status: 'pending',
      });
      return { claimId, status: 'PENDING', idempotentReplay: false };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'agent_claim_capture_attribution_uq')) {
      throw new ClaimAttributionConflictError();
    }
    throw error;
  }
}

export async function evaluateAgentClaimInTransaction(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  claimId: string,
  now = new Date(),
): Promise<ClaimEvaluation> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|claim-evaluation|${claimId}`}, 0))`,
  );
  const rows = await tx
    .select({ claim: agentResultClaims, head: claimEvaluationHeads })
    .from(agentResultClaims)
    .innerJoin(
      claimEvaluationHeads,
      and(
        eq(claimEvaluationHeads.tenantId, agentResultClaims.tenantId),
        eq(claimEvaluationHeads.claimId, agentResultClaims.id),
      ),
    )
    .where(and(eq(agentResultClaims.tenantId, ctx.tenantId), eq(agentResultClaims.id, claimId)))
    .limit(1);
  if (!rows[0]) throw new ClaimEvidenceInvalidError();
  const { claim, head } = rows[0];
  const boundEvidence = await tx
    .select({ binding: agentClaimEvidenceBindings, event: ingestEvents })
    .from(agentClaimEvidenceBindings)
    .innerJoin(
      ingestEvents,
      and(
        eq(ingestEvents.tenantId, agentClaimEvidenceBindings.tenantId),
        eq(ingestEvents.id, agentClaimEvidenceBindings.ingestEventId),
      ),
    )
    .where(
      and(
        eq(agentClaimEvidenceBindings.tenantId, ctx.tenantId),
        eq(agentClaimEvidenceBindings.claimId, claimId),
      ),
    );
  const captureEvents = boundEvidence
    .filter(
      ({ binding, event }) =>
        binding.evidenceType === 'captured_payment' && event.eventType === 'PaymentCaptured',
    )
    .map(({ event }) => event);
  const paymentIds = new Set(
    captureEvents
      .map((event) => stringReference(event.entityReferences, 'payment_id'))
      .filter((value): value is string => value !== null),
  );
  const adjustments = await tx
    .select()
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, claim.economicSubjectKey),
        eq(ingestEvents.quarantineStatus, 'none'),
        eq(ingestEvents.signatureStatus, 'verified'),
        inArray(ingestEvents.eventType, [
          'RefundCreated',
          'RefundProcessed',
          'SyntheticTransferFailed',
        ]),
      ),
    );
  let captures = 0n;
  let refunds = 0n;
  let reversals = 0n;
  for (const item of captureEvents) captures += item.amountMinor ?? 0n;
  const refundsById = new Map<string, bigint>();
  const reversalsById = new Map<string, bigint>();
  for (const item of adjustments) {
    const linkedByPayment = paymentIds.has(
      stringReference(item.entityReferences, 'payment_id') ?? '',
    );
    const linkedByCorrelation = Boolean(
      claim.correlationId && item.correlationId === claim.correlationId,
    );
    if (!linkedByPayment && !linkedByCorrelation) continue;
    if (item.eventType === 'RefundCreated' || item.eventType === 'RefundProcessed') {
      const refundId = stringReference(item.entityReferences, 'refund_id') ?? item.id;
      const existingAmount = refundsById.get(refundId);
      if (existingAmount !== undefined && existingAmount !== (item.amountMinor ?? 0n)) {
        throw new ClaimEvidenceInvalidError();
      }
      refundsById.set(refundId, item.amountMinor ?? 0n);
    }
    if (item.eventType === 'SyntheticTransferFailed') {
      const transferId = stringReference(item.entityReferences, 'transfer_id') ?? item.id;
      reversalsById.set(transferId, item.amountMinor ?? 0n);
    }
  }
  for (const amount of refundsById.values()) refunds += amount;
  for (const amount of reversalsById.values()) reversals += amount;
  // `independently_satisfied_baseline`: value MoneyTrace's OWN authoritative
  // remediation pipeline has already verified-restored for this claim's
  // subject (backend PRD §13.3) — a real, persisted fact, never something
  // the untrusted agent claim can assert about itself. Grouped once per
  // expectation, mirroring `manifest-metrics.ts`'s `verified_restored`.
  const baselineRows = await tx
    .select({ verifiedAmountMinor: verificationRuns.verifiedAmountMinor })
    .from(verificationRunHeads)
    .innerJoin(
      verificationRuns,
      and(
        eq(verificationRuns.tenantId, verificationRunHeads.tenantId),
        eq(verificationRuns.id, verificationRunHeads.currentRunId),
      ),
    )
    .innerJoin(
      actions,
      and(
        eq(actions.tenantId, verificationRunHeads.tenantId),
        eq(actions.id, verificationRunHeads.actionId),
      ),
    )
    .innerJoin(cases, and(eq(cases.tenantId, actions.tenantId), eq(cases.id, actions.caseId)))
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(economicSubjects.subjectKey, claim.economicSubjectKey),
        eq(actions.toolId, 'SIMULATE_TRANSFER_REMEDIATION'),
        eq(verificationRunHeads.status, 'EFFECT_VERIFIED'),
      ),
    );
  let independentlySatisfiedBaseline = 0n;
  for (const row of baselineRows) independentlySatisfiedBaseline += row.verifiedAmountMinor ?? 0n;

  // `linked_disputes` has no distinct canonical event type in this closed
  // vocabulary (architecture §8.2 lists no dispute-specific event) —
  // structurally zero rather than approximated, not silently omitted; see
  // the Gate B4 remediation report.
  const retained = computeRetainedValue({
    eligibleRecoveryCaptures: { amountMinor: captures, currency: 'INR' },
    linkedRefunds: { amountMinor: refunds, currency: 'INR' },
    linkedReversals: { amountMinor: reversals, currency: 'INR' },
    linkedDisputes: { amountMinor: 0n, currency: 'INR' },
    independentlySatisfiedBaseline: {
      amountMinor: independentlySatisfiedBaseline,
      currency: 'INR',
    },
  });
  const priorState = head.status as AgentClaimState;
  let nextState: AgentClaimState;
  if (
    (priorState === 'VERIFIED' || priorState === 'PARTIALLY_VERIFIED') &&
    retained.amountMinor === 0n &&
    refunds > 0n
  ) {
    nextState = 'REVERSED';
  } else if (retained.amountMinor === claim.claimedAmountMinor) {
    nextState = 'VERIFIED';
  } else if (retained.amountMinor > 0n && retained.amountMinor < claim.claimedAmountMinor) {
    nextState = 'PARTIALLY_VERIFIED';
  } else {
    nextState = 'UNRESOLVED';
  }
  const currentRows = await tx
    .select()
    .from(claimEvaluations)
    .where(
      and(
        eq(claimEvaluations.tenantId, ctx.tenantId),
        eq(claimEvaluations.id, head.currentEvaluationId),
      ),
    )
    .limit(1);
  const current = currentRows[0]!;
  const amount =
    nextState === 'VERIFIED' || nextState === 'PARTIALLY_VERIFIED' ? retained.amountMinor : 0n;
  if (current.status === nextState && (current.verifiedAmountMinor ?? 0n) === amount) {
    return toEvaluation(current);
  }
  assertAgentClaimTransition(priorState, nextState);
  const version = head.evaluationVersion + 1;
  const evaluationId = `claim_evaluation_${randomUUID()}`;
  await tx.insert(claimEvaluations).values({
    id: evaluationId,
    tenantId: ctx.tenantId,
    claimId,
    evaluationVersion: version,
    status: nextState,
    verifiedAmountMinor: ['VERIFIED', 'PARTIALLY_VERIFIED', 'REVERSED'].includes(nextState)
      ? amount
      : null,
    currency: ['VERIFIED', 'PARTIALLY_VERIFIED', 'REVERSED'].includes(nextState) ? 'INR' : null,
    createdAt: now,
  });
  await tx
    .update(claimEvaluationHeads)
    .set({
      currentEvaluationId: evaluationId,
      status: nextState,
      evaluationVersion: version,
      updatedAt: now,
    })
    .where(
      and(
        eq(claimEvaluationHeads.tenantId, ctx.tenantId),
        eq(claimEvaluationHeads.claimId, claimId),
        eq(claimEvaluationHeads.evaluationVersion, head.evaluationVersion),
      ),
    );
  await appendAuditEntry(tx, ctx, {
    artifactType: 'CLAIM_EVALUATION',
    artifactId: evaluationId,
    actorId: null,
    actorRole: 'worker',
    deterministicId: `audit_claim_evaluation_${evaluationId}`,
    details: {
      operation: 'claim_evaluated',
      claim_id: claimId,
      status: nextState,
      evaluation_version: version,
    },
  });
  const inserted = await tx
    .select()
    .from(claimEvaluations)
    .where(and(eq(claimEvaluations.tenantId, ctx.tenantId), eq(claimEvaluations.id, evaluationId)))
    .limit(1);
  return toEvaluation(inserted[0]!);
}

export async function evaluateAgentClaim(
  db: Database,
  ctx: TenantContext,
  claimId: string,
  now = new Date(),
) {
  return db.transaction((tx) => evaluateAgentClaimInTransaction(tx, ctx, claimId, now));
}

export async function getAgentClaimView(db: DbExecutor, ctx: TenantContext, claimId: string) {
  const claims = await db
    .select()
    .from(agentResultClaims)
    .where(and(eq(agentResultClaims.tenantId, ctx.tenantId), eq(agentResultClaims.id, claimId)))
    .limit(1);
  if (!claims[0]) return null;
  const evaluations = await db
    .select()
    .from(claimEvaluations)
    .where(and(eq(claimEvaluations.tenantId, ctx.tenantId), eq(claimEvaluations.claimId, claimId)))
    .orderBy(asc(claimEvaluations.evaluationVersion));
  const current = evaluations.at(-1);
  return {
    claim: {
      schema_version: '1.0' as const,
      external_claim_id: claims[0].externalClaimId,
      external_agent_id: claims[0].externalAgentId,
      tenant_id: claims[0].tenantId,
      economic_subject: claims[0].economicSubjectKey,
      claimed_amount: {
        amount_minor: claims[0].claimedAmountMinor.toString(),
        currency: 'INR' as const,
      },
      result_type: claims[0].resultType as 'RECOVERY',
      attribution_method: claims[0].attributionMethod as AgentResultClaim['attribution_method'],
      correlation_id: claims[0].correlationId,
      claim_time: claims[0].claimTime.toISOString(),
      evidence_time: claims[0].evidenceTime?.toISOString() ?? null,
      evidence_refs: claims[0].evidenceRefs as AgentResultClaim['evidence_refs'],
    },
    evaluations: evaluations.map(toEvaluation),
    current_status: (current?.status ?? 'PENDING') as AgentClaimState,
    verified_amount:
      current?.verifiedAmountMinor === null || current?.verifiedAmountMinor === undefined
        ? null
        : { amount_minor: current.verifiedAmountMinor.toString(), currency: 'INR' as const },
  };
}
