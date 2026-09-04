-- Gate B4 remediation: expose queued/completed/failed demo scenario state
-- (backend PRD §14.1/§15). `demo_scenario_state` is a mutable "current head"
-- table (not append-only), so adding columns and updating them in place is
-- consistent with its existing design.
--
-- `current_step` (existing) is bumped synchronously by the API request path
-- the instant the step is durably accepted (backend PRD §14.1 "async"): it
-- reflects what has been QUEUED, not necessarily what the worker has
-- finished applying. `completed_step` is written ONLY by the worker after
-- `runDemoScenarioStep` returns successfully, so a client can distinguish
-- queued (`current_step > completed_step`) from completed
-- (`current_step = completed_step`). `last_error` records the failure reason
-- for the most recent unsuccessful attempt at `current_step`, cleared on the
-- next successful completion.

alter table demo_scenario_state
  add column if not exists completed_step integer not null default 0;

alter table demo_scenario_state
  add column if not exists last_error text;
