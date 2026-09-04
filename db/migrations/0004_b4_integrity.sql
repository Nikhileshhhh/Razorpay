-- Gate B4 integrity migration. Forward-only and idempotent: applied migrations
-- (0001-0003) are never rewritten. Safe on a fresh 0001->0004 database and safe
-- to re-run (every statement is guarded with IF [NOT] EXISTS or a catalog probe).
--
-- Resolves the B4 schema conflicts recorded in docs/adr/0002-gate-b4.md:
--   * D2 append-only history + explicit mutable current-head tables
--        (claim_evaluation_heads, verification_run_heads) — the is_current
--        partial-unique index conflicts with the append-only trigger.
--   * D3 allocation/closure/reversal are separate append-only facts
--        (receivable_closures, reconciliation_reversals) — never mutate the
--        immutable allocation row.
--   * stable runtime constraint names for reconciliation one-to-one uniqueness.
--   * D9 auditable dataset ledger (data_imports, demo_dataset_records).
--   * agent_result_claims.request_hash for body-conflict idempotency.
--   * a persisted worker heartbeat for /ready.

-- ============================================================================
-- 1. Stable runtime constraint names for reconciliation one-to-one uniqueness
--    (0001 created these inline/unnamed; runtime unique-violation recovery keys
--     off the stable names, mirroring the 0003 rename-by-column-signature).
-- ============================================================================
do $$
declare
  old_name text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'reconciliation_allocations'::regclass
      and conname = 'reconciliation_allocations_bank_line_uq'
  ) then
    select c.conname into old_name
    from pg_constraint c
    where c.conrelid = 'reconciliation_allocations'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['tenant_id', 'bank_line_evidence_id']::name[];
    if old_name is null then
      raise exception 'reconciliation bank-line unique constraint not found';
    end if;
    execute format(
      'alter table reconciliation_allocations rename constraint %I to reconciliation_allocations_bank_line_uq',
      old_name
    );
  end if;
end $$;

do $$
declare
  old_name text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'reconciliation_allocations'::regclass
      and conname = 'reconciliation_allocations_expectation_uq'
  ) then
    select c.conname into old_name
    from pg_constraint c
    where c.conrelid = 'reconciliation_allocations'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['tenant_id', 'expectation_id']::name[];
    if old_name is null then
      raise exception 'reconciliation expectation unique constraint not found';
    end if;
    execute format(
      'alter table reconciliation_allocations rename constraint %I to reconciliation_allocations_expectation_uq',
      old_name
    );
  end if;
end $$;

-- ============================================================================
-- 2. Composite (tenant_id, id) targets required by the new B4 composite FKs.
--    (0002 already added these for users/ingest_events/expectations/cases/
--     actions/agent_result_claims; the three below were not needed until B4.)
-- ============================================================================
alter table reconciliation_allocations
  add constraint reconciliation_allocations_tenant_id_id_uq unique (tenant_id, id);
alter table verification_runs
  add constraint verification_runs_tenant_id_id_uq unique (tenant_id, id);
alter table claim_evaluations
  add constraint claim_evaluations_tenant_id_id_uq unique (tenant_id, id);

-- ============================================================================
-- 3. D2 — mutable current-head tables; drop contradictory partial-current
--    indexes and deprecated is_current columns; make verification_runs history
--    append-only (claim_evaluations already is).
-- ============================================================================
create table verification_run_heads (
  tenant_id text not null references tenants (id),
  action_id text not null,
  current_run_id text not null,
  contract_key text not null,
  contract_version text not null,
  status text not null check (
    status in ('VERIFICATION_PENDING', 'EFFECT_VERIFIED', 'EFFECT_FAILED', 'TIMED_OUT', 'EFFECT_REVERSED')
  ),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, action_id),
  foreign key (tenant_id, current_run_id) references verification_runs (tenant_id, id),
  foreign key (tenant_id, action_id) references actions (tenant_id, id)
);

create table claim_evaluation_heads (
  tenant_id text not null references tenants (id),
  claim_id text not null,
  current_evaluation_id text not null,
  status text not null check (
    status in ('PENDING', 'VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'UNRESOLVED', 'REVERSED')
  ),
  evaluation_version integer not null default 0 check (evaluation_version >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, claim_id),
  foreign key (tenant_id, current_evaluation_id) references claim_evaluations (tenant_id, id),
  foreign key (tenant_id, claim_id) references agent_result_claims (tenant_id, id)
);

-- Backfill heads from the highest persisted version where any history exists
-- (a no-op on a fresh database; defensive for an upgrade path).
insert into verification_run_heads (tenant_id, action_id, current_run_id, contract_key, contract_version, status, version)
select r.tenant_id, r.action_id, r.id, r.contract_key, r.contract_version, r.status, r.version
from verification_runs r
join (
  select tenant_id, action_id, max(version) as v
  from verification_runs group by tenant_id, action_id
) m on m.tenant_id = r.tenant_id and m.action_id = r.action_id and m.v = r.version
on conflict do nothing;

insert into claim_evaluation_heads (tenant_id, claim_id, current_evaluation_id, status, evaluation_version)
select e.tenant_id, e.claim_id, e.id, e.status, e.evaluation_version
from claim_evaluations e
join (
  select tenant_id, claim_id, max(evaluation_version) as v
  from claim_evaluations group by tenant_id, claim_id
) m on m.tenant_id = e.tenant_id and m.claim_id = e.claim_id and m.v = e.evaluation_version
on conflict do nothing;

-- Remove the contradictory partial-current indexes and deprecated columns.
drop index if exists verification_runs_current_uq;
drop index if exists claim_evaluations_current_uq;
alter table verification_runs drop column if exists is_current;
alter table claim_evaluations drop column if exists is_current;

-- verification_runs history is now strictly append-only (claim_evaluations
-- already carries this trigger from 0001).
drop trigger if exists verification_runs_append_only on verification_runs;
create trigger verification_runs_append_only before update or delete on verification_runs
  for each row execute function forbid_update_delete();

-- Fast history lookup by (tenant, action).
create index if not exists verification_runs_action_idx on verification_runs (tenant_id, action_id);

-- ============================================================================
-- 4. D3 — append-only receivable_closures (one closure per allocation /
--    expectation / close action / closure evidence).
-- ============================================================================
create table receivable_closures (
  id text primary key,
  tenant_id text not null references tenants (id),
  allocation_id text not null,
  expectation_id text not null,
  case_id text not null,
  close_action_id text not null,
  closure_evidence_id text not null,
  closed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint receivable_closures_allocation_uq unique (tenant_id, allocation_id),
  constraint receivable_closures_expectation_uq unique (tenant_id, expectation_id),
  constraint receivable_closures_action_uq unique (tenant_id, close_action_id),
  constraint receivable_closures_evidence_uq unique (tenant_id, closure_evidence_id),
  foreign key (tenant_id, allocation_id) references reconciliation_allocations (tenant_id, id),
  foreign key (tenant_id, expectation_id) references expectations (tenant_id, id),
  foreign key (tenant_id, case_id) references cases (tenant_id, id),
  foreign key (tenant_id, close_action_id) references actions (tenant_id, id),
  foreign key (tenant_id, closure_evidence_id) references ingest_events (tenant_id, id)
);
create trigger receivable_closures_append_only before update or delete on receivable_closures
  for each row execute function forbid_update_delete();

-- ============================================================================
-- 5. D3 — append-only reconciliation_reversals (one reversal per allocation;
--    authoritative reversal evidence consumed once).
-- ============================================================================
create table reconciliation_reversals (
  id text primary key,
  tenant_id text not null references tenants (id),
  allocation_id text not null,
  expectation_id text not null,
  case_id text not null,
  reversal_evidence_id text not null,
  reversed_amount_minor bigint not null check (reversed_amount_minor > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  reversed_at timestamptz not null,
  new_case_epoch integer check (new_case_epoch is null or new_case_epoch >= 0),
  created_at timestamptz not null default now(),
  constraint reconciliation_reversals_allocation_uq unique (tenant_id, allocation_id),
  constraint reconciliation_reversals_evidence_uq unique (tenant_id, reversal_evidence_id),
  foreign key (tenant_id, allocation_id) references reconciliation_allocations (tenant_id, id),
  foreign key (tenant_id, expectation_id) references expectations (tenant_id, id),
  foreign key (tenant_id, case_id) references cases (tenant_id, id),
  foreign key (tenant_id, reversal_evidence_id) references ingest_events (tenant_id, id)
);
create trigger reconciliation_reversals_append_only before update or delete on reconciliation_reversals
  for each row execute function forbid_update_delete();

-- ============================================================================
-- 6. Agent-claim request hash for body-conflict idempotency (exact key + same
--    hash is idempotent; same key + different hash is a typed conflict). NOT
--    NULL because the claims feature has no B1-B3 rows yet on any real
--    database — every row the service ever inserts carries a computed hash.
-- ============================================================================
alter table agent_result_claims add column if not exists request_hash text;
alter table agent_result_claims alter column request_hash set not null;

-- ============================================================================
-- 7. D9 — auditable import ledger + 500-record dataset ledger (append-only).
--    data_imports gets a (tenant_id, id) unique target so demo_dataset_records
--    can reference it with a real composite tenant FK, not a bare id FK.
-- ============================================================================
create table data_imports (
  id text primary key,
  tenant_id text not null references tenants (id),
  source text not null,
  seed_id text,
  item_count integer not null check (item_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  manifest_hash text,
  status text not null check (status in ('accepted')),
  created_at timestamptz not null default now(),
  constraint data_imports_tenant_id_id_uq unique (tenant_id, id)
);
create trigger data_imports_append_only before update or delete on data_imports
  for each row execute function forbid_update_delete();

create table demo_dataset_records (
  id text primary key,
  tenant_id text not null references tenants (id),
  seed_id text not null,
  ordinal integer not null check (ordinal >= 1),
  import_id text not null,
  source_system text not null,
  source_event_id text not null,
  economic_subject_key text not null,
  ingest_event_id text not null,
  created_at timestamptz not null default now(),
  constraint demo_dataset_records_ordinal_uq unique (tenant_id, seed_id, ordinal),
  constraint demo_dataset_records_ingest_uq unique (tenant_id, ingest_event_id),
  foreign key (tenant_id, import_id) references data_imports (tenant_id, id),
  foreign key (tenant_id, ingest_event_id) references ingest_events (tenant_id, id)
);
create trigger demo_dataset_records_append_only before update or delete on demo_dataset_records
  for each row execute function forbid_update_delete();
create index if not exists demo_dataset_records_seed_idx on demo_dataset_records (tenant_id, seed_id);

-- ============================================================================
-- 8. Persisted worker heartbeat for /ready (mutable, global infra — no tenant
--    data, no connection string, no secret).
-- ============================================================================
create table worker_heartbeat (
  id text primary key,
  last_beat_at timestamptz not null default now(),
  status text not null default 'up' check (status in ('up', 'draining', 'down'))
);

-- ============================================================================
-- 9a. Extend the audit artifact_type check for the new B4 fact types
--     (ADR 0002); the original 0001 check listed only the B1-B3 types.
-- ============================================================================
do $$
declare
  ck_name text;
begin
  select conname into ck_name
  from pg_constraint
  where conrelid = 'audit_entries'::regclass and contype = 'c' and conname like '%artifact_type%';
  if ck_name is not null then
    execute format('alter table audit_entries drop constraint %I', ck_name);
  end if;
  alter table audit_entries add constraint audit_entries_artifact_type_ck check (
    artifact_type in (
      'EVIDENCE', 'INVESTIGATION', 'FINDING', 'POLICY_DECISION', 'APPROVAL', 'ACTION',
      'VERIFICATION', 'RECONCILIATION', 'CASE_TRANSITION', 'MANUAL_LINK', 'ADMIN_CHANGE',
      'AGENT_CLAIM', 'CLAIM_EVALUATION', 'RECEIVABLE_CLOSURE', 'RECONCILIATION_REVERSAL',
      'DATASET_IMPORT', 'DEMO_COMMAND'
    )
  );
end $$;

-- ============================================================================
-- 9. Optimistic / nonnegative guards on scenario state.
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'demo_scenario_state_step_ck') then
    alter table demo_scenario_state add constraint demo_scenario_state_step_ck check (current_step >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demo_scenario_state_version_ck') then
    alter table demo_scenario_state add constraint demo_scenario_state_version_ck check (version >= 0);
  end if;
end $$;
