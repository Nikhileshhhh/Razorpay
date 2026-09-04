-- Gate B4 prototype remediation: durable, append-only evidence attribution
-- for untrusted agent claims. Forward-only; applied migrations are untouched.

create table agent_claim_evidence_bindings (
  id text primary key,
  tenant_id text not null,
  claim_id text not null,
  ingest_event_id text not null,
  evidence_type text not null check (evidence_type in (
    'captured_payment',
    'paid_order',
    'seller_allocation_rule',
    'transfer_search_result',
    'authoritative_transfer_record',
    'recipient_settlement',
    'bank_credit',
    'seller_receivable',
    'seller_receivable_closed',
    'refund',
    'dispute',
    'recovery_action'
  )),
  created_at timestamptz not null default now(),
  constraint agent_claim_evidence_bindings_claim_event_uq
    unique (tenant_id, claim_id, ingest_event_id),
  constraint agent_claim_evidence_bindings_claim_fk
    foreign key (tenant_id, claim_id)
    references agent_result_claims (tenant_id, id),
  constraint agent_claim_evidence_bindings_event_fk
    foreign key (tenant_id, ingest_event_id)
    references ingest_events (tenant_id, id)
);

create unique index agent_claim_capture_attribution_uq
  on agent_claim_evidence_bindings (tenant_id, ingest_event_id)
  where evidence_type = 'captured_payment';

create index agent_claim_evidence_bindings_claim_idx
  on agent_claim_evidence_bindings (tenant_id, claim_id);

create trigger agent_claim_evidence_bindings_append_only
  before update or delete on agent_claim_evidence_bindings
  for each row execute function forbid_update_delete();
