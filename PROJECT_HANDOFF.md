# MoneyTrace — Cross-Machine Work Handoff

**Last updated:** 2026-08-30
**Current checkpoint:** Gate **B3 COMPLETE** and green. Next up: **Gate B4**.
**This file is self-contained** — the project is not a git repo and the assistant's auto-memory does not travel between machines, so everything needed to continue is written here.

---

## 0. TL;DR — where to continue

1. Read the four **controlling docs** (below) — they are binding and must **NOT** be edited.
2. Set up the environment (§3) — install deps + start a PostgreSQL for integration tests.
3. Confirm the repo is green (§4) — run the command gate; everything should pass.
4. Implement **Gate B4** (§6) — verification, reconciliation, agent claims/reversal, audit read/export, demo reset/advance, overview/Data-Health read models, and the 500-record dataset. **One gate at a time; stop for review at the end of B4.**
5. Optionally first close the small **B3 test-coverage gaps** (§7) — implementation is done, only tests are thin there.

---

## 1. What this project is

MoneyTrace (Razorpay Buildathon) — an **outcome-verification and financial-control layer**, not a payment chatbot or money-moving agent. It proves a full control loop over *real persisted backend state*:

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

| Prerequisite | Version | How | Needed for |
|---|---|---|---|
| **Node.js** (includes npm) | **>= 20.19** (enforced by `engines`) | https://nodejs.org (LTS) or nvm | everything |
| **PostgreSQL** server w/ CREATEDB | 16.x recommended | Docker (below) or native installer | integration + e2e tests, running API/worker |
| **Docker Desktop** *(optional)* | any recent | https://docker.com | only if you use the container Postgres instead of a native one |
| **Git Bash** *(Windows)* | bundled w/ Git for Windows | https://git-scm.com | the Bash-style commands in this doc |

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

| Package | Purpose |
|---|---|
| `fastify` | HTTP API framework |
| `pg` | PostgreSQL client/driver |
| `pg-boss` | durable jobs/outbox inside PostgreSQL (the only queue) |
| `drizzle-orm` | typed schema + query builder |
| `zod` | runtime schema validation (contracts) |
| `@asteasolutions/zod-to-openapi`, `@fastify/swagger` | generate OpenAPI from the Zod schemas |
| `pino` | structured logging (with secret redaction) |
| `dotenv` | load `.env` at entry points only |
| `react`, `react-dom` | web frontend (later gate) |

**Dev / build / test dependencies** (`devDependencies` — not shipped):

| Package | Purpose |
|---|---|
| `typescript`, `tsx` | compiler + TS runner for scripts/dev |
| `vite`, `@vitejs/plugin-react` | web build/dev server |
| `vitest` | unit + integration test runner |
| `@playwright/test` | e2e (needs the `chromium` binary from the extra command above) |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `globals` | linting |
| `prettier` | formatting |
| `drizzle-kit` | Drizzle tooling *(source of the 4 known dev-only moderate audit advisories)* |
| `pino-pretty` | dev log prettifier |
| `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom` | type definitions |

> If `npm audit` later flags the `drizzle-kit → @esbuild-kit → esbuild` moderate advisories, that is the **known, documented, dev-only** chain — do **not** `npm audit fix --force` it (that pins an old breaking `drizzle-kit`). `npm audit --omit=dev` must stay at **0**.

### 3.3 PostgreSQL for tests

Integration/E2E tests create ephemeral databases and require a reachable server with CREATEDB. They **fail loudly if `DATABASE_URL` is unset** (they never silently skip). Easiest is a disposable Docker container:

```bash
docker run -d --name moneytrace-test-pg -e POSTGRES_USER=moneytrace -e POSTGRES_PASSWORD=moneytrace -e POSTGRES_DB=moneytrace -p 5432:5432 postgres:16-alpine
```

Then set (do **not** commit a populated `.env`):

```
DATABASE_URL=postgres://moneytrace:moneytrace@127.0.0.1:5432/moneytrace
```

Unit tests, typecheck, lint, build run **without** a database. `MODEL_PROVIDER=stub` (default) selects the deterministic offline investigation gateway — **no paid API key is ever required.**

**Cleanup after test runs:** stop/remove the container, delete any `.env`, ensure no stray Node processes or occupied dev ports (3000 / 5173 / 4700-4900).

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

**Current green state (end of B3):** typecheck/lint/format clean · **787 tests across 53 files pass** (unit + integration ×2) · build (server + web) ok · both smokes ok · e2e passes and exits 0 with and without `CI=1` · `npm audit --omit=dev` = 0. Full `npm audit` shows **4 moderate dev-only** advisories from the pre-existing `drizzle-kit → @esbuild-kit → esbuild` chain — documented in the ADR, unchanged by B3, not shipped.

DB commands: `npm run db:migrate`, `db:seed` (identity + source connections + `moneytrace_demo_v1` policy bundle), `db:reset`, `db:replay`.

---

## 5. What is COMPLETE

### Gate B1 — kernel & database ✅
Money kernel (`bigint`, INR-only, half-even rational allocation ₹5,00,000 = ₹4,55,000 + ₹45,000, signed adjustments, conservation), independent state machines (financial-outcome, case, claim, plan, approval, action, verification), all migrations/tables, tenant-scoped repositories, seeded identity (2 tenants incl. `ten_other` for negative tests; users `user_viewer`/`user_investigator`/`user_approver`/`user_operator`).

### Gate B2 — evidence → case ✅
Ingestion (source auth, raw-bytes preservation, HMAC, exact/modified-duplicate handling, conflict quarantine, journal), idempotent projection + replay guard, versioned expectations, **six deterministic controls CTRL-01…06** (fixed clock), deterministic case identity/epoch/priority/lifecycle, typed provenance + candidate isolation + sealed evidence sets, money-path endpoint, query APIs. Worker topics `project-evidence.v1`, `evaluate-controls.v1`.

### Gate B3 — control loop ✅ (this session)
**Investigation** — provider-neutral `ModelGateway` + deterministic `DemoInvestigationGateway` (classifies by evidence *pattern*, not case id; prompt-injection-resistant); optional `ExternalModelGateway` behind config, safe fallback to stub; `output-validator` enforces schema + citation-allowlist + finding/plan-template enums; exposure injected by app code; conflicting → `ABSTENTION/CONFLICTING_EVIDENCE`, missing → `INSUFFICIENT_EVIDENCE`; immutable `investigations` rows; `POST /v1/cases/:id/investigations` enqueues durable `run-investigation.v1`.

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

## 6. What is STILL TODO — Gate B4 (next) then B5

Gate B4 = **verification & demo** (backend PRD §13, §14.1–§14.2 remaining, §15–§16). Tables already exist in `db/migrations/0001_init.sql` (`verification_contracts`, `verification_runs`, `reconciliation_allocations`, `agent_result_claims`, `claim_evaluations`, `demo_scenario_state`, `demo_seed_manifest`) but have **no service logic yet**.

**Routes declared in the contract registry but NOT yet implemented as handlers:**
- `POST /v1/imports` — deterministic dataset import
- `GET /v1/cases/:id/verification` — contract/run/evidence view (ACK ≠ verified)
- `POST /v1/actions/:id/verification-checks` — idempotent recheck
- `GET /v1/cases/:id/audit` — cursor audit replay, role-redacted
- `POST /v1/agent-results` + `GET /v1/agent-results/:id` — untrusted claim + retained-value evaluations
- `POST /v1/demo/reset` + `POST /v1/demo/scenarios/:id/advance` — env+role gated

**§14.2 frontend-readiness endpoints still to add (contract + handler):** `GET /v1/overview`, `GET /v1/data-health`, `GET /v1/demo/status`, `GET /v1/cases/:id/audit/export` (with content-hash in body + safe header; CSV formula-neutralization if CSV added later).

**Worker topics to add (PRD §15):** `check-verification.v1`, `reconcile-expectation.v1`, `reevaluate-claim.v1`, `advance-demo-scenario.v1`.

**Domain work:**
- Verification contracts + runs: required-evidence coverage, authority buckets (amount/currency/identity/time), `SYNTHETIC_AGENT` never terminal authority, `settlement.processed` not bank proof, zero blockers, effect verification.
- Reconciliation: strict **one-bank-line ↔ one-expectation** allocation with row locks + unique constraints; ambiguity → `RECONCILIATION_AMBIGUOUS`, exposure preserved.
- ERP closure observed (not merely requested) → only then outcome `VERIFIED`, case `reconciled`. `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION` becomes dispatchable here (currently policy-denied in B3 by design).
- Agent claims: always `SYNTHETIC_AGENT/UNTRUSTED_CLAIM`; retained-value `= max(0, eligible − refunds − reversals − disputes − baseline)`; opening claim ₹1,20,000 − ₹1,20,000 = ₹0 → `REVERSED`; append-only evaluations.
- Reversal: later authoritative refund appends `EFFECT_REVERSED`/`REVERSED`, opens a **new case epoch**, never erases history.
- Synthetic adapters: signed Route/settlement/bank/ERP/recovery/agent sources (integrations/synthetic-*), all labelled `synthetic`.

**Demo/dataset (§16):** exactly **500** accepted synthetic records, fixed UTC times, no PII, manifest **computed from persisted rows** (not constants) asserting: `records_total=500`, `records_matched=468`, `unresolved_cases=16`, `unsafe_candidate_matches_blocked=4`, `unresolved_exposure=128000000`, `verified_restored=45500000`, `duplicate_collection_prevented=50000000`, `reversed_recovery=12000000`. Named scenarios `claim-reversal`, `missing-transfer-remediation`, `conflicting-bank-evidence`, `duplicate-replay`; reset idempotent (identical manifest hash), advance requires expected step.

**Four end-to-end scenarios (PRD §2) must run against real Postgres + API/worker** — this is the B4/B5 acceptance bar.

### Gate B5 — hardening & handoff (after B4)
All tests green, OpenAPI + fixtures for every frontend endpoint, runbook, measured manifest, security/secret scan, backend completion report mapping every PRD section → files → tests, `BACKEND READY FOR FRONTEND: YES/NO`. Frontend (`src/web`) only begins after backend acceptance.

---

## 7. Known B3 gaps (implementation done — only test coverage is thin)

Close these opportunistically; they are **not** open implementation risk:
- No **HTTP-layer** (Fastify `inject`) tests for the new route files — role/401/403/cross-tenant are proven at the *service* layer (12 integration tests) + `smoke:api`, not request-level. **Recommended first task** on the new machine.
- External-gateway **timeout/retry** path has code (`ModelGatewayTimeoutError`, one retry) but no unit test with a mock failing gateway.
- **Mid-`DISPATCHING` crash** (between status transition and outcome-recording tx) is handled by redelivery logic but not explicitly simulated; only post-completion redelivery is tested.
- Cross-tenant coverage is per-flow, not exhaustively per repository function.

---

## 8. Key B3 files (fast orientation)

| Area | Files |
|---|---|
| Investigation | `src/modules/investigation/{model-gateway,demo-gateway,external-gateway,gateway-factory,output-validator,evidence-classification,investigation-service,investigation-repository}.ts` |
| Policy | `src/modules/policy/{policy-engine,policy-bundle,policy-service,plan-service}.ts` |
| Approvals | `src/modules/approvals/{decision-basis,approval-service}.ts` |
| Actions | `src/modules/actions/{idempotency,adapter-registry,action-service,action-dispatch}.ts` |
| Read model | `src/modules/cases/control-loop-service.ts` |
| Routes | `src/api/routes/{investigations,policy,approvals,actions,problem}.ts` (+ additions to `cases.ts`, `case-details.ts`, `server.ts`) |
| Worker | `src/worker/job-handlers-b3.ts` (+ `worker.ts` wiring) |
| Contracts | `src/contracts/{plans,api-endpoints,registry}.ts` (+ regenerated OpenAPI snapshot) |
| Tests | `tests/unit/modules/*.test.ts` (67), `tests/integration/db/b3-control-loop.test.ts` (12) |

---

## 9. Working conventions

- Windows: Bash tool = POSIX/Git-Bash; PowerShell tool = Windows PowerShell 5.1 (no `&&`). Scratch/temp files go in the session scratchpad, never the repo.
- Contract changes must update **runtime schema + generated OpenAPI + invalid corpus + snapshots together** (the parity/snapshot tests enforce this; run `npx vitest run tests/unit/contracts/openapi.test.ts -u` after intentional additions, then review the diff).
- Money on the wire is always a decimal string; never `z.number()`; INR only.
- One gate per session, **stop for review** at the end of each gate. Do not start B5 or frontend while any B4 P0 item is incomplete.
