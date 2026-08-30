-- B1/B2 integrity remediation.
-- This is deliberately forward-only: 0001 remains an immutable record of the
-- original scaffold and fresh databases exercise both migrations.

-- Exact evidence representation and source ordering data.
alter table ingest_events add column source_account_id text;
alter table ingest_events add column source_entity_version integer check (source_entity_version >= 0);
alter table ingest_events add column raw_bytes bytea;
alter table ingest_events add column raw_representation text;
update ingest_events
set raw_bytes = convert_to(raw_payload::text, 'UTF8'),
    raw_representation = 'canonical_row'
where raw_bytes is null;
alter table ingest_events alter column raw_bytes set not null;
alter table ingest_events alter column raw_representation set not null;
alter table ingest_events add constraint ingest_events_raw_representation_ck
  check (raw_representation in ('exact_bytes', 'canonical_row'));

alter table event_conflicts add column new_raw_bytes bytea;
alter table event_conflicts add column raw_representation text;
update event_conflicts
set new_raw_bytes = convert_to(new_raw_payload::text, 'UTF8'),
    raw_representation = 'canonical_row'
where new_raw_bytes is null;
alter table event_conflicts alter column new_raw_bytes set not null;
alter table event_conflicts alter column raw_representation set not null;
alter table event_conflicts add constraint event_conflicts_raw_representation_ck
  check (raw_representation in ('exact_bytes', 'canonical_row'));

-- Child records that were only implicitly tenant-scoped become explicit.
alter table expectation_inputs add column tenant_id text;
update expectation_inputs i
set tenant_id = e.tenant_id
from expectations e
where e.id = i.expectation_id;
alter table expectation_inputs alter column tenant_id set not null;

alter table evidence_set_items add column tenant_id text;
alter table evidence_set_items add column item_role text not null default 'supporting';
update evidence_set_items i
set tenant_id = s.tenant_id
from evidence_sets s
where s.id = i.evidence_set_id;
alter table evidence_set_items alter column tenant_id set not null;

alter table action_attempts add column tenant_id text;
update action_attempts a
set tenant_id = p.tenant_id
from actions p
where p.id = a.action_id;
alter table action_attempts alter column tenant_id set not null;

alter table outbox add column claim_attempts integer not null default 0 check (claim_attempts >= 0);
alter table outbox add column last_error_code text;
create index outbox_claim_lease_idx on outbox (status, claimed_at);

alter table entity_links add column observation text not null default 'observed'
  check (observation in ('expected', 'observed'));
alter table entity_links add column version integer not null default 0 check (version >= 0);
alter table entity_links drop constraint entity_links_review_status_check;
alter table entity_links add constraint entity_links_review_status_check
  check (review_status in ('unreviewed', 'not_required', 'confirmed', 'rejected'));

-- Composite FK targets. IDs remain globally unique for stable public handles,
-- while these keys make tenant equality a database-enforced invariant.
alter table users add constraint users_tenant_id_id_uq unique (tenant_id, id);
alter table ingest_events add constraint ingest_events_tenant_id_id_uq unique (tenant_id, id);
alter table entity_revisions add constraint entity_revisions_tenant_id_id_uq unique (tenant_id, id);
alter table economic_subjects add constraint economic_subjects_tenant_id_id_uq unique (tenant_id, id);
alter table expectations add constraint expectations_tenant_id_id_uq unique (tenant_id, id);
alter table financial_outcomes add constraint financial_outcomes_tenant_expectation_version_uq
  unique (tenant_id, expectation_id, version);
alter table cases add constraint cases_tenant_id_id_uq unique (tenant_id, id);
alter table evidence_sets add constraint evidence_sets_tenant_id_id_uq unique (tenant_id, id);
alter table entity_links add constraint entity_links_tenant_id_id_uq unique (tenant_id, id);
alter table plans add constraint plans_tenant_id_id_uq unique (tenant_id, id);
alter table approvals add constraint approvals_tenant_id_id_uq unique (tenant_id, id);
alter table actions add constraint actions_tenant_id_id_uq unique (tenant_id, id);
alter table agent_result_claims add constraint agent_result_claims_tenant_id_id_uq unique (tenant_id, id);

-- Tenant equality for every concrete relationship available at B1/B2. Global
-- policy_bundles and verification_contracts intentionally have no tenant.
alter table event_conflicts add constraint event_conflicts_existing_event_tenant_fk
  foreign key (tenant_id, existing_ingest_event_id) references ingest_events (tenant_id, id);
alter table ingest_events add constraint ingest_events_source_account_tenant_fk
  foreign key (tenant_id, source_system, source_account_id)
  references source_connections (tenant_id, source_system, external_account_id);
alter table projector_runs add constraint projector_runs_event_tenant_fk
  foreign key (tenant_id, ingest_event_id) references ingest_events (tenant_id, id);
alter table entity_revisions add constraint entity_revisions_event_tenant_fk
  foreign key (tenant_id, ingest_event_id) references ingest_events (tenant_id, id);
alter table entity_current add constraint entity_current_revision_tenant_fk
  foreign key (tenant_id, current_revision_id) references entity_revisions (tenant_id, id);
alter table expectations add constraint expectations_subject_tenant_fk
  foreign key (tenant_id, subject_id) references economic_subjects (tenant_id, id);
alter table expectation_inputs add constraint expectation_inputs_tenant_fk
  foreign key (tenant_id) references tenants (id);
alter table expectation_inputs add constraint expectation_inputs_expectation_tenant_fk
  foreign key (tenant_id, expectation_id) references expectations (tenant_id, id);
alter table expectation_inputs add constraint expectation_inputs_evidence_tenant_fk
  foreign key (tenant_id, evidence_id) references ingest_events (tenant_id, id);
alter table invariant_evaluations add constraint invariant_evaluations_subject_tenant_fk
  foreign key (tenant_id, subject_id) references economic_subjects (tenant_id, id);
alter table financial_outcomes add constraint financial_outcomes_expectation_tenant_fk
  foreign key (tenant_id, expectation_id) references expectations (tenant_id, id);
alter table cases add constraint cases_subject_tenant_fk
  foreign key (tenant_id, subject_id) references economic_subjects (tenant_id, id);
alter table cases add constraint cases_expectation_tenant_fk
  foreign key (tenant_id, expectation_id) references expectations (tenant_id, id);
alter table cases add constraint cases_owner_tenant_fk
  foreign key (tenant_id, owner_id) references users (tenant_id, id);
alter table case_transitions add constraint case_transitions_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table case_transitions add constraint case_transitions_actor_tenant_fk
  foreign key (tenant_id, actor_id) references users (tenant_id, id);
alter table case_notes add constraint case_notes_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table case_notes add constraint case_notes_author_tenant_fk
  foreign key (tenant_id, author_id) references users (tenant_id, id);
alter table entity_links add constraint entity_links_reviewer_tenant_fk
  foreign key (tenant_id, reviewer_id) references users (tenant_id, id);
alter table evidence_set_items add constraint evidence_set_items_tenant_fk
  foreign key (tenant_id) references tenants (id);
alter table evidence_set_items add constraint evidence_set_items_set_tenant_fk
  foreign key (tenant_id, evidence_set_id) references evidence_sets (tenant_id, id);
alter table evidence_set_items add constraint evidence_set_items_evidence_tenant_fk
  foreign key (tenant_id, evidence_id) references ingest_events (tenant_id, id);
alter table investigations add constraint investigations_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table plans add constraint plans_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table policy_decisions add constraint policy_decisions_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table policy_decisions add constraint policy_decisions_plan_tenant_fk
  foreign key (tenant_id, plan_id) references plans (tenant_id, id);
alter table policy_decisions add constraint policy_decisions_actor_tenant_fk
  foreign key (tenant_id, actor_id) references users (tenant_id, id);
alter table approvals add constraint approvals_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table approvals add constraint approvals_plan_tenant_fk
  foreign key (tenant_id, plan_id) references plans (tenant_id, id);
alter table approvals add constraint approvals_requester_tenant_fk
  foreign key (tenant_id, requester_id) references users (tenant_id, id);
alter table approvals add constraint approvals_approver_tenant_fk
  foreign key (tenant_id, approver_id) references users (tenant_id, id);
alter table actions add constraint actions_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table actions add constraint actions_plan_tenant_fk
  foreign key (tenant_id, plan_id) references plans (tenant_id, id);
alter table action_attempts add constraint action_attempts_tenant_fk
  foreign key (tenant_id) references tenants (id);
alter table action_attempts add constraint action_attempts_action_tenant_fk
  foreign key (tenant_id, action_id) references actions (tenant_id, id);
alter table verification_runs add constraint verification_runs_action_tenant_fk
  foreign key (tenant_id, action_id) references actions (tenant_id, id);
alter table reconciliation_allocations add constraint reconciliation_case_tenant_fk
  foreign key (tenant_id, case_id) references cases (tenant_id, id);
alter table reconciliation_allocations add constraint reconciliation_expectation_tenant_fk
  foreign key (tenant_id, expectation_id) references expectations (tenant_id, id);
alter table reconciliation_allocations add constraint reconciliation_evidence_tenant_fk
  foreign key (tenant_id, bank_line_evidence_id) references ingest_events (tenant_id, id);
alter table claim_evaluations add constraint claim_evaluations_claim_tenant_fk
  foreign key (tenant_id, claim_id) references agent_result_claims (tenant_id, id);
alter table audit_entries add constraint audit_entries_actor_tenant_fk
  foreign key (tenant_id, actor_id) references users (tenant_id, id);

-- Invariant evaluations are immutable versions. Identical input hashes are
-- reused by the service; changed evidence appends a new version.
alter table invariant_evaluations add column evaluation_version integer not null default 1
  check (evaluation_version > 0);
do $$
declare constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  where c.conrelid = 'invariant_evaluations'::regclass
    and c.contype = 'u'
  limit 1;
  if constraint_name is not null then
    execute format('alter table invariant_evaluations drop constraint %I', constraint_name);
  end if;
end $$;
alter table invariant_evaluations add constraint invariant_evaluations_version_uq
  unique (tenant_id, control_id, control_version, subject_id, evaluation_window, evaluation_version);
create index invariant_evaluations_latest_idx
  on invariant_evaluations (tenant_id, control_id, subject_id, evaluation_window, evaluation_version desc);
create trigger invariant_evaluations_append_only before update or delete on invariant_evaluations
  for each row execute function forbid_update_delete();

-- Stable per-tenant audit ordering uses a global sequence; gaps are permitted,
-- duplicates and reordering within a tenant are not.
create sequence if not exists moneytrace_audit_sequence;
alter table audit_entries alter column audit_sequence set default nextval('moneytrace_audit_sequence');
alter table audit_entries add column details jsonb not null default '{}'::jsonb;

-- Append-only case relationships retain merge/suppression/reopen history.
create table case_relationships (
  id text primary key,
  tenant_id text not null references tenants (id),
  source_case_id text not null,
  target_case_id text not null,
  relationship_type text not null check (relationship_type in ('duplicate_of', 'superseded_by', 'reopened_from')),
  reason text not null check (char_length(reason) between 1 and 2000),
  actor_id text,
  created_at timestamptz not null default now(),
  constraint case_relationships_source_tenant_fk foreign key (tenant_id, source_case_id)
    references cases (tenant_id, id),
  constraint case_relationships_target_tenant_fk foreign key (tenant_id, target_case_id)
    references cases (tenant_id, id),
  constraint case_relationships_actor_tenant_fk foreign key (tenant_id, actor_id)
    references users (tenant_id, id),
  unique (tenant_id, source_case_id, target_case_id, relationship_type),
  check (source_case_id <> target_case_id)
);
create index case_relationships_source_idx on case_relationships (tenant_id, source_case_id, created_at);
create trigger case_relationships_append_only before update or delete on case_relationships
  for each row execute function forbid_update_delete();

-- Candidate provenance is immutable. Human decisions are append-only review
-- versions so the original resolver output remains auditable forever.
create table entity_link_reviews (
  id text primary key,
  tenant_id text not null references tenants (id),
  link_id text not null,
  review_version integer not null check (review_version > 0),
  decision text not null check (decision in ('confirmed', 'rejected')),
  reviewer_id text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, link_id, review_version),
  foreign key (tenant_id, link_id) references entity_links (tenant_id, id),
  foreign key (tenant_id, reviewer_id) references users (tenant_id, id)
);
create index entity_link_reviews_latest_idx
  on entity_link_reviews (tenant_id, link_id, review_version desc);
create trigger entity_link_reviews_append_only before update or delete on entity_link_reviews
  for each row execute function forbid_update_delete();
create trigger entity_links_append_only before update or delete on entity_links
  for each row execute function forbid_update_delete();
