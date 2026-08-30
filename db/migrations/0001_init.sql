-- MoneyTrace backend schema (backend PRD §8).
--
-- Conventions:
--  * All monetary columns are BIGINT (minor units) paired with a currency
--    column CHECKed to 'INR' only (backend PRD §7.1: INR-only schema 1.0).
--  * All tenant-owned tables carry tenant_id and every unique/FK constraint
--    that matters for isolation includes it explicitly.
--  * "Append-only" tables get a hard trigger (forbid_update_delete) in
--    addition to the repository layer never exposing an update/delete path
--    (defense in depth; this is an application guarantee, not a claim of
--    cryptographic immutability — see docs/adr/0001-architecture.md).
--  * Timestamps are timestamptz (UTC); domain code emits/consumes RFC3339 UTC.

-- ============================================================================
-- Migration bookkeeping
-- ============================================================================
create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

-- ============================================================================
-- Shared append-only enforcement
-- ============================================================================
create or replace function forbid_update_delete() returns trigger as $$
begin
  raise exception 'table % is append-only: % is not permitted', tg_table_name, tg_op;
end;
$$ language plpgsql;

-- ============================================================================
-- Identity (backend PRD §6, §8 "Identity")
-- ============================================================================
create table tenants (
  id text primary key,
  display_name text not null,
  environment text not null check (environment in ('demo', 'buildathon', 'test', 'development', 'production')),
  currency_default text not null default 'INR' check (currency_default = 'INR'),
  data_retention_policy text not null default 'demo_synthetic_no_retention',
  created_at timestamptz not null default now()
);

create table users (
  id text primary key,
  tenant_id text not null references tenants (id),
  display_name text not null,
  created_at timestamptz not null default now()
);
create index users_tenant_idx on users (tenant_id);

create table memberships (
  id text primary key,
  tenant_id text not null references tenants (id),
  user_id text not null references users (id),
  role text not null check (
    role in (
      'viewer', 'investigator', 'case_manager', 'finance_approver',
      'policy_administrator', 'auditor', 'platform_operator', 'connector',
      'executor', 'worker', 'demo_operator'
    )
  ),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, role)
);
create index memberships_tenant_user_idx on memberships (tenant_id, user_id);
-- Membership FK-tenant-consistency: user_id must belong to the same tenant.
create or replace function membership_user_tenant_matches() returns trigger as $$
begin
  if not exists (select 1 from users u where u.id = new.user_id and u.tenant_id = new.tenant_id) then
    raise exception 'membership tenant_id (%) does not match user % tenant', new.tenant_id, new.user_id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger memberships_tenant_check before insert or update on memberships
  for each row execute function membership_user_tenant_matches();

-- ============================================================================
-- Sources / evidence (backend PRD §8 "Sources/evidence", §9)
-- ============================================================================
create table source_connections (
  id text primary key,
  tenant_id text not null references tenants (id),
  source_system text not null,
  external_account_id text,
  capability_status text not null default 'available' check (capability_status in ('available', 'unavailable')),
  created_at timestamptz not null default now(),
  unique (tenant_id, source_system, external_account_id)
);

create table ingest_events (
  id text primary key,
  tenant_id text not null references tenants (id),
  source_system text not null,
  source_event_id text,
  source_event_type text not null,
  event_type text,
  event_time timestamptz not null,
  ingested_at timestamptz not null default now(),
  payload_hash text not null,
  raw_payload jsonb not null,
  signature_status text not null check (signature_status in ('verified', 'unsigned', 'invalid', 'not_applicable')),
  dedupe_status text not null check (dedupe_status in ('unique', 'exact_duplicate', 'conflicting_duplicate')),
  quarantine_status text not null default 'none' check (quarantine_status in ('none', 'quarantined')),
  fallback_dedupe_key text not null,
  correlation_id text,
  amount_minor bigint,
  currency text check (currency = 'INR'),
  entity_references jsonb not null default '{}'::jsonb,
  economic_subject_hint text
);
-- Exact source-id uniqueness only when a source_event_id is present.
create unique index ingest_events_source_id_uq on ingest_events (tenant_id, source_system, source_event_id)
  where source_event_id is not null;
-- Fallback dedupe for sources with no event id: never merges distinct equal-value events
-- because it includes the raw payload hash.
create unique index ingest_events_fallback_uq on ingest_events (tenant_id, fallback_dedupe_key);
create index ingest_events_tenant_time_idx on ingest_events (tenant_id, event_time);
create index ingest_events_tenant_type_idx on ingest_events (tenant_id, event_type);
create trigger ingest_events_append_only before update or delete on ingest_events
  for each row execute function forbid_update_delete();

create table event_conflicts (
  id text primary key,
  tenant_id text not null references tenants (id),
  source_system text not null,
  source_event_id text not null,
  existing_ingest_event_id text not null references ingest_events (id),
  existing_hash text not null,
  new_hash text not null,
  new_raw_payload jsonb not null,
  quarantine_reason text not null,
  detected_at timestamptz not null default now()
);
create index event_conflicts_tenant_idx on event_conflicts (tenant_id, source_event_id);
create trigger event_conflicts_append_only before update or delete on event_conflicts
  for each row execute function forbid_update_delete();

-- ============================================================================
-- Projection (backend PRD §8 "Projection", §9.2)
-- ============================================================================
create table projector_runs (
  id text primary key,
  tenant_id text not null references tenants (id),
  projector_name text not null,
  projector_version text not null,
  ingest_event_id text not null references ingest_events (id),
  status text not null check (status in ('applied', 'skipped', 'quarantined')),
  applied_at timestamptz not null default now(),
  unique (tenant_id, projector_name, projector_version, ingest_event_id)
);

create table entity_revisions (
  id text primary key,
  tenant_id text not null references tenants (id),
  entity_type text not null,
  entity_key text not null,
  source_system text not null,
  source_entity_id text not null,
  revision_key text not null,
  source_entity_version integer,
  business_state text not null,
  amount_minor bigint,
  currency text check (currency = 'INR'),
  event_time timestamptz not null,
  ingest_event_id text not null references ingest_events (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, source_system, entity_type, source_entity_id, revision_key)
);
create index entity_revisions_entity_idx on entity_revisions (tenant_id, entity_key, event_time);
create trigger entity_revisions_append_only before update or delete on entity_revisions
  for each row execute function forbid_update_delete();

create table entity_current (
  tenant_id text not null references tenants (id),
  entity_key text not null,
  entity_type text not null,
  current_revision_id text not null references entity_revisions (id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, entity_key)
);

-- ============================================================================
-- Financial state (backend PRD §8 "Financial state", §7, §10.1)
-- ============================================================================
create table economic_subjects (
  id text primary key,
  tenant_id text not null references tenants (id),
  subject_type text not null,
  subject_key text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  opened_at timestamptz not null default now(),
  terminal_state text,
  unique (tenant_id, subject_type, subject_key)
);

create table expectations (
  id text primary key,
  tenant_id text not null references tenants (id),
  subject_id text not null references economic_subjects (id),
  version integer not null,
  rule_id text not null,
  rule_version text not null,
  expected_amount_minor bigint not null check (expected_amount_minor >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  expected_terminal_state text not null,
  expected_by timestamptz,
  materiality_class text not null default 'material',
  input_evidence_set_hash text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, subject_id, version)
);
-- Exactly one "current" expectation version per subject.
create unique index expectations_current_uq on expectations (tenant_id, subject_id) where is_current;

create table expectation_inputs (
  id text primary key,
  expectation_id text not null references expectations (id),
  evidence_id text not null,
  input_role text not null,
  unique (expectation_id, evidence_id, input_role)
);

create table invariant_evaluations (
  id text primary key,
  tenant_id text not null references tenants (id),
  control_id text not null,
  control_version text not null,
  subject_id text not null references economic_subjects (id),
  evaluation_window text not null,
  input_hash text not null,
  result text not null check (result in ('clean', 'violated')),
  amount_minor bigint,
  currency text check (currency = 'INR'),
  evidence_ids jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  unique (tenant_id, control_id, control_version, subject_id, evaluation_window)
);

create table financial_outcomes (
  id text primary key,
  tenant_id text not null references tenants (id),
  expectation_id text not null references expectations (id),
  status text not null check (
    status in ('EXPECTED', 'OBSERVED_UNVERIFIED', 'DIVERGED', 'ACTION_PENDING', 'VERIFIED', 'REVERSED', 'UNRESOLVED')
  ),
  version integer not null default 0,
  observed_amount_minor bigint,
  currency text check (currency = 'INR'),
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index financial_outcomes_current_uq on financial_outcomes (tenant_id, expectation_id) where is_current;

-- ============================================================================
-- Cases (backend PRD §8 "Cases", §10.2)
-- ============================================================================
create table cases (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_dedupe_key text not null,
  epoch integer not null default 0,
  subject_id text not null references economic_subjects (id),
  expectation_id text not null references expectations (id),
  control_id text not null,
  lifecycle_state text not null check (
    lifecycle_state in (
      'candidate', 'open', 'investigating', 'recommendation_ready', 'approval_required',
      'approved', 'executing', 'verification_pending', 'reconciled', 'abstained',
      'escalated', 'rejected', 'expired', 'cancelled', 'closed_no_action'
    )
  ),
  exposure_amount_minor bigint not null default 0 check (exposure_amount_minor >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  priority_score numeric not null default 0,
  evidence_coverage text not null default 'insufficient' check (evidence_coverage in ('insufficient', 'partial', 'complete')),
  contradiction_count integer not null default 0,
  owner_id text references users (id),
  version integer not null default 0,
  opened_at timestamptz not null default now(),
  due_at timestamptz,
  closed_at timestamptz,
  is_active_epoch boolean not null default true
);
create unique index cases_active_epoch_uq on cases (tenant_id, case_dedupe_key) where is_active_epoch;
create index cases_state_idx on cases (tenant_id, lifecycle_state);
create index cases_exposure_idx on cases (tenant_id, exposure_amount_minor desc);
create index cases_due_idx on cases (tenant_id, due_at);

create table case_transitions (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  from_state text,
  to_state text not null,
  reason text not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  actor_id text references users (id),
  expected_version integer not null,
  occurred_at timestamptz not null default now()
);
create index case_transitions_case_time_idx on case_transitions (case_id, occurred_at);
create trigger case_transitions_append_only before update or delete on case_transitions
  for each row execute function forbid_update_delete();

create table case_notes (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  author_id text not null references users (id),
  body text not null check (char_length(body) <= 4000),
  expected_case_version integer not null,
  created_at timestamptz not null default now()
);
create index case_notes_case_idx on case_notes (case_id, created_at);
create trigger case_notes_append_only before update or delete on case_notes
  for each row execute function forbid_update_delete();

-- ============================================================================
-- Provenance (backend PRD §8 "Provenance", §10.3)
-- ============================================================================
create table entity_links (
  id text primary key,
  tenant_id text not null references tenants (id),
  edge_type text not null,
  source_node_key text not null,
  target_node_key text not null,
  confidence_class text not null check (
    confidence_class in ('verified', 'asserted', 'derived', 'candidate', 'rejected', 'contradicted')
  ),
  score numeric,
  resolver_version text not null,
  evidence_set_hash text not null,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'confirmed', 'rejected')),
  reviewer_id text references users (id),
  review_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, resolver_version, source_node_key, target_node_key, edge_type)
);
create index entity_links_source_idx on entity_links (tenant_id, source_node_key, edge_type);
create index entity_links_target_idx on entity_links (tenant_id, target_node_key);

create table evidence_sets (
  id text primary key,
  tenant_id text not null references tenants (id),
  evidence_set_hash text not null,
  item_count integer not null default 0,
  sealed_at timestamptz not null default now(),
  unique (tenant_id, evidence_set_hash)
);
create trigger evidence_sets_append_only before update or delete on evidence_sets
  for each row execute function forbid_update_delete();

create table evidence_set_items (
  id text primary key,
  evidence_set_id text not null references evidence_sets (id),
  evidence_id text not null,
  ordinal integer not null,
  unique (evidence_set_id, evidence_id),
  unique (evidence_set_id, ordinal)
);
create trigger evidence_set_items_append_only before update or delete on evidence_set_items
  for each row execute function forbid_update_delete();

-- ============================================================================
-- Investigation (backend PRD §8 "Investigation", §11)
-- ============================================================================
create table investigations (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  evidence_set_hash text not null,
  prompt_version text not null,
  model_config_hash text not null,
  model_id text not null,
  gateway_mode text not null check (gateway_mode in ('offline_stub', 'external_provider')),
  output jsonb,
  failure_class text,
  created_at timestamptz not null default now(),
  unique (case_id, evidence_set_hash, prompt_version, model_config_hash)
);
create trigger investigations_append_only before update or delete on investigations
  for each row execute function forbid_update_delete();

-- ============================================================================
-- Control loop (backend PRD §8 "Control loop", §12)
-- ============================================================================
create table plans (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  template_id text not null,
  version integer not null default 1,
  parameters jsonb not null,
  plan_hash text not null,
  authority_level text not null check (authority_level in ('L0', 'L1', 'L2', 'L3', 'L4')),
  maximum_amount_impact_minor bigint not null,
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null check (status in ('DRAFT', 'PROPOSED', 'POLICY_DENIED', 'APPROVAL_REQUIRED', 'AUTHORIZED')),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, plan_hash)
);
create unique index plans_current_per_case_uq on plans (tenant_id, case_id) where is_current;

create table policy_bundles (
  id text primary key,
  version text not null unique,
  rules jsonb not null,
  created_at timestamptz not null default now()
);
create trigger policy_bundles_append_only before update or delete on policy_bundles
  for each row execute function forbid_update_delete();

create table policy_decisions (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  plan_id text not null references plans (id),
  policy_bundle_version text not null references policy_bundles (version),
  decision text not null check (decision in ('ALLOW_AUTOMATIC', 'REQUIRE_APPROVAL', 'ADVISE', 'DENY', 'REQUIRE_MORE_EVIDENCE')),
  matched_rules jsonb not null default '[]'::jsonb,
  required_role text,
  reason_codes jsonb not null default '[]'::jsonb,
  input_hash text not null,
  actor_id text references users (id),
  created_at timestamptz not null default now()
);
create index policy_decisions_case_idx on policy_decisions (case_id, created_at);
create trigger policy_decisions_append_only before update or delete on policy_decisions
  for each row execute function forbid_update_delete();

create table approvals (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  plan_id text not null references plans (id),
  decision_basis_hash text not null,
  decision_basis jsonb not null,
  required_role text not null,
  requester_id text not null references users (id),
  approver_id text references users (id),
  decision text check (decision in ('approve', 'reject', 'request_more_evidence')),
  reason text,
  state text not null check (state in ('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null
);
-- At most one EFFECTIVE (REQUESTED) approval per decision basis.
create unique index approvals_effective_basis_uq on approvals (tenant_id, decision_basis_hash) where state = 'REQUESTED';
create index approvals_case_idx on approvals (case_id, requested_at);

create table actions (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  plan_id text not null references plans (id),
  tool_id text not null check (
    tool_id in (
      'SUPPRESS_SIMULATED_RECOVERY', 'SIMULATE_TRANSFER_REMEDIATION',
      'REQUEST_MORE_EVIDENCE', 'CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION'
    )
  ),
  tool_version text not null default 'v1',
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (
    status in ('AUTHORIZED', 'RESERVED', 'DISPATCHING', 'ACKNOWLEDGED', 'OUTCOME_UNKNOWN', 'FAILED', 'VERIFICATION_PENDING')
  ),
  attempt_count integer not null default 0,
  external_reference text,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  outcome_status text check (outcome_status in ('ACKNOWLEDGED', 'FAILED', 'OUTCOME_UNKNOWN')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create table action_attempts (
  id text primary key,
  action_id text not null references actions (id),
  attempt_number integer not null,
  request_payload jsonb not null,
  response_payload jsonb,
  error_class text,
  attempted_at timestamptz not null default now(),
  unique (action_id, attempt_number)
);
create trigger action_attempts_append_only before update or delete on action_attempts
  for each row execute function forbid_update_delete();

create table outbox (
  id text primary key,
  tenant_id text not null references tenants (id),
  topic text not null,
  domain_event_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'dispatched', 'failed')),
  claimed_at timestamptz,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (topic, domain_event_id)
);
create index outbox_status_idx on outbox (status, created_at);

-- ============================================================================
-- Verification (backend PRD §8 "Verification", §13)
-- ============================================================================
create table verification_contracts (
  id text primary key,
  contract_key text not null,
  version text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique (contract_key, version)
);
create trigger verification_contracts_append_only before update or delete on verification_contracts
  for each row execute function forbid_update_delete();

create table verification_runs (
  id text primary key,
  tenant_id text not null references tenants (id),
  action_id text not null references actions (id),
  contract_key text not null,
  contract_version text not null,
  status text not null check (
    status in ('VERIFICATION_PENDING', 'EFFECT_VERIFIED', 'EFFECT_FAILED', 'TIMED_OUT', 'EFFECT_REVERSED')
  ),
  evidence_ids jsonb not null default '[]'::jsonb,
  verified_amount_minor bigint,
  currency text check (currency = 'INR'),
  verified_at timestamptz,
  failure_reason text,
  version integer not null default 0,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, action_id, version)
);
create unique index verification_runs_current_uq on verification_runs (tenant_id, action_id) where is_current;

create table reconciliation_allocations (
  id text primary key,
  tenant_id text not null references tenants (id),
  case_id text not null references cases (id),
  expectation_id text not null references expectations (id),
  bank_line_evidence_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'ALLOCATED' check (status in ('ALLOCATED', 'REVERSED')),
  closed_receivable_id text,
  created_at timestamptz not null default now(),
  -- Buildathon strict one-to-one: one bank line closes exactly one expectation.
  unique (tenant_id, bank_line_evidence_id),
  unique (tenant_id, expectation_id)
);
create trigger reconciliation_allocations_append_only before update or delete on reconciliation_allocations
  for each row execute function forbid_update_delete();

-- ============================================================================
-- Claims (backend PRD §8 "Claims", §13.3)
-- ============================================================================
create table agent_result_claims (
  id text primary key,
  tenant_id text not null references tenants (id),
  external_agent_id text not null,
  external_claim_id text not null,
  economic_subject_key text not null,
  claimed_amount_minor bigint not null,
  currency text not null default 'INR' check (currency = 'INR'),
  result_type text not null,
  attribution_method text not null check (
    attribution_method in ('CORRELATED', 'ATTRIBUTED_UNDER_RULE', 'EXPERIMENTALLY_INCREMENTAL', 'CAUSALLY_ESTABLISHED')
  ),
  correlation_id text,
  claim_time timestamptz not null,
  evidence_time timestamptz,
  evidence_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_agent_id, external_claim_id)
);
create trigger agent_result_claims_append_only before update or delete on agent_result_claims
  for each row execute function forbid_update_delete();

create table claim_evaluations (
  id text primary key,
  tenant_id text not null references tenants (id),
  claim_id text not null references agent_result_claims (id),
  evaluation_version integer not null,
  status text not null check (status in ('PENDING', 'VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'UNRESOLVED', 'REVERSED')),
  verified_amount_minor bigint,
  currency text check (currency = 'INR'),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (claim_id, evaluation_version)
);
create unique index claim_evaluations_current_uq on claim_evaluations (tenant_id, claim_id) where is_current;
create trigger claim_evaluations_append_only before update or delete on claim_evaluations
  for each row execute function forbid_update_delete();

-- ============================================================================
-- Audit / demo (backend PRD §8 "Audit/demo", §16, §18)
-- ============================================================================
create table audit_entries (
  id text primary key,
  tenant_id text not null references tenants (id),
  audit_sequence bigint not null,
  artifact_type text not null check (
    artifact_type in (
      'EVIDENCE', 'INVESTIGATION', 'FINDING', 'POLICY_DECISION', 'APPROVAL', 'ACTION',
      'VERIFICATION', 'RECONCILIATION', 'CASE_TRANSITION', 'MANUAL_LINK', 'ADMIN_CHANGE'
    )
  ),
  artifact_id text not null,
  artifact_hash text,
  actor_id text references users (id),
  actor_role text,
  model_id text,
  prompt_version text,
  evidence_set_hash text,
  policy_bundle_version text,
  created_at timestamptz not null default now(),
  unique (tenant_id, audit_sequence)
);
create index audit_entries_tenant_time_idx on audit_entries (tenant_id, created_at);
create trigger audit_entries_append_only before update or delete on audit_entries
  for each row execute function forbid_update_delete();

create table demo_scenario_state (
  id text primary key,
  tenant_id text not null references tenants (id),
  scenario_id text not null,
  current_step integer not null default 0,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, scenario_id)
);

create table demo_seed_manifest (
  id text primary key,
  tenant_id text not null references tenants (id),
  seed_id text not null,
  manifest_hash text not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);
