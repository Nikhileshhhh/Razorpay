import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';

/**
 * Unique/FK/check/append-only enforcement and `BIGINT` round-trip (backend PRD
 * §19.2). ONE ephemeral database is shared across this file's tests (created
 * in `beforeAll`); each test uses its own row-id prefix so tests remain
 * independent without paying for a fresh CREATE DATABASE each time.
 */
describe('tenant/FK/unique/check constraints', () => {
  let testDb: TestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    client = new pg.Client({ connectionString: testDb.databaseUrl });
    await client.connect();
    await client.query(
      `insert into tenants (id, display_name, environment) values ('ten_demo','Demo','demo')`,
    );
  });

  afterAll(async () => {
    await client?.end();
    await testDb?.teardown();
  });

  it('rejects a currency other than INR via CHECK constraint', async () => {
    await expect(
      client.query(
        `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
         values ('sub_ccy','ten_demo','seller_allocation','order:ccy:seller-1', 100, 'USD')`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejects a negative economic_subjects amount via CHECK constraint', async () => {
    await expect(
      client.query(
        `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
         values ('sub_neg','ten_demo','seller_allocation','order:neg:seller-1', -1, 'INR')`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejects an unknown case lifecycle_state via CHECK constraint', async () => {
    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_state','ten_demo','seller_allocation','order:state:seller-1', 100, 'INR')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
       values ('exp_state','ten_demo','sub_state',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
    );
    await expect(
      client.query(
        `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
         values ('case_state','ten_demo','dedupe_state','sub_state','exp_state','CTRL-01','not_a_real_state')`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejects a foreign-key violation (case referencing a non-existent subject)', async () => {
    await expect(
      client.query(
        `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
         values ('case_fk','ten_demo','dedupe_fk','sub_missing','exp_missing','CTRL-01','open')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate unique (tenant, source_event_id) ingest event and never overwrites', async () => {
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_id, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_dup_1','ten_demo','RAZORPAY_TEST','razorpay_evt_dup','payment.captured', now(), 'sha256:a', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_dup_1')`,
    );
    await expect(
      client.query(
        `insert into ingest_events (id, tenant_id, source_system, source_event_id, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
         values ('evt_dup_2','ten_demo','RAZORPAY_TEST','razorpay_evt_dup','payment.captured', now(), 'sha256:b', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','conflicting_duplicate','fb_dup_2')`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('append-only: an ingest_event cannot be UPDATEd or DELETEd', async () => {
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_ao','ten_demo','RAZORPAY_TEST','payment.captured', now(), 'sha256:a', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_ao')`,
    );
    await expect(
      client.query(`update ingest_events set payload_hash = 'sha256:changed' where id = 'evt_ao'`),
    ).rejects.toThrow(/append-only/i);
    await expect(client.query(`delete from ingest_events where id = 'evt_ao'`)).rejects.toThrow(
      /append-only/i,
    );
  });

  it('append-only: an audit_entries row cannot be UPDATEd or DELETEd', async () => {
    await client.query(
      `insert into audit_entries (id, tenant_id, audit_sequence, artifact_type, artifact_id)
       values ('audit_ao','ten_demo', 1, 'EVIDENCE', 'evt_ao')`,
    );
    await expect(
      client.query(`update audit_entries set artifact_id = 'evt_2' where id = 'audit_ao'`),
    ).rejects.toThrow(/append-only/i);
    await expect(client.query(`delete from audit_entries where id = 'audit_ao'`)).rejects.toThrow(
      /append-only/i,
    );
  });

  it('a membership tenant_id must match its user’s tenant', async () => {
    await client.query(
      `insert into tenants (id, display_name, environment) values ('ten_other_c','Other','demo')`,
    );
    await client.query(
      `insert into users (id, tenant_id, display_name) values ('user_x_c','ten_demo','X')`,
    );
    await expect(
      client.query(
        `insert into memberships (id, tenant_id, user_id, role) values ('mem_x_c','ten_other_c','user_x_c','viewer')`,
      ),
    ).rejects.toThrow(/tenant/i);
  });

  it('BIGINT round-trips exactly for a large minor-unit amount', async () => {
    const large = '9007199254740993'; // > Number.MAX_SAFE_INTEGER, must not lose precision
    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_big','ten_demo','seller_allocation','order:big:seller-1', $1, 'INR')`,
      [large],
    );
    const result = await client.query<{ amount_minor: string }>(
      `select amount_minor from economic_subjects where id = 'sub_big'`,
    );
    expect(result.rows[0]?.amount_minor).toBe(large);
  });

  it('round-trips exact BYTEA evidence without canonicalization', async () => {
    const exact = Buffer.from('{ "spacing" : "is significant" }\r\n', 'utf8');
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_bytes','ten_demo','RAZORPAY_TEST','payment.captured', now(), 'sha256:bytes', '{"spacing":"is significant"}'::jsonb, $1, 'exact_bytes', 'verified','unique','fb_bytes')`,
      [exact],
    );
    const result = await client.query<{ raw_bytes: Buffer }>(
      `select raw_bytes from ingest_events where id = 'evt_bytes'`,
    );
    expect(Buffer.compare(result.rows[0]!.raw_bytes, exact)).toBe(0);
  });

  it('installs every B1/B2 composite-tenant foreign key', async () => {
    const expected = [
      'event_conflicts_existing_event_tenant_fk',
      'ingest_events_source_account_tenant_fk',
      'projector_runs_event_tenant_fk',
      'entity_revisions_event_tenant_fk',
      'entity_current_revision_tenant_fk',
      'expectations_subject_tenant_fk',
      'expectation_inputs_expectation_tenant_fk',
      'expectation_inputs_evidence_tenant_fk',
      'invariant_evaluations_subject_tenant_fk',
      'financial_outcomes_expectation_tenant_fk',
      'cases_subject_tenant_fk',
      'cases_expectation_tenant_fk',
      'cases_owner_tenant_fk',
      'case_transitions_case_tenant_fk',
      'case_transitions_actor_tenant_fk',
      'case_notes_case_tenant_fk',
      'case_notes_author_tenant_fk',
      'case_relationships_source_tenant_fk',
      'case_relationships_target_tenant_fk',
      'case_relationships_actor_tenant_fk',
      'entity_links_reviewer_tenant_fk',
      'evidence_set_items_set_tenant_fk',
      'evidence_set_items_evidence_tenant_fk',
      'investigations_case_tenant_fk',
      'plans_case_tenant_fk',
      'policy_decisions_case_tenant_fk',
      'policy_decisions_plan_tenant_fk',
      'policy_decisions_actor_tenant_fk',
      'approvals_case_tenant_fk',
      'approvals_plan_tenant_fk',
      'approvals_requester_tenant_fk',
      'approvals_approver_tenant_fk',
      'actions_case_tenant_fk',
      'actions_plan_tenant_fk',
      'action_attempts_action_tenant_fk',
      'verification_runs_action_tenant_fk',
      'reconciliation_case_tenant_fk',
      'reconciliation_expectation_tenant_fk',
      'reconciliation_evidence_tenant_fk',
      'claim_evaluations_claim_tenant_fk',
      'audit_entries_actor_tenant_fk',
    ].sort();
    const result = await client.query<{ conname: string }>(
      `select conname from pg_constraint where conname = any($1::text[]) order by conname`,
      [expected],
    );
    expect(result.rows.map((row) => row.conname)).toEqual(expected);
  });

  it('rejects cross-tenant references for composite tenant FKs (real INSERTs, not just introspection)', async () => {
    await client.query(
      `insert into tenants (id, display_name, environment) values ('ten_xfk','Cross-Tenant FK Fixture','demo')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into users (id, tenant_id, display_name) values ('user_xfk','ten_xfk','XFK')
       on conflict (id) do nothing`,
    );

    // cases_subject_tenant_fk: a case's (tenant_id, subject_id) must resolve
    // to a subject actually owned by that tenant, not merely any subject_id
    // that happens to exist for a DIFFERENT tenant.
    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_xfk','ten_demo','seller_allocation','order:xfk:seller-1', 100, 'INR')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
       values ('exp_xfk','ten_demo','sub_xfk',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
    );
    await expect(
      client.query(
        `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
         values ('case_xfk','ten_xfk','dedupe_xfk','sub_xfk','exp_xfk','CTRL-01','open')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // case_relationships_target_tenant_fk: cannot link to a target case
    // belonging to a different tenant even when the source case is valid.
    await client.query(
      `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
       values ('case_xfk_src','ten_demo','dedupe_xfk_src','sub_xfk','exp_xfk','CTRL-01','open')`,
    );
    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_xfk_other','ten_xfk','seller_allocation','order:xfk-other:seller-1', 100, 'INR')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
       values ('exp_xfk_other','ten_xfk','sub_xfk_other',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
    );
    await client.query(
      `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
       values ('case_xfk_target','ten_xfk','dedupe_xfk_target','sub_xfk_other','exp_xfk_other','CTRL-01','open')`,
    );
    await expect(
      client.query(
        `insert into case_relationships (id, tenant_id, source_case_id, target_case_id, relationship_type, reason)
         values ('case_rel_xfk','ten_demo','case_xfk_src','case_xfk_target','reopened_from','cross-tenant probe')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // expectation_inputs_evidence_tenant_fk: the input evidence row must
    // belong to the SAME tenant as the expectation citing it.
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_xfk_other','ten_xfk','RAZORPAY_TEST','payment.captured', now(), 'sha256:xfk', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_xfk_other')`,
    );
    await expect(
      client.query(
        `insert into expectation_inputs (id, tenant_id, expectation_id, evidence_id, input_role)
         values ('exp_input_xfk','ten_demo','exp_xfk','evt_xfk_other','primary')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // entity_links_reviewer_tenant_fk: a reviewer_id must belong to the
    // SAME tenant as the link they are attributed to reviewing.
    await expect(
      client.query(
        `insert into entity_links (id, tenant_id, edge_type, source_node_key, target_node_key, confidence_class, resolver_version, evidence_set_hash, reviewer_id)
         values ('link_xfk','ten_demo','CANDIDATE_MATCH','order:xfk:a','payment:xfk:b','candidate','resolver-v1','sha256:xfk-set','user_xfk')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // audit_entries_actor_tenant_fk: an actor_id must belong to the SAME
    // tenant as the audit entry it is attributed to.
    await expect(
      client.query(
        `insert into audit_entries (id, tenant_id, artifact_type, artifact_id, actor_id)
         values ('audit_xfk','ten_demo','EVIDENCE','evt_xfk_other','user_xfk')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // evidence_set_items_evidence_tenant_fk: a sealed evidence set's items
    // must reference evidence owned by the SAME tenant as the set.
    await client.query(
      `insert into evidence_sets (id, tenant_id, evidence_set_hash, item_count)
       values ('evset_xfk','ten_demo','sha256:evset-xfk', 1)`,
    );
    await expect(
      client.query(
        `insert into evidence_set_items (id, tenant_id, evidence_set_id, evidence_id, item_role, ordinal)
         values ('evset_item_xfk','ten_demo','evset_xfk','evt_xfk_other','primary', 0)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('rejects cross-tenant references for the remaining B1/B2-active composite tenant FKs', async () => {
    await client.query(
      `insert into tenants (id, display_name, environment) values ('ten_xfk2','Cross-Tenant FK Fixture 2','demo')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into users (id, tenant_id, display_name) values ('user_xfk2','ten_xfk2','XFK2')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into source_connections (id, tenant_id, source_system, external_account_id)
       values ('conn_xfk2','ten_xfk2','RAZORPAY_TEST','acct_xfk2')`,
    );

    // ingest_events_source_account_tenant_fk: the (source_system,
    // source_account_id) pair must be a connection owned by the SAME tenant.
    await expect(
      client.query(
        `insert into ingest_events (id, tenant_id, source_system, source_account_id, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
         values ('evt_xfk2_acct','ten_demo','RAZORPAY_TEST','acct_xfk2','payment.captured', now(), 'sha256:xfk2a', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_xfk2_acct')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_xfk2_other','ten_xfk2','RAZORPAY_TEST','payment.captured', now(), 'sha256:xfk2b', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_xfk2_other')`,
    );

    // event_conflicts_existing_event_tenant_fk
    await expect(
      client.query(
        `insert into event_conflicts (id, tenant_id, source_system, source_event_id, existing_ingest_event_id, existing_hash, new_hash, new_raw_payload, new_raw_bytes, raw_representation, quarantine_reason)
         values ('conflict_xfk2','ten_demo','RAZORPAY_TEST','src_xfk2','evt_xfk2_other','sha256:a','sha256:b','{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'byte_conflict')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // projector_runs_event_tenant_fk
    await expect(
      client.query(
        `insert into projector_runs (id, tenant_id, projector_name, projector_version, ingest_event_id, status)
         values ('run_xfk2','ten_demo','canonical-entity-projector','v1','evt_xfk2_other','applied')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // entity_revisions_event_tenant_fk
    await expect(
      client.query(
        `insert into entity_revisions (id, tenant_id, entity_type, entity_key, source_system, source_entity_id, revision_key, business_state, event_time, ingest_event_id)
         values ('rev_xfk2','ten_demo','payment','payment:xfk2','RAZORPAY_TEST','payment_xfk2','evt_xfk2_other','captured', now(), 'evt_xfk2_other')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // entity_current_revision_tenant_fk
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_xfk2_demo','ten_demo','RAZORPAY_TEST','payment.captured', now(), 'sha256:xfk2c', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_xfk2_demo')`,
    );
    await client.query(
      `insert into entity_revisions (id, tenant_id, entity_type, entity_key, source_system, source_entity_id, revision_key, business_state, event_time, ingest_event_id)
       values ('rev_xfk2_other','ten_xfk2','payment','payment:xfk2-other','RAZORPAY_TEST','payment_xfk2_other','evt_xfk2_other','captured', now(), 'evt_xfk2_other')`,
    );
    await expect(
      client.query(
        `insert into entity_current (tenant_id, entity_key, entity_type, current_revision_id)
         values ('ten_demo','payment:xfk2','payment','rev_xfk2_other')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // invariant_evaluations_subject_tenant_fk
    await expect(
      client.query(
        `insert into invariant_evaluations (id, tenant_id, control_id, control_version, subject_id, evaluation_window, input_hash, result)
         values ('inv_xfk2','ten_demo','CTRL-01','v1','sub_xfk_other','2026-08-25','sha256:xfk2-inv','clean')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // financial_outcomes_expectation_tenant_fk
    await expect(
      client.query(
        `insert into financial_outcomes (id, tenant_id, expectation_id, status)
         values ('outcome_xfk2','ten_demo','exp_xfk_other','ON_TRACK')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // cases_expectation_tenant_fk
    await expect(
      client.query(
        `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
         values ('case_xfk2_exp','ten_demo','dedupe_xfk2_exp','sub_xfk','exp_xfk_other','CTRL-01','open')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // cases_owner_tenant_fk
    await expect(
      client.query(
        `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state, owner_id)
         values ('case_xfk2_owner','ten_demo','dedupe_xfk2_owner','sub_xfk','exp_xfk','CTRL-01','open','user_xfk2')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // case_transitions_case_tenant_fk / case_transitions_actor_tenant_fk
    await expect(
      client.query(
        `insert into case_transitions (id, tenant_id, case_id, to_state, reason, expected_version)
         values ('trans_xfk2_case','ten_demo','case_xfk_target','open','cross-tenant probe', 0)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into case_transitions (id, tenant_id, case_id, to_state, reason, expected_version, actor_id)
         values ('trans_xfk2_actor','ten_demo','case_xfk_src','open','cross-tenant probe', 0,'user_xfk2')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // case_notes_case_tenant_fk / case_notes_author_tenant_fk
    await expect(
      client.query(
        `insert into case_notes (id, tenant_id, case_id, author_id, body, expected_case_version)
         values ('note_xfk2_case','ten_demo','case_xfk_target','user_xfk','note', 0)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into case_notes (id, tenant_id, case_id, author_id, body, expected_case_version)
         values ('note_xfk2_author','ten_demo','case_xfk_src','user_xfk2','note', 0)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // case_relationships_source_tenant_fk / case_relationships_actor_tenant_fk
    await expect(
      client.query(
        `insert into case_relationships (id, tenant_id, source_case_id, target_case_id, relationship_type, reason)
         values ('rel_xfk2_source','ten_xfk','case_xfk_src','case_xfk_target','reopened_from','cross-tenant probe')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await client.query(
      `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
       values ('case_xfk2_valid','ten_demo','dedupe_xfk2_valid','sub_xfk','exp_xfk','CTRL-01','open')`,
    );
    await expect(
      client.query(
        `insert into case_relationships (id, tenant_id, source_case_id, target_case_id, relationship_type, reason, actor_id)
         values ('rel_xfk2_actor','ten_demo','case_xfk_src','case_xfk2_valid','reopened_from','cross-tenant probe','user_xfk2')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('rejects cross-tenant references for expectations/evidence-set-item composite tenant FKs', async () => {
    await client.query(
      `insert into tenants (id, display_name, environment) values ('ten_xfk3','Cross-Tenant FK Fixture 3','demo')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_xfk3_other','ten_xfk3','seller_allocation','order:xfk3-other:seller-1', 100, 'INR')`,
    );

    // expectations_subject_tenant_fk
    await expect(
      client.query(
        `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
         values ('exp_xfk3_bad','ten_demo','sub_xfk3_other',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_xfk3','ten_demo','seller_allocation','order:xfk3:seller-1', 100, 'INR')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
       values ('exp_xfk3','ten_demo','sub_xfk3',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
       values ('exp_xfk3_other','ten_xfk3','sub_xfk3_other',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
    );

    // expectation_inputs_expectation_tenant_fk
    await expect(
      client.query(
        `insert into expectation_inputs (id, tenant_id, expectation_id, evidence_id, input_role)
         values ('exp_input_xfk3','ten_demo','exp_xfk3_other','evt_xfk3_seed','primary')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // evidence_set_items_set_tenant_fk
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_xfk3_demo','ten_demo','RAZORPAY_TEST','payment.captured', now(), 'sha256:xfk3demo', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_xfk3_demo')`,
    );
    await client.query(
      `insert into evidence_sets (id, tenant_id, evidence_set_hash, item_count)
       values ('evset_xfk3_other','ten_xfk3','sha256:evset-xfk3-other', 1)`,
    );
    await expect(
      client.query(
        `insert into evidence_set_items (id, tenant_id, evidence_set_id, evidence_id, item_role, ordinal)
         values ('evset_item_xfk3','ten_demo','evset_xfk3_other','evt_xfk3_demo','primary', 0)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('rejects cross-tenant references for every B3 control-loop composite tenant FK', async () => {
    // ten_demo fixtures: a full valid case -> plan -> action chain.
    await client.query(
      `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
       values ('case_xfk4','ten_demo','dedupe_xfk4','sub_xfk3','exp_xfk3','CTRL-01','open')`,
    );
    await client.query(
      `insert into plans (id, tenant_id, case_id, template_id, parameters, plan_hash, authority_level, maximum_amount_impact_minor, status)
       values ('plan_xfk4','ten_demo','case_xfk4','OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL','{}'::jsonb,'sha256:plan-xfk4','L1', 91, 'PROPOSED')`,
    );
    await client.query(
      `insert into actions (id, tenant_id, case_id, plan_id, tool_id, idempotency_key, request_hash, status)
       values ('action_xfk4','ten_demo','case_xfk4','plan_xfk4','SUPPRESS_SIMULATED_RECOVERY','idem_xfk4','sha256:req-xfk4','AUTHORIZED')`,
    );
    await client.query(
      `insert into agent_result_claims (id, tenant_id, external_agent_id, external_claim_id, economic_subject_key, claimed_amount_minor, result_type, attribution_method, claim_time)
       values ('claim_xfk4','ten_demo','agent_xfk4','ext_claim_xfk4','order:xfk4:seller-1', 91, 'RECOVERY_PREVENTED', 'CORRELATED', now())`,
    );

    // ten_xfk3 fixtures: an independent, equally-valid case -> plan -> action
    // chain plus a claim/evidence row, used ONLY as the cross-tenant target.
    await client.query(
      `insert into users (id, tenant_id, display_name) values ('user_xfk3','ten_xfk3','XFK3')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
       values ('case_xfk4_other','ten_xfk3','dedupe_xfk4_other','sub_xfk3_other','exp_xfk3_other','CTRL-01','open')`,
    );
    await client.query(
      `insert into plans (id, tenant_id, case_id, template_id, parameters, plan_hash, authority_level, maximum_amount_impact_minor, status)
       values ('plan_xfk4_other','ten_xfk3','case_xfk4_other','OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL','{}'::jsonb,'sha256:plan-xfk4-other','L1', 91, 'PROPOSED')`,
    );
    await client.query(
      `insert into actions (id, tenant_id, case_id, plan_id, tool_id, idempotency_key, request_hash, status)
       values ('action_xfk4_other','ten_xfk3','case_xfk4_other','plan_xfk4_other','SUPPRESS_SIMULATED_RECOVERY','idem_xfk4_other','sha256:req-xfk4-other','AUTHORIZED')`,
    );
    await client.query(
      `insert into agent_result_claims (id, tenant_id, external_agent_id, external_claim_id, economic_subject_key, claimed_amount_minor, result_type, attribution_method, claim_time)
       values ('claim_xfk4_other','ten_xfk3','agent_xfk4_other','ext_claim_xfk4_other','order:xfk4-other:seller-1', 91, 'RECOVERY_PREVENTED', 'CORRELATED', now())`,
    );
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('evt_xfk4_other','ten_xfk3','SYNTHETIC_BANK','bank.credit', now(), 'sha256:xfk4other', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_xfk4_other')`,
    );

    // investigations_case_tenant_fk
    await expect(
      client.query(
        `insert into investigations (id, tenant_id, case_id, evidence_set_hash, prompt_version, model_config_hash, model_id, gateway_mode)
         values ('inv_xfk4','ten_demo','case_xfk4_other','sha256:ev','pv1','mc1','model1','strict')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // plans_case_tenant_fk
    await expect(
      client.query(
        `insert into plans (id, tenant_id, case_id, template_id, parameters, plan_hash, authority_level, maximum_amount_impact_minor, status)
         values ('plan_xfk4_bad','ten_demo','case_xfk4_other','OPEN_TRANSFER_REMEDIATION_WITH_APPROVAL','{}'::jsonb,'sha256:plan-xfk4-bad','L1', 91, 'PROPOSED')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // policy_decisions_case_tenant_fk / _plan_tenant_fk / _actor_tenant_fk
    await expect(
      client.query(
        `insert into policy_decisions (id, tenant_id, case_id, plan_id, policy_bundle_version, decision, input_hash)
         values ('pd_xfk4_case','ten_demo','case_xfk4_other','plan_xfk4','bundle_v1','ALLOW_AUTOMATIC','sha256:pd')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into policy_decisions (id, tenant_id, case_id, plan_id, policy_bundle_version, decision, input_hash)
         values ('pd_xfk4_plan','ten_demo','case_xfk4','plan_xfk4_other','bundle_v1','ALLOW_AUTOMATIC','sha256:pd')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into policy_decisions (id, tenant_id, case_id, plan_id, policy_bundle_version, decision, input_hash, actor_id)
         values ('pd_xfk4_actor','ten_demo','case_xfk4','plan_xfk4','bundle_v1','ALLOW_AUTOMATIC','sha256:pd','user_xfk3')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // approvals_case_tenant_fk / _plan_tenant_fk / _requester_tenant_fk / _approver_tenant_fk
    const approvalBase = `decision_basis_hash, decision_basis, required_role, requester_id, state, expires_at`;
    await expect(
      client.query(
        `insert into approvals (id, tenant_id, case_id, plan_id, ${approvalBase})
         values ('appr_xfk4_case','ten_demo','case_xfk4_other','plan_xfk4','sha256:appr','{}'::jsonb,'finance_approver','user_investigator','PENDING', now() + interval '1 day')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into approvals (id, tenant_id, case_id, plan_id, ${approvalBase})
         values ('appr_xfk4_plan','ten_demo','case_xfk4','plan_xfk4_other','sha256:appr','{}'::jsonb,'finance_approver','user_investigator','PENDING', now() + interval '1 day')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into approvals (id, tenant_id, case_id, plan_id, ${approvalBase})
         values ('appr_xfk4_req','ten_demo','case_xfk4','plan_xfk4','sha256:appr','{}'::jsonb,'finance_approver','user_xfk3','PENDING', now() + interval '1 day')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into approvals (id, tenant_id, case_id, plan_id, ${approvalBase}, approver_id)
         values ('appr_xfk4_apr','ten_demo','case_xfk4','plan_xfk4','sha256:appr','{}'::jsonb,'finance_approver','user_investigator','PENDING', now() + interval '1 day', 'user_xfk3')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // actions_case_tenant_fk / actions_plan_tenant_fk
    await expect(
      client.query(
        `insert into actions (id, tenant_id, case_id, plan_id, tool_id, idempotency_key, request_hash, status)
         values ('action_xfk4_case','ten_demo','case_xfk4_other','plan_xfk4','SUPPRESS_SIMULATED_RECOVERY','idem_xfk4_case','sha256:req','AUTHORIZED')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into actions (id, tenant_id, case_id, plan_id, tool_id, idempotency_key, request_hash, status)
         values ('action_xfk4_plan','ten_demo','case_xfk4','plan_xfk4_other','SUPPRESS_SIMULATED_RECOVERY','idem_xfk4_plan','sha256:req','AUTHORIZED')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // action_attempts_action_tenant_fk
    await expect(
      client.query(
        `insert into action_attempts (id, tenant_id, action_id, attempt_number, request_payload)
         values ('attempt_xfk4','ten_demo','action_xfk4_other', 1, '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // verification_runs_action_tenant_fk
    await expect(
      client.query(
        `insert into verification_runs (id, tenant_id, action_id, contract_key, contract_version, status)
         values ('verif_xfk4','ten_demo','action_xfk4_other','transfer_remediation','vc_v1','VERIFICATION_PENDING')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // reconciliation_case_tenant_fk / _expectation_tenant_fk / _evidence_tenant_fk
    await expect(
      client.query(
        `insert into reconciliation_allocations (id, tenant_id, case_id, expectation_id, bank_line_evidence_id, amount_minor)
         values ('recon_xfk4_case','ten_demo','case_xfk4_other','exp_xfk3','evt_xfk3_demo', 91)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into reconciliation_allocations (id, tenant_id, case_id, expectation_id, bank_line_evidence_id, amount_minor)
         values ('recon_xfk4_exp','ten_demo','case_xfk4','exp_xfk3_other','evt_xfk3_demo', 91)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      client.query(
        `insert into reconciliation_allocations (id, tenant_id, case_id, expectation_id, bank_line_evidence_id, amount_minor)
         values ('recon_xfk4_evi','ten_demo','case_xfk4','exp_xfk3','evt_xfk4_other', 91)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // claim_evaluations_claim_tenant_fk
    await expect(
      client.query(
        `insert into claim_evaluations (id, tenant_id, claim_id, evaluation_version, status)
         values ('claim_eval_xfk4','ten_demo','claim_xfk4_other', 1, 'PENDING')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('one bank line can allocate to only one expectation (Buildathon strict one-to-one)', async () => {
    await client.query(
      `insert into economic_subjects (id, tenant_id, subject_type, subject_key, amount_minor, currency)
       values ('sub_recon','ten_demo','seller_allocation','order:recon:seller-1', 100, 'INR')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state)
       values ('exp_recon_1','ten_demo','sub_recon',1,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified')`,
    );
    await client.query(
      `insert into expectations (id, tenant_id, subject_id, version, rule_id, rule_version, expected_amount_minor, expected_terminal_state, is_current)
       values ('exp_recon_2','ten_demo','sub_recon',2,'seller_allocation_rule','contract_v4', 91, 'bank_credit_verified', false)`,
    );
    await client.query(
      `insert into cases (id, tenant_id, case_dedupe_key, subject_id, expectation_id, control_id, lifecycle_state)
       values ('case_recon','ten_demo','dedupe_recon','sub_recon','exp_recon_1','CTRL-01','verification_pending')`,
    );
    await client.query(
      `insert into ingest_events (id, tenant_id, source_system, source_event_type, event_time, payload_hash, raw_payload, raw_bytes, raw_representation, signature_status, dedupe_status, fallback_dedupe_key)
       values ('ev_bank_recon','ten_demo','SYNTHETIC_BANK','bank.credit', now(), 'sha256:bank-recon', '{}'::jsonb, convert_to('{}','UTF8'), 'canonical_row', 'verified','unique','fb_bank_recon')`,
    );
    await client.query(
      `insert into reconciliation_allocations (id, tenant_id, case_id, expectation_id, bank_line_evidence_id, amount_minor)
       values ('alloc_recon_1','ten_demo','case_recon','exp_recon_1','ev_bank_recon', 91)`,
    );
    // Same bank line, different expectation -> rejected.
    await expect(
      client.query(
        `insert into reconciliation_allocations (id, tenant_id, case_id, expectation_id, bank_line_evidence_id, amount_minor)
         values ('alloc_recon_2','ten_demo','case_recon','exp_recon_2','ev_bank_recon', 91)`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
