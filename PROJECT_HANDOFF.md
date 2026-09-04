# MoneyTrace — Cross-Machine Work Handoff

**Last updated:** 2026-09-02 (prototype-critical completion pass)
**Current checkpoint:** Gate **B4 prototype remediation implemented and full command gate green, but not self-approved. BACKEND READY FOR FRONTEND: NO — awaiting independent Gate B4 review.** See `docs/GATE_B4_IMPLEMENTATION_REPORT.md` §13; it supersedes the earlier readiness verdict in §12.
**Repository state:** this **is** a Git repository. Branch `main` is at `ebfbbcd`; the B3 remediation, the original B4 implementation, **and** this B4 remediation pass are all intentionally **uncommitted**. Do not commit or push without explicit user authorization.
**This file is self-contained** — assistant auto-memory does not travel between machines, so everything needed to continue is written here.

---

## 0B. Gate B4 prototype-critical completion — 2026-09-02 (current)

This pass closed the remaining defects found after the second B4 implementation review, without beginning Gate B5 or frontend work:

- Data Health duplicate and per-source conflict metrics now come from persisted audit/conflict facts; overview opened/closed trend comes from persisted UTC case timestamps.
- Pending import plus outbox acceptance is atomic, pending replay repairs a missing job, and import/reset responses use persisted resource versions.
- One registered synthetic demo tenant is enforced at service boundaries; database-resolved `TenantContext` is threaded through dataset/scenario jobs and every affected query is tenant-scoped.
- Scenario failures persist and expose only `DEMO_STEP_FAILED`; a failed step does not advance `completed_step`, and retries remain idempotent.
- Migration `0007_b4_claim_evidence_bindings.sql` adds append-only tenant-scoped claim/evidence bindings and exclusive captured-payment attribution.
- Claim evidence declarations are checked against the persisted canonical event. Eligible captures are bound captures only; refunds deduplicate by `refund_id`; reversals require payment/correlation linkage; capture reuse returns typed `409 AGENT_ATTRIBUTION_CONFLICT` without a second financial effect.
- Backend E2E now begins with a real async `/v1/imports` request, waits for worker acceptance, verifies version `0 → 1`, exactly 500 records, the persisted manifest, and all four scenarios' `completed_step`, `status=completed`, and `last_error=null`.

Final independent command evidence from this implementation pass: typecheck/lint/format pass; **715 unit tests**; **190 integration tests ×2** with identical counts; **909 full-suite tests**; backend E2E 1/1; build; API/worker smokes; Playwright normal+CI 1/1; production audit 0; full audit unchanged at four moderate dev-only advisories. Fresh empty PostgreSQL applies migrations `0001→0007` and the migration catalog assertions pass.

Cleanup is verified: no leaked test databases or disposable roles, no populated `.env`, no documented-port listeners, no repository Node processes, and `DATABASE_URL` unset. No commit, push, deployment, hosted service, paid API, real credential, or real-money capability was used.

**Resume action:** perform an independent Gate B4 code/PRD review using report §13 and the current uncommitted tree. Do not begin frontend or Gate B5 until that review explicitly accepts the backend.

---

## 0A. Historical Gate B4 status — 2026-09-01 second pass (superseded by §0B)

**See `docs/GATE_B4_IMPLEMENTATION_REPORT.md` §11–§12 for the complete remediation report.** This pass fixed P0 defects a Codex review found in the first B4 implementation pass (§1–§10 of the same report). Summary:

- **Agent-claim evidence binding + retained-value completeness**: `evidence_refs` now requires at least one entry; `linkedReversals` and `independentlySatisfiedBaseline` are now real, persisted-fact-derived inputs (previously hard-coded zeros); `linkedDisputes` stays honestly `0` with a documented vocabulary-gap rationale.
- **Tenant-wide reconciliation candidate enumeration, genuinely fixed** — including a gap this session's own first fix attempt introduced and then found and root-caused: bank evidence was still being bucketed by its own (ingestion-time-guessed) subject hint, making the "contested bank line" ambiguity path structurally unreachable. Now bank evidence is matched tenant-wide against each expectation's own settlement evidence.
- **Adapter dispatch is structurally unreachable from the API process** — proven by a real transitive-import BFS test (`tests/unit/architecture-boundaries.test.ts`), not a naming convention. The one remaining API-reachable dispatch path (CTRL-04 duplicate-recovery-prevention, reachable via `/v1/imports`) was moved to a new worker-only module + job topic.
- **Imports are genuinely asynchronous and retry-repairable** via a two-row append-only-compatible pending/accepted pattern (migration `0005_b4_import_async.sql`).
- **Connector/worker tenant and environment are resolved from the database everywhere a caller-supplied tenant id crosses a trust boundary** (`resolveTenantContext` in `identity-repository.ts`), replacing the systemic `createTenantContext(payload.tenant_id, 'demo')` hard-coding flagged in the first pass.
- **Scenario state exposes genuine queued/completed/failed status** (migration `0006_b4_scenario_status.sql` adds `completed_step`/`last_error`), never inferred from an HTTP 200 alone.
- **Three permissive test assertions replaced with exact ones**, tracing the real code path for each instead of accepting a range of plausible statuses.
- **New adversarial PostgreSQL test coverage**: a full `tests/integration/db/b4-claims.test.ts` (7 tests — evidence rejection, idempotency conflict, full/partial/unresolved/reversed attribution), 4 new reconciliation tests (contested bank line across two expectations, two independent bank credits for one expectation, parallel reconciliation, value-date tolerance boundary), a structural adapter-dispatch-reachability test, and 2 new readiness/OpenAPI tests.
- **Full command gate green, run individually**: typecheck, lint, format, **715** unit tests, **180** integration tests ×2 (up from 166, identical counts both runs), **895** full-suite tests, `test:e2e:backend` (all four scenarios + async paths over real HTTP+worker), build, both smokes, Playwright e2e normal+CI, prod audit 0, full audit unchanged (4 moderate dev-only, documented, pre-existing).
- **Every test failure this pass's own fixes surfaced was root-caused and fixed, not worked around** — see report §11.3 for the three cases (a manifest-metric test's stale synchronous-completion assumption, a reconciliation test's missing investigation prerequisite, and a mechanical migration-count update).

### Environment used this pass (separated from implementation)

Disposable **Docker** PostgreSQL 16-alpine (`moneytrace-test-pg`, host port **5433**), `DATABASE_URL` process-scoped only, never printed or committed. Container stopped and removed at the end of this pass (`docker stop && docker rm`) — no named volume, so removal fully wiped its data. No hosted DB, paid API, real credential, commit, or push was used. No leaked `moneytrace_test_*` databases, no populated `.env`, no stray Node process from this session's work remains at session end.

### Historical resume instruction (superseded by §0B)

Read `docs/GATE_B4_IMPLEMENTATION_REPORT.md` §11–§12 in full first (and §1–§10 for the original implementation context). The genuinely open items are listed in report §11.5 — none are known-incorrect behavior, all are disclosed, bounded coverage gaps (a unified migration-catalog test across all six migrations, worker poison-retry bound tests, an explicit import-crash-repair test, and the pre-existing Data-Health measurement gaps / non-exhaustive Fastify status-code matrix). Gate B5 (hardening & handoff) is the explicit next step.

---

## 0. Prior verified checkpoint (Gate B3) and historical resume point

Verdict: **Gate B3 remediation READY; no applicable B3 P0 remains.** Gate B4 is next, but it must begin only after reviewing this uncommitted tree. Verification/reconciliation/agent-claim/demo/dataset modules remain B4 placeholders.

Read these in order before changing code: `docs/CODEX_PROJECT_ROLE.md`, every controlling document it names (`MoneyTrace PRD.md`, backend PRD, frontend PRD, architecture handoff, Claude task catalog, Codex checklist, ADR 0001), then this handoff and the current gate prompt.

### B3 remediation delivered

| Requirement                          | Implementation                                                                                                                                                                                                                                                                                                                                                                 | Verification                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic action reservation            | `reserveAction` now performs current actor/environment authorization, tenant+idempotency advisory locking, explicit row locks for the case, plan, latest investigation/sealed evidence, latest policy decision, approval, and current memberships; rebuilds the complete live basis; then commits action, audit, outbox, and guarded lifecycle transitions in one transaction. | Initial concurrent reservation produces one action/audit/outbox; same-key body conflict is typed; deterministic interleaving after request start rejects stale basis with no action/outbox; approver-role revocation denies execution. |
| Service-boundary identity            | B3 public services accept actor IDs only and re-resolve tenant, environment, and current DB roles inside their transaction. Mutation authorization locks user/tenant/membership rows. Worker dispatch uses a branded trusted worker actor.                                                                                                                                     | Route/service integration tests cover 401/403, cross-tenant opacity, role loss, self-approval, and current-role enforcement.                                                                                                           |
| Fail-closed auth environment         | Demo-header feature operation is allowed only in demo/buildathon and test-under-`NODE_ENV=test`; non-demo startup throws until a real auth provider exists.                                                                                                                                                                                                                    | Unit tests cover development/production refusal and valid demo/test combinations.                                                                                                                                                      |
| Atomic policy/approval/case/audit    | Transaction-aware guarded lifecycle helper writes the case update, `case_transitions`, and audit together. Policy and approval mutations join the same case-locked transaction; forbidden/raced transitions are not swallowed. Approval expiry/invalidation are versioned and audited; reads never fabricate `decided_at`.                                                     | Exact history is asserted for open → investigating → recommendation_ready → approval_required → approved → executing; approval concurrency/expiry/invalidation/self-approval/audit cases pass.                                         |
| Stable DB race recovery              | Forward migration `0003_b3_reliability.sql` adds persisted approval versions and renames applied action/investigation/entity-link unique constraints by their actual column signatures. Applied migrations 0001/0002 were not rewritten.                                                                                                                                       | Fresh real PostgreSQL migration introspection proves `actions_idempotency_uq`, `investigations_uq`, and `entity_link_reviews_uq`; runtime race paths pass.                                                                             |
| Investigation crash repair           | An existing immutable investigation no longer short-circuits. Deterministic audit/transition IDs and idempotent plan materialization repair missing downstream artifacts exactly once. Gateway timeout/unavailable retry is bounded to two calls.                                                                                                                              | Simulated post-insert crash then retry repairs audit, plan, and lifecycle once; timeout/unavailable/nonretryable unit cases pass.                                                                                                      |
| Safe failures and persisted versions | One global Fastify handler emits only standard safe envelopes and logs only safe error descriptors. B3 mutation responses query persisted case/approval/action/plan versions.                                                                                                                                                                                                  | Secret-marker unexpected-error test proves response and captured logs contain no marker; runtime/OpenAPI parity and B3 inject matrix pass.                                                                                             |
| Dispatch crash/redelivery            | DISPATCHING redelivery reuses the same action and deterministic adapter reference; terminal/unknown outcomes do not create a new-key retry.                                                                                                                                                                                                                                    | Mid-dispatch post-adapter crash, redelivery, post-completion redelivery, and unknown-outcome tests pass.                                                                                                                               |

### Migration evidence

- `db/migrations/0003_b3_reliability.sql` is forward-only and idempotent.
- Fresh PostgreSQL 18 databases apply migrations `0001`, `0002`, and `0003`.
- Catalog assertions confirm the runtime constraint names exactly match unique-violation recovery: `actions_idempotency_uq`, `investigations_uq`, `entity_link_reviews_uq`.
- `approvals.version` is persisted with nonnegative default `0`; API resource versions come from stored rows.

### B3 API/OpenAPI status matrix

| Endpoint                                                    | Success | Documented safe errors  |
| ----------------------------------------------------------- | ------: | ----------------------- |
| `POST /v1/cases/:id/investigations`                         |     202 | 401, 403, 409, 422, 503 |
| `POST /v1/cases/:id/evaluate-policy`                        |     200 | 401, 403, 409, 422, 503 |
| `POST /v1/cases/:id/request-approval`                       |     200 | 401, 403, 409, 422, 503 |
| `POST /v1/cases/:id/{approve,reject,request-more-evidence}` |     200 | 401, 403, 409, 422, 503 |
| `POST /v1/cases/:id/execute`                                |     202 | 401, 403, 409, 422, 503 |
| `GET /v1/approvals`                                         |     200 | 400, 401, 403, 503      |
| `GET /v1/cases/:id/control-loop`                            |     200 | 401, 403, 404, 503      |

The generated OpenAPI snapshot and runtime registry are in parity. DB-backed Fastify injection covers every B3 route family for missing identity, forbidden/valid role, strict malformed input/query, stale versions/basis, cross-tenant opaque IDs, and standard success/error envelopes.

### Exact final command gate (2026-08-30)

| Command                                      | Observed result                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                          | PASS                                                                                                                                                          |
| `npm run lint`                               | PASS                                                                                                                                                          |
| `npm run format`                             | PASS                                                                                                                                                          |
| `npm run test:unit`                          | PASS — 41 files, 695 tests                                                                                                                                    |
| `npm run test:integration` (first fresh DB)  | PASS — 15 files, 136 tests                                                                                                                                    |
| `npm run test:integration` (second fresh DB) | PASS — 15 files, 136 tests                                                                                                                                    |
| `npm test`                                   | PASS — 56 files, 831 tests                                                                                                                                    |
| `npm run build`                              | PASS — server + Vite web                                                                                                                                      |
| `npm run smoke:api`                          | PASS — built API health                                                                                                                                       |
| `npm run smoke:worker`                       | PASS — side-effect-free built worker import                                                                                                                   |
| `npm run test:e2e`                           | PASS — Chromium, 1/1                                                                                                                                          |
| PowerShell `$env:CI='1'; npm run test:e2e`   | PASS — Chromium, 1/1                                                                                                                                          |
| `npm audit --omit=dev`                       | PASS — 0 vulnerabilities                                                                                                                                      |
| `npm audit`                                  | Expected nonzero — 4 moderate dev-only advisories in the documented `drizzle-kit → @esbuild-kit → esbuild` chain; offered fix is breaking and was not applied |

Sandbox-only startup/network failures were environmental, not implementation defects: restricted Vite/Vitest runs could not traverse to local configs, and restricted npm audit could not reach the registry. Identical unrestricted local commands produced the results above.

### Local environment and cleanup state

- PostgreSQL 18 is installed in the local Ubuntu WSL distro. Tests used `moneytrace_runner` with CREATEDB and a newly generated, process-only password per command. No password was written to the repository or handoff. The cluster is intentionally stopped.
- Matching Playwright Chromium `v1234` is installed locally.
- Final checks: zero leaked `moneytrace_test_*` databases; zero populated `.env` files; `DATABASE_URL` unset; zero documented-port listeners; zero lingering repository Node/Vite/Vitest/Playwright/Chromium processes; zero high-risk live-key/OpenAI-key/private-key markers.
- The broad tracked-file status is pre-existing line-ending churn. Review with `git diff --ignore-space-at-eol`; preserve it. The two Markdown files that failed Prettier were normalized. No commit, push, deployment, hosted database, paid provider, or real credential was used.

### Remaining limitations

- Gate B4 is wholly unimplemented and remains the next gate.
- The full audit's four moderate findings are development-tool-only; production audit is clean. Do not run the breaking `npm audit fix --force` suggestion.
- Browser coverage remains the existing single scaffold smoke; this is sufficient for the current backend B3 gate, not a substitute for later frontend acceptance.

Resume by reviewing the uncommitted B3 remediation diff and this evidence. If accepted, begin only Gate B4 from the current working tree.

---

## 1. What this project is

MoneyTrace (Razorpay Buildathon) — an **outcome-verification and financial-control layer**, not a payment chatbot or money-moving agent. It proves a full control loop over _real persisted backend state_:

```
signed/test evidence → durable journal + dedupe/conflict → deterministic projections + seller expectation
→ invariant violation + deduplicated case → evidence-backed investigation OR explicit abstention
→ registered plan + default-deny policy → immutable approval → stable action reservation + one simulated effect
→ transfer + settlement + independent bank evidence → unique reconciliation + ERP receivable closure
→ verified/reversed/unresolved outcome → complete audit replay
```

**Permanent hard rules (never violate):** no real money movement; no model-originated authoritative values/links/policy/approval/state; `bigint`/decimal-string money, INR-only, currency always present; no floating-point money; validate webhook HMAC over raw bytes before parsing; no exactly-once/ordering assumptions; conflicting evidence is quarantined, never overwritten; `settlement.processed` ≠ bank credit; candidate links never auto-promote; no action without current default-deny policy + bound approval where required; no blind retry of unknown outcomes; one bank line closes at most one obligation; tenant scope on every query/job/key; no secrets in browser/model/log/source/fixtures/docs; replay can never dispatch actions.

## 1a. Controlling documents (DO NOT EDIT)

- `MoneyTrace PRD.md` — product intent
- `docs/MONEYTRACE_BACKEND_PRD.md` — **the build contract** (gates B1–B5, APIs, acceptance)
- `docs/MONEYTRACE_ARCHITECTURE_HANDOFF.md` — stricter financial-safety rules win
- `docs/CLAUDE_CODE_TASKS.md` — MT task catalog
- `docs/CODEX_REVIEW_CHECKLIST.md` — permanent review checklist

When docs disagree on financial safety, **the stricter rule wins** — record the decision (ADR/report), never guess or weaken validation.

---

## 2. Stack & repo shape

Single npm **TypeScript ESM** package (modular monolith). Fastify API + pg-boss worker + React/Vite web. PostgreSQL + Drizzle. Zod → generated OpenAPI. Pino. Vitest + Playwright. **No Docker/Redis/Kafka/graph-DB dependency in the app itself** (Docker is only a convenience for a local test Postgres).

```
src/
  contracts/          # versioned Zod schemas + generated OpenAPI (source of truth for wire shapes)
  domain/             # pure money kernel + state machines (no I/O)
  config/             # db, env, logger, hashing, errors, db-schema (Drizzle)
  modules/            # identity, ingestion, projection, expectations, invariants, cases,
                      # provenance, evidence, investigation, policy, approvals, actions,
                      # verification*, reconciliation*, agent-claims*, audit*, demo   (* = B4 stubs)
  integrations/       # razorpay + synthetic-{oms,erp,bank,recovery,agent} (B4 mostly)
  api/routes/         # Fastify handlers
  worker/             # worker.ts, outbox-dispatcher.ts, job-handlers*.ts
  web/                # React/Vite (frontend gate — after backend accepted)
db/migrations/        # hand-written forward SQL (0001_init, 0002_b1_b2_integrity)
scripts/db/           # migrate, seed, reset, replay (tsx)
tests/                # unit, integration/db, e2e, adversarial, fixtures, support
```

---

## 3. Environment setup on the new machine

### 3.1 System prerequisites (install these manually — npm can't)

| Prerequisite                      | Version                              | How                                | Needed for                                                     |
| --------------------------------- | ------------------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| **Node.js** (includes npm)        | **>= 20.19** (enforced by `engines`) | https://nodejs.org (LTS) or nvm    | everything                                                     |
| **PostgreSQL** server w/ CREATEDB | 16.x recommended                     | Docker (below) or native installer | integration + e2e tests, running API/worker                    |
| **Docker Desktop** _(optional)_   | any recent                           | https://docker.com                 | only if you use the container Postgres instead of a native one |
| **Git Bash** _(Windows)_          | bundled w/ Git for Windows           | https://git-scm.com                | the Bash-style commands in this doc                            |

> Node ships npm; you don't install npm separately. Docker is **optional** — it's just the easiest disposable PostgreSQL.

### 3.2 Install ALL project packages in one step

**You do not install packages one by one.** `package.json` + `package-lock.json` list every dependency; a single command installs them all into `node_modules/`:

```bash
npm install          # or: npm ci   (exact, reproducible install from the lockfile — preferred)
npx playwright install chromium      # separate ~download of the browser binary for e2e (NOT an npm package)
# shortcut for both of the above:
npm run setup
```

`npm ci` is preferred on a fresh machine: it installs the **exact** locked versions and fails if `package.json` and the lockfile disagree. Make sure `package-lock.json` came across with the project (it's the source of truth for exact versions). If `node_modules/` was copied over, you can skip `npm install`, but re-running it is safe.

**Runtime dependencies** (`dependencies` — ship in the built app):

| Package                                              | Purpose                                                |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `fastify`                                            | HTTP API framework                                     |
| `pg`                                                 | PostgreSQL client/driver                               |
| `pg-boss`                                            | durable jobs/outbox inside PostgreSQL (the only queue) |
| `drizzle-orm`                                        | typed schema + query builder                           |
| `zod`                                                | runtime schema validation (contracts)                  |
| `@asteasolutions/zod-to-openapi`, `@fastify/swagger` | generate OpenAPI from the Zod schemas                  |
| `pino`                                               | structured logging (with secret redaction)             |
| `dotenv`                                             | load `.env` at entry points only                       |
| `react`, `react-dom`                                 | web frontend (later gate)                              |

**Dev / build / test dependencies** (`devDependencies` — not shipped):

| Package                                                                          | Purpose                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `typescript`, `tsx`                                                              | compiler + TS runner for scripts/dev                                         |
| `vite`, `@vitejs/plugin-react`                                                   | web build/dev server                                                         |
| `vitest`                                                                         | unit + integration test runner                                               |
| `@playwright/test`                                                               | e2e (needs the `chromium` binary from the extra command above)               |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `globals` | linting                                                                      |
| `prettier`                                                                       | formatting                                                                   |
| `drizzle-kit`                                                                    | Drizzle tooling _(source of the 4 known dev-only moderate audit advisories)_ |
| `pino-pretty`                                                                    | dev log prettifier                                                           |
| `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`                   | type definitions                                                             |

> If `npm audit` later flags the `drizzle-kit → @esbuild-kit → esbuild` moderate advisories, that is the **known, documented, dev-only** chain — do **not** `npm audit fix --force` it (that pins an old breaking `drizzle-kit`). `npm audit --omit=dev` must stay at **0**.

### 3.3 PostgreSQL — where the database lives and how to point at it

**Use a LOCAL PostgreSQL. The database lives on your own machine — not in the cloud.** This project's demo is deterministic and offline by design (`POST /v1/demo/reset` re-seeds identical state; integration tests create their own throwaway databases), so a disposable local DB is the intended setup, not a limitation. PostgreSQL is the _only_ durable runtime dependency.

**Do NOT use Supabase / a hosted DB for this project.** The integration tests **create and drop a fresh ephemeral database per test file** (`CREATE DATABASE moneytrace_test_…`), which needs **CREATEDB privilege** and an admin (`postgres`) database connection. Supabase's hosted plan gives you exactly one database, blocks `CREATE DATABASE`, and its connection pooler doesn't support those session operations — so `npm run test:integration` would fail. It also adds latency + an availability dependency for zero benefit on a prototype. (Deploying against some managed Postgres is a later Gate-B5/deployment concern, out of scope now.)

**Bring up a local Postgres — Docker (easiest):**

```bash
docker run -d --name moneytrace-test-pg -e POSTGRES_USER=moneytrace -e POSTGRES_PASSWORD=moneytrace -e POSTGRES_DB=moneytrace -p 5432:5432 postgres:16-alpine
```

**…or native:** install PostgreSQL 16, create a `moneytrace` role + `moneytrace` database, and use the same URL with your chosen password. Everything else is identical.

The connection string format is `postgres://USER:PASSWORD@HOST:PORT/DATABASE`. With the Docker command above it is:

```
postgres://moneytrace:moneytrace@127.0.0.1:5432/moneytrace
```

**Setting `DATABASE_URL` (pick one — but read the caveat):**

- **`.env` file** — used by the **app** entry points (dotenv-loaded): `db:migrate`, `db:seed`, `db:reset`, `start:api`, `start:worker`.
  ```bash
  cp .env.example .env      # then edit the DATABASE_URL line to the value above
  ```
- **Per-terminal env var (PowerShell — Windows default shell):**
  ```
  $env:DATABASE_URL = "postgres://moneytrace:moneytrace@127.0.0.1:5432/moneytrace"
  ```
- **Per-terminal env var (Git Bash):**
  ```bash
  export DATABASE_URL="postgres://moneytrace:moneytrace@127.0.0.1:5432/moneytrace"
  ```

> **Caveat that trips people up:** the **test runner reads `DATABASE_URL` from the process environment**, _not_ from `.env`. So for `npm run test:integration` / `npm run test:e2e` you must set the env var in the shell (PowerShell/Bash form above). A `.env` file alone is enough only for the **app** commands (migrate/seed/start).

**Once the DB is up, initialize it to actually run the app:**

```bash
npm run db:migrate      # applies db/migrations/*.sql to an empty database
npm run db:seed         # tenants, users, source connections, moneytrace_demo_v1 policy bundle
# npm run db:reset      # destructive re-seed (disposable demo DB only)
```

**Persistence note:** the Docker command stores data _inside the container_, so `docker rm` wipes it — which is fine here (reset re-seeds deterministically, tests use throwaway DBs). To keep data across container removal, add a named volume: `-v moneytrace-pgdata:/var/lib/postgresql/data`.

Unit tests, typecheck, lint, and build run **without** a database. `MODEL_PROVIDER=stub` (default) selects the deterministic offline investigation gateway — **no paid API key is ever required.**

**Cleanup after test runs:** stop/remove the container (`docker stop moneytrace-test-pg && docker rm moneytrace-test-pg`), delete any `.env`, ensure no stray Node processes or occupied dev ports (3000 / 5173 / 4700-4900). **Never commit a populated `.env`** or a real DB password — the local `moneytrace:moneytrace` dummy credentials are safe only because they exist solely on your machine.

---

## 4. Command gate (must stay green)

```bash
npm run typecheck
npm run lint
npm run format            # (npm run format:write to fix)
npm run test:unit
DATABASE_URL=... npm run test:integration     # run TWICE
DATABASE_URL=... npm run test                 # full suite
npm run build
npm run smoke:api
npm run smoke:worker
DATABASE_URL=... npm run test:e2e             # also with CI=1
npm audit --omit=dev                          # expect 0 vulnerabilities
```

**Current green state after B3 remediation:** typecheck/lint/format clean · **831 tests across 56 files pass** in the combined suite; the 136-test integration suite passes twice on fresh databases · build (server + web) ok · both smokes ok · e2e passes and exits 0 with and without `CI=1` · `npm audit --omit=dev` = 0. Full `npm audit` shows **4 moderate dev-only** advisories from the pre-existing `drizzle-kit → @esbuild-kit → esbuild` chain — documented in the ADR, unchanged by B3, not shipped.

DB commands: `npm run db:migrate`, `db:seed` (identity + source connections + `moneytrace_demo_v1` policy bundle), `db:reset`, `db:replay`.

---

## 5. What is COMPLETE

### Gate B1 — kernel & database ✅

Money kernel (`bigint`, INR-only, half-even rational allocation ₹5,00,000 = ₹4,55,000 + ₹45,000, signed adjustments, conservation), independent state machines (financial-outcome, case, claim, plan, approval, action, verification), all migrations/tables, tenant-scoped repositories, seeded identity (2 tenants incl. `ten_other` for negative tests; users `user_viewer`/`user_investigator`/`user_approver`/`user_operator`).

### Gate B2 — evidence → case ✅

Ingestion (source auth, raw-bytes preservation, HMAC, exact/modified-duplicate handling, conflict quarantine, journal), idempotent projection + replay guard, versioned expectations, **six deterministic controls CTRL-01…06** (fixed clock), deterministic case identity/epoch/priority/lifecycle, typed provenance + candidate isolation + sealed evidence sets, money-path endpoint, query APIs. Worker topics `project-evidence.v1`, `evaluate-controls.v1`.

### Gate B3 — control loop ✅ (this session)

**Investigation** — provider-neutral `ModelGateway` + deterministic `DemoInvestigationGateway` (classifies by evidence _pattern_, not case id; prompt-injection-resistant); optional `ExternalModelGateway` behind config, safe fallback to stub; `output-validator` enforces schema + citation-allowlist + finding/plan-template enums; exposure injected by app code; conflicting → `ABSTENTION/CONFLICTING_EVIDENCE`, missing → `INSUFFICIENT_EVIDENCE`; immutable `investigations` rows; `POST /v1/cases/:id/investigations` enqueues durable `run-investigation.v1`.

**Policy** — pure default-deny `policy-engine` (full §12.2 matrix: L4/real-money→DENY, contradictions/incomplete-coverage→REQUIRE_MORE_EVIDENCE, suppress-recovery→ALLOW_AUTOMATIC, transfer-remediation→REQUIRE_APPROVAL(finance_approver), receivable-closure→DENY in B3, bad env/role/currency/missing→DENY); immutable `moneytrace_demo_v1` bundle seeded; immutable canonical plan hashes; `POST /v1/cases/:id/evaluate-policy`. Contract added a second registered plan template `SUPPRESS_DUPLICATE_RECOVERY` (bound only to `SUPPRESS_SIMULATED_RECOVERY`) — the four **tool** ids are unchanged.

**Approvals** — full 17-field `decision_basis_hash`, request/approve/reject/request-more-evidence, lazy expiry, invalidation, separation-of-duties (no self-approval), server-derived actor/role, append-only history; `GET /v1/approvals`; routes `request-approval`/`approve`/`reject`/`request-more-evidence`.

**Actions** — `POST /v1/cases/:id/execute`: rebuild-and-compare basis inside the reservation transaction; stable content-derived idempotency key + request-body hash (same key/same body → existing action, same key/different body → 409 `IDEMPOTENCY_BODY_CONFLICT`); atomic reservation + audit + `dispatch-action.v1` outbox; **worker-only** closed adapter registry (simulated Route + recovery only); append-only attempts; ACK/FAILED/OUTCOME_UNKNOWN distinct; unknown never retried under a new key; deterministic external-ref so crash/redelivery yields exactly one effect; replay hard-denies dispatch (reused B2 guard).

**Read model** — `GET /v1/cases/:id/control-loop` (real finding/plan/policy/approval/action + `allowed_next_commands` + current basis hash). Case detail now surfaces `finding_id`/`current_plan_id`/`latest_policy_decision_id`.

**Two real safety bugs found & fixed during B3 testing:**

1. Approval side effects (plan/case version bumps) were invalidating the very basis they granted → deferred the `approval_required → approved → executing` case transition into `reserveAction`, after the basis comparison; approve no longer bumps `plan.version`.
2. Idempotent re-execute could throw `APPROVAL_STALE` → in `reserveAction`, the existing-reservation lookup now happens **before** the freshness rebuild; a repeat returns the existing action, a genuinely new authorization still gets the full rebuild-and-compare.

**Wired API routes (handlers exist):** `POST /v1/events`, `POST /v1/webhooks/razorpay`, `GET /v1/cases`, `GET /v1/cases/:id`, `GET /v1/cases/:id/{money-path,evidence,notes,control-loop}`, `POST /v1/cases/:id/{assign,notes,links/:linkId/decision,investigations,evaluate-policy,request-approval,approve,reject,request-more-evidence,execute}`, `GET /v1/approvals`.

**Worker topics live:** `project-evidence.v1`, `evaluate-controls.v1`, `run-investigation.v1`, `dispatch-action.v1`.

---

## 6. Gate B4 implementation status and next boundary

The historical Gate B4 TODO list previously in this section is complete and verified by `docs/GATE_B4_IMPLEMENTATION_REPORT.md` §13: verification, reconciliation/closure/reversal, agent claims, audit/read models, async import, all declared routes, all four worker topics, the measured 500-record dataset, and all four real API/worker scenarios are implemented.

The next action is **independent Gate B4 review**, not Gate B5 or frontend. Current implementation status is intentionally:

**BACKEND READY FOR FRONTEND: NO — awaiting independent Gate B4 review.**

### Gate B5 — hardening & handoff (after B4)

All tests green, OpenAPI + fixtures for every frontend endpoint, runbook, measured manifest, security/secret scan, backend completion report mapping every PRD section → files → tests, `BACKEND READY FOR FRONTEND: YES/NO`. Frontend (`src/web`) only begins after backend acceptance.

---

## 7. B3 remediation gaps closed

The previously listed B3 coverage gaps are now closed: DB-backed Fastify injection covers the B3 route families; gateway retry bounds have direct unit tests; mid-`DISPATCHING` crash/redelivery is explicitly simulated; cross-tenant B3 route/service behavior is exercised; and deterministic request-start/reservation interleaving proves stale-basis rollback.

---

## 8. Key B3 files (fast orientation)

| Area          | Files                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Investigation | `src/modules/investigation/{model-gateway,demo-gateway,external-gateway,gateway-factory,output-validator,evidence-classification,investigation-service,investigation-repository}.ts` |
| Policy        | `src/modules/policy/{policy-engine,policy-bundle,policy-service,plan-service}.ts`                                                                                                    |
| Approvals     | `src/modules/approvals/{decision-basis,approval-service}.ts`                                                                                                                         |
| Actions       | `src/modules/actions/{idempotency,adapter-registry,action-service,action-dispatch}.ts`                                                                                               |
| Read model    | `src/modules/cases/control-loop-service.ts`                                                                                                                                          |
| Routes        | `src/api/routes/{investigations,policy,approvals,actions,problem}.ts` (+ additions to `cases.ts`, `case-details.ts`, `server.ts`)                                                    |
| Worker        | `src/worker/job-handlers-b3.ts` (+ `worker.ts` wiring)                                                                                                                               |
| Contracts     | `src/contracts/{plans,api-endpoints,registry}.ts` (+ regenerated OpenAPI snapshot)                                                                                                   |
| Tests         | `tests/unit`, `tests/integration/api-b3-control-loop.test.ts`, `tests/integration/db/b3-control-loop.test.ts`                                                                        |

---

## 9. Working conventions

- Windows: Bash tool = POSIX/Git-Bash; PowerShell tool = Windows PowerShell 5.1 (no `&&`). Scratch/temp files go in the session scratchpad, never the repo.
- Contract changes must update **runtime schema + generated OpenAPI + invalid corpus + snapshots together** (the parity/snapshot tests enforce this; run `npx vitest run tests/unit/contracts/openapi.test.ts -u` after intentional additions, then review the diff).
- Money on the wire is always a decimal string; never `z.number()`; INR only.
- One gate per session, **stop for review** at the end of each gate. Do not start B5 or frontend while any B4 P0 item is incomplete.
