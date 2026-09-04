import { and, eq } from 'drizzle-orm';
import { contentHash } from '../../config/hashing.js';
import type { Database } from '../../config/db.js';
import type { Env } from '../../config/env.js';
import {
  auditEntries,
  dataImports,
  demoDatasetRecords,
  demoScenarioState,
  demoSeedManifest,
  ingestEvents,
} from '../../config/db-schema.js';
import type { DatasetManifest } from '../../contracts/api-endpoints.js';
import { computeDatasetMetrics } from './manifest-metrics.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { assertRegisteredDemoTenant } from './demo-tenant.js';
import {
  seedConflictedRecord,
  seedDuplicateRecoveryPreventedRecord,
  seedMatchedRecord,
  seedUnresolvedRecord,
  seedUnsafeCandidateRecord,
  type DatasetFlowResult,
} from './dataset-flows.js';

export const DEMO_FIXED_CLOCK = new Date('2026-08-25T05:20:00.000Z');
export const DEMO_SEED_ID = 'moneytrace_demo_v1';
export const DEMO_SCENARIOS = [
  { id: 'claim-reversal', steps: 3 },
  { id: 'missing-transfer-remediation', steps: 6 },
  { id: 'conflicting-bank-evidence', steps: 3 },
  { id: 'duplicate-replay', steps: 4 },
] as const;

export interface GeneratedDataset {
  readonly importId: string;
  readonly manifest: DatasetManifest;
  readonly manifestHash: string;
}

export interface GenerateDemoDatasetOptions {
  /** Bounded parallelism for independent records; defaults to serial worker behavior. */
  readonly concurrency?: number;
}

async function runOrdinalRange(
  first: number,
  last: number,
  concurrency: number,
  run: (ordinal: number) => Promise<void>,
): Promise<void> {
  const ordinals = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ordinals.length) }, async () => {
      while (nextIndex < ordinals.length) {
        const ordinal = ordinals[nextIndex];
        nextIndex += 1;
        if (ordinal !== undefined) await run(ordinal);
      }
    }),
  );
}

/**
 * Backend PRD §16.1 dataset distribution (ADR 0002 D9): 500 dataset-ledger
 * records, each produced through the REAL acceptance/projection/control
 * (and, for one record, investigation/policy/action/verification) pipeline —
 * never a hand-rolled row insert. See `dataset-flows.ts` for exactly how
 * each bucket is produced and what real persisted state distinguishes it.
 *
 *   1–467   MATCHED               (467) — clean, no case ever opens
 *   468     MATCHED + prevented   (1)   — also drives `duplicate_collection_prevented`
 *   469–484 UNRESOLVED            (16)  — active CTRL-01 case, exposure 8,000,000 each
 *   485–488 UNSAFE CANDIDATE      (4)   — CTRL-01 case + ambiguous reconciliation abstention
 *   489–500 OTHER UNMATCHED       (12)  — clean shape + a real conflicting duplicate
 *
 * `records_matched = 468` (467 + the 1 dual-purpose record); the 12 "other
 * unmatched" are a genuine data-quality reason distinct from the two metrics
 * the PRD names, not folded into either.
 */
const MATCHED_COUNT = 467;
const UNRESOLVED_COUNT = 16;
const UNSAFE_COUNT = 4;
const CONFLICTED_COUNT = 12;
const DUPLICATE_RECOVERY_PREVENTED_ORDINAL = MATCHED_COUNT + 1; // 468
const UNRESOLVED_RANGE = [
  DUPLICATE_RECOVERY_PREVENTED_ORDINAL + 1,
  DUPLICATE_RECOVERY_PREVENTED_ORDINAL + UNRESOLVED_COUNT,
] as const; // 469..484
const UNSAFE_RANGE = [UNRESOLVED_RANGE[1] + 1, UNRESOLVED_RANGE[1] + UNSAFE_COUNT] as const; // 485..488
const CONFLICTED_RANGE = [UNSAFE_RANGE[1] + 1, UNSAFE_RANGE[1] + CONFLICTED_COUNT] as const; // 489..500

/**
 * Exact per-record capture amount whose real 91%/9% seller-allocation split
 * (`allocateSellerObligation`, round-half-even) produces a clean ₹80,000
 * exposure — verified directly against the money kernel, not approximated:
 * `roundHalfEven(8_791_209 * 91, 100) === 8_000_000`. Sixteen such records
 * sum to the required `unresolved_exposure = 128,000,000`.
 */
const UNRESOLVED_CAPTURE_AMOUNT_MINOR = 8_791_209n;
const DUPLICATE_RECOVERY_PREVENTED_AMOUNT_MINOR = 50_000_000n;

async function primaryEventSourceInfo(
  db: Database,
  ingestEventId: string,
): Promise<{ sourceSystem: string; sourceEventId: string }> {
  const rows = await db
    .select({ sourceSystem: ingestEvents.sourceSystem, sourceEventId: ingestEvents.sourceEventId })
    .from(ingestEvents)
    .where(eq(ingestEvents.id, ingestEventId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`dataset record ingest event ${ingestEventId} was not found`);
  return { sourceSystem: row.sourceSystem, sourceEventId: row.sourceEventId ?? ingestEventId };
}

async function recordDatasetLedgerRow(
  db: Database,
  tenantId: string,
  seedId: string,
  importId: string,
  ordinal: number,
  result: DatasetFlowResult,
): Promise<void> {
  const source = await primaryEventSourceInfo(db, result.primaryIngestEventId);
  // Conflict-safe: a retry after a crash re-runs the (idempotent) evidence
  // flow for this ordinal and must not fail on the ledger row it already
  // wrote before the crash.
  await db
    .insert(demoDatasetRecords)
    .values({
      id: `dataset_record_${seedId}_${ordinal.toString().padStart(3, '0')}`,
      tenantId,
      seedId,
      ordinal,
      importId,
      sourceSystem: source.sourceSystem,
      sourceEventId: source.sourceEventId,
      economicSubjectKey: result.subjectKey,
      ingestEventId: result.primaryIngestEventId,
      createdAt: DEMO_FIXED_CLOCK,
    })
    .onConflictDoNothing();
}

/**
 * Generate the deterministic 500-record dataset and compute its manifest
 * from the resulting persisted state (backend PRD §16.1). Genuinely
 * asynchronous and retry-repairable (§14.1): the PENDING `data_imports` row
 * is durable and visible from the moment this starts (or, when reached via
 * `POST /v1/imports`, from the moment the request was durably enqueued —
 * see `enqueueDatasetImport`), and the ACCEPTED row is a SEPARATE, later
 * append-only fact inserted only once the complete 500-record dataset and
 * manifest genuinely exist. `data_imports` is append-only (no UPDATE path),
 * so a partial dataset is structurally never presented as accepted merely
 * by flipping a status column — there are two distinct rows, not one
 * mutated row (migration `0005_b4_import_async.sql`).
 *
 * Runs against the plain connection pool, not a caller-owned transaction:
 * several buckets (notably the duplicate-recovery-prevention record) call
 * public application services that each open and commit their own
 * transaction, so the 500 records commit as an ordered SEQUENCE of
 * independently atomic, individually idempotent steps, not one
 * all-or-nothing transaction (`docs/GATE_B4_IMPLEMENTATION_PLAN.md` §5.1 —
 * an honest tradeoff, not a false atomicity claim). Every insert in this
 * function is conflict-safe, so a crash-and-retry (the SAME job redelivered,
 * or a fresh manual call) safely re-runs to completion without ever
 * duplicating a ledger row, a scenario-state row, or the final accepted fact
 * — real retry-repair, not merely "no crash on retry".
 */
export async function generateDemoDataset(
  db: Database,
  env: Pick<Env, 'MODEL_PROVIDER' | 'MODEL_API_URL' | 'MODEL_API_KEY'>,
  ctx: TenantContext,
  seedId = DEMO_SEED_ID,
  options: GenerateDemoDatasetOptions = {},
): Promise<GeneratedDataset> {
  assertRegisteredDemoTenant(ctx);
  const tenantId = ctx.tenantId;
  const importId = `import_${seedId}`;
  const acceptedImportId = `import_${seedId}_completed`;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 8));

  const alreadyAccepted = await db
    .select({ id: dataImports.id })
    .from(dataImports)
    .where(and(eq(dataImports.tenantId, tenantId), eq(dataImports.id, acceptedImportId)))
    .limit(1);
  if (alreadyAccepted[0]) {
    const manifestRows = await db
      .select()
      .from(demoSeedManifest)
      .where(and(eq(demoSeedManifest.tenantId, tenantId), eq(demoSeedManifest.seedId, seedId)))
      .limit(1);
    const existing = manifestRows[0];
    if (existing) {
      await db
        .insert(auditEntries)
        .values({
          id: `audit_import_${importId}`,
          tenantId,
          artifactType: 'DATASET_IMPORT',
          artifactId: importId,
          artifactHash: existing.manifestHash,
          actorRole: 'worker',
          details: { operation: 'dataset_imported', import_id: importId, accepted_count: 500 },
          createdAt: DEMO_FIXED_CLOCK,
        })
        .onConflictDoNothing();
      return {
        importId,
        manifest: existing.metrics as DatasetManifest,
        manifestHash: existing.manifestHash,
      };
    }
  }

  // Durable, visible the moment generation starts (idempotent — a direct
  // `resetDemoDatabase` call and a worker-processed `process-import.v1` job
  // both reach here; whichever runs first wins, the other is a no-op).
  await db
    .insert(dataImports)
    .values({
      id: importId,
      tenantId,
      source: 'registered_synthetic_seed',
      seedId,
      itemCount: 500,
      acceptedCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      status: 'pending',
      createdAt: DEMO_FIXED_CLOCK,
    })
    .onConflictDoNothing();

  const completedRows = await db
    .select({ ordinal: demoDatasetRecords.ordinal })
    .from(demoDatasetRecords)
    .where(and(eq(demoDatasetRecords.tenantId, tenantId), eq(demoDatasetRecords.seedId, seedId)));
  const completedOrdinals = new Set(completedRows.map((row) => row.ordinal));

  async function persistRecord(
    ordinal: number,
    create: () => Promise<DatasetFlowResult>,
  ): Promise<void> {
    if (completedOrdinals.has(ordinal)) return;
    const result = await create();
    await recordDatasetLedgerRow(db, tenantId, seedId, importId, ordinal, result);
    completedOrdinals.add(ordinal);
  }

  await runOrdinalRange(1, MATCHED_COUNT, concurrency, (ordinal) =>
    persistRecord(ordinal, () =>
      seedMatchedRecord(db, ctx, ordinal, DEMO_FIXED_CLOCK, DEMO_FIXED_CLOCK),
    ),
  );

  await persistRecord(DUPLICATE_RECOVERY_PREVENTED_ORDINAL, () =>
    seedDuplicateRecoveryPreventedRecord(
      db,
      ctx,
      DUPLICATE_RECOVERY_PREVENTED_ORDINAL,
      DEMO_FIXED_CLOCK,
      DEMO_FIXED_CLOCK,
      env,
      DUPLICATE_RECOVERY_PREVENTED_AMOUNT_MINOR,
    ),
  );

  const captureTimeExpired = new Date(DEMO_FIXED_CLOCK.getTime() - 2 * 60 * 60 * 1000);
  await runOrdinalRange(UNRESOLVED_RANGE[0], UNRESOLVED_RANGE[1], concurrency, (ordinal) =>
    persistRecord(ordinal, () =>
      seedUnresolvedRecord(
        db,
        ctx,
        ordinal,
        captureTimeExpired,
        DEMO_FIXED_CLOCK,
        UNRESOLVED_CAPTURE_AMOUNT_MINOR,
      ),
    ),
  );

  await runOrdinalRange(UNSAFE_RANGE[0], UNSAFE_RANGE[1], concurrency, (ordinal) =>
    persistRecord(ordinal, () =>
      seedUnsafeCandidateRecord(
        db,
        ctx,
        ordinal,
        captureTimeExpired,
        DEMO_FIXED_CLOCK,
        UNRESOLVED_CAPTURE_AMOUNT_MINOR,
      ),
    ),
  );

  await runOrdinalRange(CONFLICTED_RANGE[0], CONFLICTED_RANGE[1], concurrency, (ordinal) =>
    persistRecord(ordinal, () =>
      seedConflictedRecord(db, ctx, ordinal, DEMO_FIXED_CLOCK, DEMO_FIXED_CLOCK),
    ),
  );

  for (const scenario of DEMO_SCENARIOS) {
    await db
      .insert(demoScenarioState)
      .values({
        id: `scenario_state_${scenario.id}`,
        tenantId,
        scenarioId: scenario.id,
        currentStep: 0,
        version: 0,
        updatedAt: DEMO_FIXED_CLOCK,
      })
      .onConflictDoNothing();
  }

  const manifest = await computeDatasetMetrics(db, tenantId, seedId);

  // Stable ledger facts only — ordinal + deterministic source_event_id, never
  // a random database surrogate id, audit sequence value, or row-return
  // order (backend PRD §16.1, plan §12.2).
  const ledgerFacts = await db
    .select({
      ordinal: demoDatasetRecords.ordinal,
      sourceEventId: demoDatasetRecords.sourceEventId,
    })
    .from(demoDatasetRecords)
    .where(and(eq(demoDatasetRecords.tenantId, tenantId), eq(demoDatasetRecords.seedId, seedId)));
  const stableLedger = [...ledgerFacts].sort((a, b) => a.ordinal - b.ordinal);

  const manifestHash = contentHash({
    seed_id: seedId,
    fixed_clock: DEMO_FIXED_CLOCK.toISOString(),
    ledger: stableLedger,
    manifest,
  });

  await db
    .insert(demoSeedManifest)
    .values({
      id: `manifest_${seedId}`,
      tenantId,
      seedId,
      manifestHash,
      metrics: manifest,
      createdAt: DEMO_FIXED_CLOCK,
    })
    .onConflictDoNothing();
  // The accepted fact — a SEPARATE append-only row from the pending one
  // inserted at the top of this function (see the function doc comment).
  await db
    .insert(dataImports)
    .values({
      id: acceptedImportId,
      tenantId,
      source: 'registered_synthetic_seed',
      seedId,
      itemCount: 500,
      acceptedCount: 500,
      duplicateCount: 0,
      conflictCount: CONFLICTED_COUNT,
      status: 'accepted',
      manifestHash,
      createdAt: DEMO_FIXED_CLOCK,
    })
    .onConflictDoNothing();
  await db
    .insert(auditEntries)
    .values({
      id: `audit_import_${importId}`,
      tenantId,
      artifactType: 'DATASET_IMPORT',
      artifactId: importId,
      artifactHash: manifestHash,
      actorRole: 'worker',
      details: { operation: 'dataset_imported', import_id: importId, accepted_count: 500 },
      createdAt: DEMO_FIXED_CLOCK,
    })
    .onConflictDoNothing();

  return { importId, manifest, manifestHash };
}
