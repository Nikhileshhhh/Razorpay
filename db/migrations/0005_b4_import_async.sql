-- Gate B4 remediation: genuinely asynchronous, durable, retry-repairable
-- imports (backend PRD §14.1 "async/durable import id and item counts").
-- Forward-only; never rewrites 0001-0004. Safe to rerun (guarded DO blocks).
--
-- `data_imports` remains append-only (its `forbid_update_delete` trigger is
-- untouched) — a logical import is now represented by MULTIPLE immutable
-- rows sharing the same `(tenant_id, seed_id)`: exactly one `pending` row
-- (inserted the moment the import is durably accepted, before any dataset
-- record exists) and, once the full dataset and manifest are genuinely
-- persisted, exactly one additional `accepted` row. There is no UPDATE of
-- the pending row into an accepted one (forbidden by the append-only
-- trigger, and deliberately so: a partial dataset can never be presented as
-- accepted merely by flipping a status column). A crash between the two
-- rows leaves the import durably `pending` forever until a retry produces
-- the `accepted` row — never a false `accepted` for less than the complete
-- registered dataset.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'data_imports'::regclass
      and conname = 'data_imports_status_check'
  ) then
    alter table data_imports drop constraint data_imports_status_check;
  end if;
end $$;

alter table data_imports
  add constraint data_imports_status_check check (status in ('pending', 'accepted', 'failed'));
