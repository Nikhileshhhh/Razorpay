import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { auditEntries } from '../../config/db-schema.js';
import type { DatasetManifest } from '../../contracts/api-endpoints.js';

/**
 * All eight backend PRD §16.1 manifest metrics, computed from PERSISTED rows
 * — never narrative constants (ADR 0002 D7/D9). Shared by the reset-time
 * frozen manifest snapshot (`demo_seed_manifest`, used only for the
 * reset-is-idempotent determinism check) and the live `/v1/overview` /
 * `/v1/demo/status` read models, which must reflect the CURRENT persisted
 * stage and change deterministically as named scenarios advance (§16.1).
 *
 * Registered bucket semantics — see `dataset-flows.ts` for exactly how each
 * bucket is produced:
 *
 * - `records_total`: every `demo_dataset_records` ledger row for this seed
 *   (each already guaranteed 1:1 to an accepted, non-quarantined ingest
 *   event by the unique `demo_dataset_records_ingest_uq` constraint).
 * - `records_matched`: ledger rows whose subject has neither an active
 *   CTRL-01 case nor a real conflicting-duplicate quarantine.
 * - `unresolved_cases` / `unresolved_exposure`: active CTRL-01 cases that
 *   never received a reconciliation attempt (still purely missing-transfer).
 * - `unsafe_candidate_matches_blocked`: active CTRL-01 cases that DID receive
 *   a reconciliation attempt but the candidate set was ambiguous (recorded
 *   audit fact `reconciliation_ambiguous`) — the candidate was correctly
 *   never promoted.
 * - `verified_restored`: current `EFFECT_VERIFIED` `SIMULATE_TRANSFER_REMEDIATION`
 *   verification amounts, grouped/deduplicated once per expectation (ADR D7
 *   — never double-counts the paired CLOSE verification run).
 * - `duplicate_collection_prevented`: current `EFFECT_VERIFIED`
 *   `SUPPRESS_SIMULATED_RECOVERY` verification amounts.
 * - `reversed_recovery`: the original claimed amount of every agent claim
 *   whose current head status is `REVERSED`.
 */
export async function computeDatasetMetrics(
  db: Database,
  tenantId: string,
  seedId: string,
): Promise<DatasetManifest> {
  const totalsRow = await db.execute<{
    records_total: string;
    records_matched: string;
  }>(sql`
    select
      count(*)::text as records_total,
      count(*) filter (
        where not exists (
          select 1 from cases c
          join economic_subjects es
            on es.tenant_id = c.tenant_id and es.id = c.subject_id
          where c.tenant_id = ddr.tenant_id
            and c.control_id = 'CTRL-01'
            and c.is_active_epoch = true
            and es.subject_key = ie.economic_subject_hint
        )
        and not exists (
          select 1 from event_conflicts ec
          where ec.tenant_id = ddr.tenant_id
            and ec.existing_ingest_event_id = ddr.ingest_event_id
        )
      )::text as records_matched
    from demo_dataset_records ddr
    join ingest_events ie
      on ie.tenant_id = ddr.tenant_id and ie.id = ddr.ingest_event_id
    where ddr.tenant_id = ${tenantId} and ddr.seed_id = ${seedId}
  `);
  const totals = totalsRow.rows[0];
  const recordsTotal = Number(totals?.records_total ?? '0');
  const recordsMatched = Number(totals?.records_matched ?? '0');

  // Every reconciliation-ambiguous audit fact names its case in
  // `details.case_id` (see `reconciliation-service.ts`), which distinguishes
  // "unsafe candidate blocked" cases from plain "still unresolved" cases that
  // never received any reconciliation attempt at all.
  const ambiguousAudits = await db
    .select({ details: auditEntries.details })
    .from(auditEntries)
    .where(
      and(eq(auditEntries.tenantId, tenantId), eq(auditEntries.artifactType, 'RECONCILIATION')),
    );
  const ambiguousCaseIds = new Set(
    ambiguousAudits
      .filter(
        (row) => (row.details as { operation?: string }).operation === 'reconciliation_ambiguous',
      )
      .map((row) => (row.details as { case_id?: string }).case_id)
      .filter((id): id is string => Boolean(id)),
  );

  // Scoped to dataset-ledger subjects only (join through `demo_dataset_records`)
  // — a live named scenario's own evidence (e.g. `claim-reversal`'s capture
  // with no transfer) can legitimately open its own CTRL-01 case too, but per
  // ADR 0002 D9 "live scenario-step evidence ... is not a dataset item" and
  // must never be counted in these dataset-derived metrics.
  const ctrl01Cases = await db.execute<{
    id: string;
    exposure_amount_minor: string;
  }>(sql`
    select distinct c.id, c.exposure_amount_minor::text
    from cases c
    join economic_subjects es
      on es.tenant_id = c.tenant_id and es.id = c.subject_id
    join demo_dataset_records ddr
      on ddr.tenant_id = c.tenant_id
      and ddr.seed_id = ${seedId}
      and ddr.economic_subject_key = es.subject_key
    where c.tenant_id = ${tenantId} and c.control_id = 'CTRL-01' and c.is_active_epoch = true
  `);
  let unresolvedCases = 0;
  let unresolvedExposure = 0n;
  let unsafeCandidateMatchesBlocked = 0;
  for (const row of ctrl01Cases.rows) {
    if (ambiguousCaseIds.has(row.id)) {
      unsafeCandidateMatchesBlocked += 1;
    } else {
      unresolvedCases += 1;
      unresolvedExposure += BigInt(row.exposure_amount_minor);
    }
  }

  const verifiedRestoredRow = await db.execute<{ total: string }>(sql`
    select coalesce(sum(t.verified_amount_minor), 0)::text as total
    from (
      select distinct on (c.expectation_id)
        c.expectation_id, vr.verified_amount_minor
      from verification_run_heads vrh
      join verification_runs vr
        on vr.tenant_id = vrh.tenant_id and vr.id = vrh.current_run_id
      join actions a
        on a.tenant_id = vrh.tenant_id and a.id = vrh.action_id
      join cases c
        on c.tenant_id = a.tenant_id and c.id = a.case_id
      where vrh.tenant_id = ${tenantId}
        and a.tool_id = 'SIMULATE_TRANSFER_REMEDIATION'
        and vrh.status = 'EFFECT_VERIFIED'
      order by c.expectation_id, vr.created_at desc
    ) t
  `);
  const verifiedRestored = BigInt(verifiedRestoredRow.rows[0]?.total ?? '0');

  const preventedRow = await db.execute<{ total: string }>(sql`
    select coalesce(sum(vr.verified_amount_minor), 0)::text as total
    from verification_run_heads vrh
    join verification_runs vr
      on vr.tenant_id = vrh.tenant_id and vr.id = vrh.current_run_id
    join actions a
      on a.tenant_id = vrh.tenant_id and a.id = vrh.action_id
    where vrh.tenant_id = ${tenantId}
      and a.tool_id = 'SUPPRESS_SIMULATED_RECOVERY'
      and vrh.status = 'EFFECT_VERIFIED'
  `);
  const duplicateCollectionPrevented = BigInt(preventedRow.rows[0]?.total ?? '0');

  const reversedRow = await db.execute<{ total: string }>(sql`
    select coalesce(sum(arc.claimed_amount_minor), 0)::text as total
    from claim_evaluation_heads ceh
    join agent_result_claims arc
      on arc.tenant_id = ceh.tenant_id and arc.id = ceh.claim_id
    where ceh.tenant_id = ${tenantId} and ceh.status = 'REVERSED'
  `);
  const reversedRecovery = BigInt(reversedRow.rows[0]?.total ?? '0');

  return {
    records_total: recordsTotal,
    records_matched: recordsMatched,
    unresolved_cases: unresolvedCases,
    unsafe_candidate_matches_blocked: unsafeCandidateMatchesBlocked,
    unresolved_exposure: unresolvedExposure.toString(),
    verified_restored: verifiedRestored.toString(),
    duplicate_collection_prevented: duplicateCollectionPrevented.toString(),
    reversed_recovery: reversedRecovery.toString(),
  };
}
