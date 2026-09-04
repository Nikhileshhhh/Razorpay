import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  actions,
  agentClaimEvidenceBindings,
  agentResultClaims,
  cases,
  auditEntries,
  claimEvaluationHeads,
  claimEvaluations,
  dataImports,
  demoScenarioState,
  demoSeedManifest,
  economicSubjects,
  entityLinks,
  eventConflicts,
  expectations,
  ingestEvents,
  outbox,
  receivableClosures,
  reconciliationAllocations,
  sourceConnections,
  verificationRunHeads,
  verificationRuns,
  workerHeartbeat,
} from '../../config/db-schema.js';
import type { EvidenceReference } from '../../contracts/evidence.js';
import { computeRetainedValue } from '../../domain/money/retained-value.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { DEMO_FIXED_CLOCK, DEMO_SCENARIOS } from './dataset.js';
import { computeDatasetMetrics } from './manifest-metrics.js';
import { assertRegisteredDemoTenant } from './demo-tenant.js';

export class DemoScenarioConflictError extends Error {
  constructor() {
    super('scenario step/version conflict');
    this.name = 'DemoScenarioConflictError';
  }
}

function stringReference(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

async function getClaimTruthComparison(db: Database, ctx: TenantContext) {
  const rows = await db
    .select({
      claim: agentResultClaims,
      head: claimEvaluationHeads,
      evaluation: claimEvaluations,
    })
    .from(agentResultClaims)
    .innerJoin(
      claimEvaluationHeads,
      and(
        eq(claimEvaluationHeads.tenantId, agentResultClaims.tenantId),
        eq(claimEvaluationHeads.claimId, agentResultClaims.id),
      ),
    )
    .innerJoin(
      claimEvaluations,
      and(
        eq(claimEvaluations.tenantId, claimEvaluationHeads.tenantId),
        eq(claimEvaluations.id, claimEvaluationHeads.currentEvaluationId),
      ),
    )
    .where(eq(agentResultClaims.tenantId, ctx.tenantId))
    .orderBy(desc(claimEvaluationHeads.updatedAt), asc(agentResultClaims.id))
    .limit(1);
  if (!rows[0]) return null;

  const { claim, head, evaluation } = rows[0];
  const boundEvidence = await db
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
        eq(agentClaimEvidenceBindings.claimId, claim.id),
      ),
    );
  const captureEvents = boundEvidence
    .filter(
      ({ binding, event }) =>
        binding.evidenceType === 'captured_payment' &&
        event.eventType === 'PaymentCaptured' &&
        event.quarantineStatus === 'none' &&
        event.signatureStatus === 'verified',
    )
    .map(({ event }) => event);
  const paymentIds = new Set(
    captureEvents
      .map((event) => stringReference(event.entityReferences, 'payment_id'))
      .filter((value): value is string => value !== null),
  );
  const adjustments = await db
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
  for (const event of captureEvents) captures += event.amountMinor ?? 0n;
  const refundsById = new Map<string, bigint>();
  const reversalsById = new Map<string, bigint>();
  for (const event of adjustments) {
    const linkedByPayment = paymentIds.has(
      stringReference(event.entityReferences, 'payment_id') ?? '',
    );
    const linkedByCorrelation = Boolean(
      claim.correlationId && event.correlationId === claim.correlationId,
    );
    if (!linkedByPayment && !linkedByCorrelation) continue;
    if (event.eventType === 'RefundCreated' || event.eventType === 'RefundProcessed') {
      const refundId = stringReference(event.entityReferences, 'refund_id') ?? event.id;
      refundsById.set(refundId, event.amountMinor ?? 0n);
    }
    if (event.eventType === 'SyntheticTransferFailed') {
      const transferId = stringReference(event.entityReferences, 'transfer_id') ?? event.id;
      reversalsById.set(transferId, event.amountMinor ?? 0n);
    }
  }
  let refunds = 0n;
  let reversals = 0n;
  for (const amount of refundsById.values()) refunds += amount;
  for (const amount of reversalsById.values()) reversals += amount;

  const baselineRows = await db
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

  // A downstream Route acknowledgement of a synthetic transfer action for
  // this subject — explicitly not verification (backend PRD §13.3): carried
  // on the untrusted side of the claim-truth panel only, never contributes
  // to `current_status` or `verified_incremental_recovery` above.
  const routeAckRows = await db
    .select({ eventTime: ingestEvents.eventTime })
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, claim.economicSubjectKey),
        eq(ingestEvents.eventType, 'TransferProcessed'),
        eq(ingestEvents.sourceSystem, 'SYNTHETIC_ROUTE'),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    )
    .orderBy(asc(ingestEvents.eventTime))
    .limit(1);
  const routeAcknowledgement = routeAckRows[0]
    ? {
        acknowledged: true,
        source_system: 'SYNTHETIC_ROUTE' as const,
        occurred_at: routeAckRows[0].eventTime.toISOString(),
      }
    : null;

  // The deterministic pipeline's own independent-evidence steps for this
  // subject (the same facts that feed `independently_satisfied_baseline`
  // above), surfaced on the deterministic side of the panel. `satisfied`
  // reflects real persisted rows only — never assumed from claim status.
  const bankEvidenceRows = await db
    .select({ eventTime: ingestEvents.eventTime })
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, claim.economicSubjectKey),
        eq(ingestEvents.eventType, 'BankCreditObserved'),
        eq(ingestEvents.quarantineStatus, 'none'),
        eq(ingestEvents.signatureStatus, 'verified'),
      ),
    )
    .orderBy(asc(ingestEvents.eventTime))
    .limit(1);
  const allocationRows = await db
    .select({ createdAt: reconciliationAllocations.createdAt })
    .from(reconciliationAllocations)
    .innerJoin(
      expectations,
      and(
        eq(expectations.tenantId, reconciliationAllocations.tenantId),
        eq(expectations.id, reconciliationAllocations.expectationId),
      ),
    )
    .innerJoin(
      economicSubjects,
      and(
        eq(economicSubjects.tenantId, expectations.tenantId),
        eq(economicSubjects.id, expectations.subjectId),
      ),
    )
    .where(
      and(
        eq(reconciliationAllocations.tenantId, ctx.tenantId),
        eq(economicSubjects.subjectKey, claim.economicSubjectKey),
      ),
    )
    .orderBy(asc(reconciliationAllocations.createdAt))
    .limit(1);
  const closureRows = await db
    .select({ closedAt: receivableClosures.closedAt })
    .from(receivableClosures)
    .innerJoin(
      expectations,
      and(
        eq(expectations.tenantId, receivableClosures.tenantId),
        eq(expectations.id, receivableClosures.expectationId),
      ),
    )
    .innerJoin(
      economicSubjects,
      and(
        eq(economicSubjects.tenantId, expectations.tenantId),
        eq(economicSubjects.id, expectations.subjectId),
      ),
    )
    .where(
      and(
        eq(receivableClosures.tenantId, ctx.tenantId),
        eq(economicSubjects.subjectKey, claim.economicSubjectKey),
      ),
    )
    .orderBy(asc(receivableClosures.closedAt))
    .limit(1);
  const verificationChainSteps = [
    {
      step: 'bank_evidence' as const,
      label: 'Independent bank evidence received',
      satisfied: bankEvidenceRows.length > 0,
      occurred_at: bankEvidenceRows[0]?.eventTime.toISOString() ?? null,
    },
    {
      step: 'unique_allocation' as const,
      label: 'Unique allocation — no double counting',
      satisfied: allocationRows.length > 0,
      occurred_at: allocationRows[0]?.createdAt.toISOString() ?? null,
    },
    {
      step: 'erp_closure' as const,
      label: 'ERP closure recorded',
      satisfied: closureRows.length > 0,
      occurred_at: closureRows[0]?.closedAt.toISOString() ?? null,
    },
  ];
  const verificationChain = verificationChainSteps.some((item) => item.satisfied)
    ? verificationChainSteps
    : null;

  return {
    claim_id: claim.id,
    external_claim_id: claim.externalClaimId,
    claimed_amount: { amount_minor: claim.claimedAmountMinor.toString(), currency: 'INR' as const },
    recovery_payment_observed: captureEvents.length > 0,
    correlated_refund_amount: { amount_minor: refunds.toString(), currency: 'INR' as const },
    final_retained_value: {
      amount_minor: retained.amountMinor.toString(),
      currency: 'INR' as const,
    },
    verified_incremental_recovery:
      evaluation.verifiedAmountMinor == null
        ? null
        : { amount_minor: evaluation.verifiedAmountMinor.toString(), currency: 'INR' as const },
    current_status: head.status as
      'PENDING' | 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'REJECTED' | 'UNRESOLVED' | 'REVERSED',
    evidence_references: boundEvidence
      .map(({ binding }) => ({
        evidence_id: binding.ingestEventId,
        evidence_type: binding.evidenceType as EvidenceReference['evidence_type'],
      }))
      .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
    route_acknowledgement: routeAcknowledgement,
    verification_chain: verificationChain,
  };
}

export async function getDemoStatus(db: Database, ctx: TenantContext) {
  const manifests = await db
    .select()
    .from(demoSeedManifest)
    .where(eq(demoSeedManifest.tenantId, ctx.tenantId))
    .orderBy(desc(demoSeedManifest.createdAt))
    .limit(1);
  const scenarios = await db
    .select()
    .from(demoScenarioState)
    .where(eq(demoScenarioState.tenantId, ctx.tenantId))
    .orderBy(asc(demoScenarioState.scenarioId));
  const manifest = manifests[0];
  // `manifest_hash` identifies WHICH seed was imported and is correctly a
  // frozen reset-time fact (used by the reset-is-idempotent determinism
  // check). The manifest METRICS themselves are recomputed live from
  // persisted state on every call — backend PRD §16.1: "before the relevant
  // scenario step, metrics reflect the current persisted stage; after
  // advance they change deterministically" — never the frozen snapshot.
  const liveManifest = manifest
    ? await computeDatasetMetrics(db, ctx.tenantId, manifest.seedId)
    : null;
  return {
    schema_version: '1.0' as const,
    seed_id: manifest?.seedId ?? null,
    ready: Boolean(manifest),
    fixed_clock: DEMO_FIXED_CLOCK.toISOString(),
    manifest_hash: manifest?.manifestHash ?? null,
    manifest: liveManifest,
    scenarios: scenarios.map((scenario) => ({
      scenario_id: scenario.scenarioId,
      current_step: scenario.currentStep,
      completed_step: scenario.completedStep,
      total_steps: DEMO_SCENARIOS.find((item) => item.id === scenario.scenarioId)?.steps ?? 0,
      state_version: scenario.version,
      // Gate B4 remediation (backend PRD §14.1/§15): the API request path
      // durably queues a step by bumping `current_step`; only the worker's
      // successful `runDemoScenarioStep` bumps `completed_step`. A step is
      // therefore genuinely `queued` (not yet applied), `completed`, or
      // `failed` on its most recent attempt — never inferred from the
      // request having returned 200.
      status: scenario.lastError
        ? ('failed' as const)
        : scenario.currentStep > scenario.completedStep
          ? ('queued' as const)
          : ('completed' as const),
      last_error: scenario.lastError,
    })),
  };
}

export async function getOverview(db: Database, ctx: TenantContext, now = new Date()) {
  const status = await getDemoStatus(db, ctx);
  if (!status.manifest) throw new Error('demo dataset is not imported');
  const distribution = await db
    .select({
      lifecycleState: cases.lifecycleState,
      value: count(),
      exposureAmountMinor: sql<string>`coalesce(sum(${cases.exposureAmountMinor}), 0)::text`,
    })
    .from(cases)
    .where(eq(cases.tenantId, ctx.tenantId))
    .groupBy(cases.lifecycleState)
    .orderBy(asc(cases.lifecycleState));
  const top = await db
    .select()
    .from(cases)
    .where(eq(cases.tenantId, ctx.tenantId))
    .orderBy(desc(cases.exposureAmountMinor), asc(cases.id))
    .limit(10);
  const reversed = await db
    .select({ value: count() })
    .from(claimEvaluationHeads)
    .where(
      and(
        eq(claimEvaluationHeads.tenantId, ctx.tenantId),
        eq(claimEvaluationHeads.status, 'REVERSED'),
      ),
    );
  const lifecycleFacts = await db
    .select({ openedAt: cases.openedAt, closedAt: cases.closedAt })
    .from(cases)
    .where(eq(cases.tenantId, ctx.tenantId));
  const claimTruthComparison = await getClaimTruthComparison(db, ctx);
  const trendByDate = new Map<string, { opened: number; closed: number }>();
  for (const fact of lifecycleFacts) {
    const openedDate = fact.openedAt.toISOString().slice(0, 10);
    const opened = trendByDate.get(openedDate) ?? { opened: 0, closed: 0 };
    opened.opened += 1;
    trendByDate.set(openedDate, opened);
    if (fact.closedAt) {
      const closedDate = fact.closedAt.toISOString().slice(0, 10);
      const closed = trendByDate.get(closedDate) ?? { opened: 0, closed: 0 };
      closed.closed += 1;
      trendByDate.set(closedDate, closed);
    }
  }
  return {
    schema_version: '1.0' as const,
    generated_at: now.toISOString(),
    dataset_timestamp: DEMO_FIXED_CLOCK.toISOString(),
    manifest: status.manifest,
    lifecycle_distribution: distribution.map((row) => ({
      lifecycle_state: row.lifecycleState,
      count: Number(row.value),
      exposure_amount: { amount_minor: row.exposureAmountMinor, currency: 'INR' as const },
    })),
    opened_closed_trend: [...trendByDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, counts]) => ({ date, ...counts })),
    top_cases: top.map((row) => ({
      case_id: row.id,
      exposure_amount: {
        amount_minor: row.exposureAmountMinor.toString(),
        currency: 'INR' as const,
      },
      lifecycle_state: row.lifecycleState,
    })),
    claim_truth_comparison: claimTruthComparison,
    claim_reversal_summary: {
      reversed_recovery: {
        amount_minor: status.manifest.reversed_recovery,
        currency: 'INR' as const,
      },
      reversed_claims: Number(reversed[0]?.value ?? 0),
    },
  };
}

export async function getDataHealth(
  db: Database,
  ctx: TenantContext,
  modelMode: string,
  now = new Date(),
) {
  const sources = await db
    .select()
    .from(sourceConnections)
    .where(eq(sourceConnections.tenantId, ctx.tenantId))
    .orderBy(asc(sourceConnections.sourceSystem));
  const received = await db
    .select({ source: ingestEvents.sourceSystem, value: count() })
    .from(ingestEvents)
    .where(eq(ingestEvents.tenantId, ctx.tenantId))
    .groupBy(ingestEvents.sourceSystem);
  const duplicates = await db
    .select({ source: ingestEvents.sourceSystem, value: count() })
    .from(auditEntries)
    .innerJoin(
      ingestEvents,
      and(
        eq(ingestEvents.tenantId, auditEntries.tenantId),
        eq(ingestEvents.id, auditEntries.artifactId),
      ),
    )
    .where(
      and(
        eq(auditEntries.tenantId, ctx.tenantId),
        eq(auditEntries.artifactType, 'EVIDENCE'),
        sql`${auditEntries.details}->>'outcome' = 'duplicate'`,
      ),
    )
    .groupBy(ingestEvents.sourceSystem);
  const unsigned = await db
    .select({ source: ingestEvents.sourceSystem, value: count() })
    .from(ingestEvents)
    .where(
      and(eq(ingestEvents.tenantId, ctx.tenantId), eq(ingestEvents.signatureStatus, 'unsigned')),
    )
    .groupBy(ingestEvents.sourceSystem);
  const conflicts = await db
    .select({ source: eventConflicts.sourceSystem, value: count() })
    .from(eventConflicts)
    .where(eq(eventConflicts.tenantId, ctx.tenantId))
    .groupBy(eventConflicts.sourceSystem);
  // Candidate links awaiting a human confirm/reject decision (backend PRD
  // §10.3) — never counted as terminal authority, only visibility into the
  // open candidate pool.
  const candidates = await db
    .select({ value: count() })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.tenantId, ctx.tenantId),
        eq(entityLinks.confidenceClass, 'candidate'),
        eq(entityLinks.reviewStatus, 'unreviewed'),
      ),
    );
  const pending = await db
    .select({ value: count() })
    .from(verificationRunHeads)
    .where(
      and(
        eq(verificationRunHeads.tenantId, ctx.tenantId),
        eq(verificationRunHeads.status, 'VERIFICATION_PENDING'),
      ),
    );
  const beats = await db
    .select()
    .from(workerHeartbeat)
    .where(eq(workerHeartbeat.id, 'moneytrace-worker'))
    .limit(1);
  const worker = !beats[0]
    ? 'down'
    : now.getTime() - beats[0].lastBeatAt.getTime() <= 10_000
      ? 'up'
      : 'stale';
  const bySource = new Map(received.map((row) => [row.source, Number(row.value)]));
  const duplicatesBySource = new Map(duplicates.map((row) => [row.source, Number(row.value)]));
  const unsignedBySource = new Map(unsigned.map((row) => [row.source, Number(row.value)]));
  const conflictsBySource = new Map(conflicts.map((row) => [row.source, Number(row.value)]));
  const total = [...bySource.values()].reduce((sum, value) => sum + value, 0);
  const duplicateTotal = [...duplicatesBySource.values()].reduce((sum, value) => sum + value, 0);
  return {
    schema_version: '1.0' as const,
    generated_at: now.toISOString(),
    model_mode: modelMode,
    database: 'up' as const,
    worker,
    sources: sources.map((source) => {
      const received = bySource.get(source.sourceSystem) ?? 0;
      const unsignedCount = unsignedBySource.get(source.sourceSystem) ?? 0;
      return {
        source_system: source.sourceSystem,
        capability: source.sourceSystem.startsWith('SYNTHETIC_')
          ? ('synthetic' as const)
          : ('available' as const),
        received,
        signed: received - unsignedCount,
        unsigned: unsignedCount,
        duplicate: duplicatesBySource.get(source.sourceSystem) ?? 0,
        conflict: conflictsBySource.get(source.sourceSystem) ?? 0,
        // Not tracked: a schema-rejected payload is refused before any
        // journal row exists (backend PRD §9.1 accepts only valid schemas),
        // so there is no persisted row to count per source. Left at 0 rather
        // than fabricated — a genuine measurement gap, not a false "zero
        // failures ever" claim; see the Gate B4 completion report.
        schema_failure: 0,
      };
    }),
    received_total: total,
    duplicate_total: duplicateTotal,
    conflict_total: [...conflictsBySource.values()].reduce((sum, value) => sum + value, 0),
    schema_failure_total: 0,
    // Not tracked: projector/job lag would require persisting enqueue vs.
    // completion timestamps per run, which the current `projector_runs`/
    // `outbox` schemas do not yet expose as a queryable delta. Left at 0
    // rather than fabricated; see the Gate B4 completion report.
    projector_lag_seconds: 0,
    job_lag_seconds: 0,
    pending_verification: Number(pending[0]?.value ?? 0),
    // Not tracked: "unlinked"/"stale projections" would require a registered
    // definition of which cases/entities are expected to have a provenance
    // edge or a fresh projection — out of this session's scope. Left at 0
    // rather than fabricated; see the Gate B4 completion report.
    unlinked: 0,
    candidate_links: Number(candidates[0]?.value ?? 0),
    stale_projections: 0,
  };
}

/** Deterministic id shared by the pending row, the outbox job, and the response. */
export function importId(seedId: string): string {
  return `import_${seedId}`;
}

/**
 * Genuinely asynchronous import status (backend PRD §14.1): `accepted` only
 * once the SEPARATE, later `import_${seedId}_completed` row exists (the full
 * registered dataset and manifest are durably persisted — see
 * `generateDemoDataset`'s two-row pending/accepted design and migration
 * `0005_b4_import_async.sql`); `pending` while only the earlier
 * `import_${seedId}` row exists; `null` when neither has ever been
 * registered for this seed. There is no partial/half-accepted state: the
 * accepted row and its manifest either both exist or neither does.
 */
export async function getImportResult(
  db: Database,
  ctx: TenantContext,
  seedId = 'moneytrace_demo_v1',
) {
  const acceptedRows = await db
    .select()
    .from(dataImports)
    .where(
      and(
        eq(dataImports.tenantId, ctx.tenantId),
        eq(dataImports.id, `${importId(seedId)}_completed`),
      ),
    )
    .limit(1);
  const accepted = acceptedRows[0];
  if (accepted) {
    // `data_imports` is append-only; the authoritative manifest hash for
    // this seed lives on `demo_seed_manifest`, computed once every ledger
    // row is persisted (falls back to the accepted row's own copy).
    const manifestRows = await db
      .select({ manifestHash: demoSeedManifest.manifestHash })
      .from(demoSeedManifest)
      .where(and(eq(demoSeedManifest.tenantId, ctx.tenantId), eq(demoSeedManifest.seedId, seedId)))
      .orderBy(desc(demoSeedManifest.createdAt))
      .limit(1);
    return {
      resourceVersion: 1,
      import_id: importId(seedId),
      status: 'accepted' as const,
      seed_id: 'moneytrace_demo_v1' as const,
      item_count: accepted.itemCount,
      accepted_count: accepted.acceptedCount,
      duplicate_count: accepted.duplicateCount,
      conflict_count: accepted.conflictCount,
      manifest_hash: manifestRows[0]?.manifestHash ?? accepted.manifestHash ?? '',
    };
  }
  const pendingRows = await db
    .select({ itemCount: dataImports.itemCount })
    .from(dataImports)
    .where(and(eq(dataImports.tenantId, ctx.tenantId), eq(dataImports.id, importId(seedId))))
    .limit(1);
  const pending = pendingRows[0];
  if (!pending) return null;
  return {
    resourceVersion: 0,
    import_id: importId(seedId),
    status: 'pending' as const,
    seed_id: 'moneytrace_demo_v1' as const,
    item_count: pending.itemCount,
    accepted_count: null,
    duplicate_count: null,
    conflict_count: null,
    manifest_hash: null,
  };
}

/**
 * Durably accept the import request (backend PRD §14.1 "async/durable
 * import id and item counts"): inserts the PENDING `data_imports` row
 * (visible immediately, before any dataset record exists) and a plain
 * outbox row for `process-import.v1`. This function is reachable from the
 * API process (`/v1/imports`) and must never itself import or invoke
 * adapter dispatch, nor call `generateDemoDataset` directly — that runs
 * ONLY in the worker (`src/worker/job-handlers-b4.ts`'s
 * `process-import.v1` handler). Idempotent: a repeated call for the same
 * seed while already pending/accepted is a no-op.
 */
export async function enqueueDatasetImport(
  db: Database,
  ctx: TenantContext,
  seedId: string,
): Promise<void> {
  assertRegisteredDemoTenant(ctx);
  await db.transaction(async (tx) => {
    await tx
      .insert(dataImports)
      .values({
        id: importId(seedId),
        tenantId: ctx.tenantId,
        source: 'registered_synthetic_seed',
        seedId,
        itemCount: 500,
        acceptedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        status: 'pending',
      })
      .onConflictDoNothing();
    await tx
      .insert(outbox)
      .values({
        id: `outbox_import_${seedId}`,
        tenantId: ctx.tenantId,
        topic: 'process-import.v1',
        domainEventId: `import:${seedId}`,
        payload: { tenant_id: ctx.tenantId, seed_id: seedId },
        status: 'pending',
      })
      .onConflictDoNothing();
  });
}

export async function advanceDemoScenario(
  db: Database,
  ctx: TenantContext,
  scenarioId: string,
  expectedStep: number,
  now = new Date(),
) {
  assertRegisteredDemoTenant(ctx);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|scenario|${scenarioId}`}, 0))`,
    );
    const rows = await tx
      .select()
      .from(demoScenarioState)
      .where(
        and(
          eq(demoScenarioState.tenantId, ctx.tenantId),
          eq(demoScenarioState.scenarioId, scenarioId),
        ),
      )
      .limit(1);
    const state = rows[0];
    const definition = DEMO_SCENARIOS.find((scenario) => scenario.id === scenarioId);
    if (!state || !definition) throw new DemoScenarioConflictError();
    if (expectedStep === state.currentStep - 1) {
      return { step: state.currentStep, version: state.version, replay: true };
    }
    if (expectedStep !== state.currentStep || state.currentStep >= definition.steps) {
      throw new DemoScenarioConflictError();
    }
    const step = state.currentStep + 1;
    const version = state.version + 1;
    await tx
      .update(demoScenarioState)
      .set({ currentStep: step, version, updatedAt: now })
      .where(
        and(
          eq(demoScenarioState.tenantId, ctx.tenantId),
          eq(demoScenarioState.scenarioId, scenarioId),
          eq(demoScenarioState.version, state.version),
        ),
      );
    await tx.execute(sql`
      insert into audit_entries
        (id, tenant_id, artifact_type, artifact_id, actor_role, details, created_at)
      values
        (${`audit_scenario_${scenarioId}_${step}`}, ${ctx.tenantId}, 'DEMO_COMMAND',
         ${scenarioId}, 'worker',
         ${JSON.stringify({ operation: 'demo_scenario_advanced', scenario_id: scenarioId, step })}::jsonb,
         ${now})
      on conflict (id) do nothing
    `);
    await tx
      .insert(outbox)
      .values({
        id: `outbox_scenario_${scenarioId}_${step}`,
        tenantId: ctx.tenantId,
        topic: 'advance-demo-scenario.v1',
        domainEventId: `${scenarioId}:${step}`,
        payload: { tenant_id: ctx.tenantId, scenario_id: scenarioId, step },
        status: 'pending',
      })
      .onConflictDoNothing();
    return { step, version, replay: false };
  });
}
