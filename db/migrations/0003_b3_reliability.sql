-- Gate B3 reliability remediation. Forward-only: applied migrations are never rewritten.

alter table approvals
  add column if not exists version integer not null default 0 check (version >= 0);

-- The hand-written migrations originally let PostgreSQL choose these names,
-- while runtime race recovery used the stable Drizzle schema names. Resolve
-- the actually-applied constraints by their ordered columns, then rename them.
do $$
declare
  old_name text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'actions'::regclass and conname = 'actions_idempotency_uq'
  ) then
    select c.conname into old_name
    from pg_constraint c
    where c.conrelid = 'actions'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['tenant_id', 'idempotency_key']::name[];
    if old_name is null then
      raise exception 'actions idempotency constraint not found';
    end if;
    execute format('alter table actions rename constraint %I to actions_idempotency_uq', old_name);
  end if;
end $$;

do $$
declare
  old_name text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'investigations'::regclass and conname = 'investigations_uq'
  ) then
    select c.conname into old_name
    from pg_constraint c
    where c.conrelid = 'investigations'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['case_id', 'evidence_set_hash', 'prompt_version', 'model_config_hash']::name[];
    if old_name is null then
      raise exception 'investigation idempotency constraint not found';
    end if;
    execute format('alter table investigations rename constraint %I to investigations_uq', old_name);
  end if;
end $$;

do $$
declare
  old_name text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'entity_link_reviews'::regclass and conname = 'entity_link_reviews_uq'
  ) then
    select c.conname into old_name
    from pg_constraint c
    where c.conrelid = 'entity_link_reviews'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['tenant_id', 'link_id', 'review_version']::name[];
    if old_name is null then
      raise exception 'entity-link review constraint not found';
    end if;
    execute format(
      'alter table entity_link_reviews rename constraint %I to entity_link_reviews_uq',
      old_name
    );
  end if;
end $$;
