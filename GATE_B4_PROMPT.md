# Gate B4 Implementation Prompt — MoneyTrace Backend

> **How to use this file:** paste the 3-line trigger prompt (bottom of this doc, or the one your teammate gave you) into a fresh Claude Code session opened at the repo root. The agent reads this file and implements **Gate B4 only**. This prompt is self-contained but points at the binding controlling docs, which are the ultimate authority.

---

## 0. Your role and the single task

You are continuing a strictly-sequenced backend build. **Gates B1, B2, and B3 are COMPLETE and green.** Your job in this session is to implement **Gate B4 (verification & demo) ONLY**, following the exact same discipline that produced B1–B3:

- Work **one gate per session** and **stop for review at the end of B4**. Do **not** begin Gate B5 (hardening/handoff) or any frontend work.
- Keep the repository **green at every checkpoint**. Never weaken a validator, fake a success path, or hard-code a metric to make something pass.
- Preserve **all existing behavior, migrations, safety boundaries, and passing tests** from B1–B3.

Before writing any code: **re-read the four controlling documents** (they are binding; do **not** edit them), and read `PROJECT_HANDOFF.md` in the repo root (full current-state map, env setup, dependency list, and the exact list of what is done vs pending).

### Controlling documents (DO NOT EDIT)
- `docs/MONEYTRACE_BACKEND_PRD.md` — the build contract (Gate B4 = §13, §16, plus the §14.1/§14.2 endpoints not yet built, and §15 jobs)
- `docs/MONEYTRACE_ARCHITECTURE_HANDOFF.md` — stricter financial-safety rules win
- `MoneyTrace PRD.md` — product intent
- `docs/CLAUDE_CODE_TASKS.md` — MT task catalog (MT-016–MT-018 map to B4)
- `docs/CODEX_REVIEW_CHECKLIST.md` — permanent P0 review checklist

**When docs disagree on financial safety, the stricter rule wins.** Record any judgment call in an ADR or the completion report — never guess or silently weaken validation.

### Permanent prohibitions (never violate)
No real money movement or generic/arbitrary action. No model-originated authoritative values, links, policy, approval, verification, reconciliation, or state. `bigint`/PostgreSQL-`BIGINT`/decimal-string money, **INR only**, currency always present, no floating-point money. Validate webhook HMAC over raw bytes before parsing. No exactly-once/ordering assumptions. Conflicting evidence is quarantined, never overwritten. `settlement.processed` is **not** bank-credit proof. Candidate links never auto-promote to authoritative. No action without current default-deny policy + bound approval where required. No blind retry of unknown outcomes. **One bank line/observed value closes at most one obligation.** `VERIFIED` requires every authoritative check + zero blockers. Reversals append history and reopen a new case epoch — never erase. Tenant scope on every query/job/key. No secrets in browser/model/log/source/fixtures/docs. Replay can never dispatch actions.

---

## 1. First: get to a green baseline

The project is **not** shipped with `node_modules` and needs a PostgreSQL for integration/E2E tests. Follow `PROJECT_HANDOFF.md` §3, in short:

```bash
npm ci                                 # installs every pinned dependency (do not add packages one by one)
npx playwright install chromium        # e2e browser binary (separate download)
# start a disposable PostgreSQL (Docker), or point DATABASE_URL at a native one:
docker run -d --name moneytrace-test-pg -e POSTGRES_USER=moneytrace -e POSTGRES_PASSWORD=moneytrace -e POSTGRES_DB=moneytrace -p 5432:5432 postgres:16-alpine
export DATABASE_URL=postgres://moneytrace:moneytrace@127.0.0.1:5432/moneytrace   # PowerShell: $env:DATABASE_URL="..."
```

Then confirm green **before touching anything**:

```bash
npm run typecheck && npm run lint && npm run format && npm run test:unit
DATABASE_URL=... npm run test:integration        # expect 98 passing across 14 files
```

Integration tests **fail loudly if `DATABASE_URL` is unset** (they never skip). `MODEL_PROVIDER=stub` (default) needs no paid API key. If the baseline is not green, stop and diagnose before starting B4.

---

## 2. GATE B3 TRACEABILITY REPORT (the checkpoint you are building on)

This is the verified end-state of the previous session. Everything below is **DONE**; do not rebuild it — extend it.

### 2.1 Requirement → files → tests → result

| Backend PRD requirement | Implementation | Tests | Result |
|---|---|---|---|
| §11 `ModelGateway` + deterministic `DemoInvestigationGateway` (default `MODEL_PROVIDER=stub`) | `src/modules/investigation/{model-gateway,demo-gateway,gateway-factory}.ts` | `tests/unit/modules/demo-gateway.test.ts` (9) | PASS |
| §11.1 sealed, typed, tenant-scoped evidence retrieval | `src/modules/investigation/evidence-classification.ts` (reuses B2 `sealEvidenceSet`) | integration | PASS |
| §11.1/§11.3 citation / finding-enum / plan-template-enum / schema validation | `src/modules/investigation/output-validator.ts` | `tests/unit/modules/investigation-output-validator.test.ts` (10 — invented citation, mismatched plan, malformed output, prompt-injection, arithmetic-tampering) | PASS |
| §11.1 deterministic exposure injected by app code (never model) | `src/modules/investigation/investigation-service.ts` | integration | PASS |
| §11.1 conflicting → `ABSTENTION/CONFLICTING_EVIDENCE`; missing → `INSUFFICIENT_EVIDENCE` | demo-gateway.ts | unit + integration | PASS |
| immutable investigation attempts/hashes/modes/outputs/abstentions/safe-failures | investigation-service.ts, `investigation-repository.ts` | integration | PASS |
| `POST /v1/cases/:id/investigations` + expected-version/idempotency + durable `run-investigation.v1` | `src/api/routes/investigations.ts`, `src/worker/job-handlers-b3.ts` | integration | PASS |
| §11.2 optional external provider, safe fallback, no paid API required | `src/modules/investigation/external-gateway.ts` | code review only — **no test** (gap) | PARTIAL |
| §12.1 four registered tools only, no generic HTTP/SQL | `src/contracts/plans.ts`, `src/modules/actions/adapter-registry.ts` | `tests/unit/modules/adapter-registry.test.ts` (6) | PASS |
| canonical immutable plan hash; immutable `moneytrace_demo_v1` bundle seeded | `src/modules/policy/{plan-service,policy-bundle}.ts` | integration | PASS |
| §12.2 exhaustive default-deny matrix | `src/modules/policy/policy-engine.ts` | `tests/unit/modules/policy-engine.test.ts` (16, incl. all 5 environments) | PASS |
| `POST /v1/cases/:id/evaluate-policy` + persisted input/hash/rules/reasons/bundle/actor | `src/modules/policy/policy-service.ts`, `src/api/routes/policy.ts` | integration | PASS |
| §12.3 17-field `decision_basis_hash` | `src/modules/approvals/decision-basis.ts` (reuses B1 `DECISION_BASIS_FIELDS`) | `tests/unit/modules/decision-basis.test.ts` (21 — every field parametrized) | PASS |
| request/approve/reject/request-more-evidence/expiry/invalidation; server-derived actor/role; no self-approval | `src/modules/approvals/approval-service.ts`, `src/api/routes/approvals.ts` | integration (self-approval, stale-after-mutation, concurrent decide, expiry, role-revocation) | PASS |
| `POST .../request-approval\|approve\|reject\|request-more-evidence`, `GET /v1/approvals` | approvals.ts | integration | PASS |
| §12.4 rebuild+compare basis inside reservation tx; atomic reservation+audit+outbox | `src/modules/actions/action-service.ts` | integration | PASS |
| stable idempotency key + request hash; same key/same body idempotent; same key/different body → 409 | `src/modules/actions/idempotency.ts`, action-service.ts | `tests/unit/modules/idempotency.test.ts` (5) + integration | PASS |
| worker-only closed Route/recovery adapter registry | adapter-registry.ts, `src/modules/actions/action-dispatch.ts` | integration | PASS |
| append-only attempts; ACK/FAILED/OUTCOME_UNKNOWN distinct; unknown never retried under new key | action-dispatch.ts | integration (redelivery, OUTCOME_UNKNOWN) | PASS |
| `POST /v1/cases/:id/execute` | `src/api/routes/actions.ts` | integration | PASS |
| replay hard-denies `dispatch-action.v1` | `src/worker/outbox-dispatcher.ts` (reused B2 guard) | integration | PASS |
| `GET /v1/cases/:id/control-loop` from real persisted state + allowed-next-commands | `src/modules/cases/control-loop-service.ts` | integration | PASS |
| runtime-validated Zod on every route; OpenAPI regenerated; `resource_version` on mutations | `src/contracts/{plans,api-endpoints,registry}.ts` | `openapi.test.ts` snapshot + `runtime-openapi-parity.test.ts` | PASS |

### 2.2 Two real financial-safety bugs found & fixed during B3 (do not reintroduce)

1. **Approval's own side effects invalidated its own basis.** `evaluateCasePolicy`'s plan-status update and `decideApproval`'s case transition were bumping `plan.version`/`case_version` — two of the 17 hashed decision-basis fields — as part of granting the authorization that basis represented, so a freshly-approved plan could never pass `execute`'s rebuild-and-compare. **Fix:** the `approval_required → approved → executing` case transition is deferred into `reserveAction`, chained atomically **after** the basis comparison succeeds; approve no longer bumps `plan.version`.
2. **Idempotent re-execute wasn't idempotent.** Rebuilding-and-comparing the basis *before* checking for an existing reservation meant a legitimate repeated/concurrent `execute` (same successful hash) could fail `APPROVAL_STALE` because the first call's own transitions had moved live state. **Fix:** in `reserveAction`, the existing-action lookup by (stable, content-derived) idempotency key happens **before** the freshness rebuild; a repeat returns the existing action, a genuinely new authorization still gets the full rebuild-and-compare.

### 2.3 Command gate (all green at B3 close)
typecheck · lint · format · **787 tests across 53 files** (unit + integration ×2, real Postgres) · build (server + web) · `smoke:api` · `smoke:worker` · e2e normal and `CI=1` · `npm audit --omit=dev` = **0**. Full `npm audit` = 4 **moderate dev-only** advisories from the pre-existing `drizzle-kit → @esbuild-kit → esbuild` chain (documented in ADR, not shipped — do **not** `npm audit fix --force`).

### 2.4 Known B3 gaps (implementation done; only test coverage thin — optional to close first)
- No HTTP-layer (Fastify `inject`) tests for the new route files — role/401/403/cross-tenant proven at the service layer + `smoke:api`, not request-level. **Recommended first task.**
- External-gateway timeout/retry path has code but no unit test with a mock failing gateway.
- Mid-`DISPATCHING` crash (between status transition and outcome-recording tx) handled by redelivery but not explicitly simulated; only post-completion redelivery tested.
- Cross-tenant coverage is per-flow, not exhaustively per repository function.

### 2.5 Verdict
**READY FOR GATE B4.** Every P0 financial-safety mechanism is implemented and verified end-to-end against a real database, including two adversarial bugs the tests caught. The gaps in §2.4 are test-thoroughness items, not open implementation risk.

---

## 3. YOUR TASK — implement Gate B4 (verification & demo)

Gate B4 = backend PRD **§13** (verification, reconciliation, agent claims/reversal), **§16** (500-record dataset + demo orchestration), the **§14.1/§14.2 endpoints not yet built**, and **§15** jobs. The relevant tables already exist in `db/migrations/0001_init.sql` (`verification_contracts`, `verification_runs`, `reconciliation_allocations`, `agent_result_claims`, `claim_evaluations`, `demo_scenario_state`, `demo_seed_manifest`) but have **no service logic yet**.

> Optional but recommended: first close the §2.4 B3 test gaps (start with HTTP-layer route tests via Fastify `inject`), since they harden the surface B4 builds on. Keep them small and green.

### 3.1 Routes to implement (declared in `src/contracts/registry.ts`, no handler yet)
- `POST /v1/imports` — deterministic dataset import (async/durable import id + item counts)
- `GET /v1/cases/:id/verification` — contract/run/evidence view; **ACK ≠ verified**
- `POST /v1/actions/:id/verification-checks` — idempotent recheck, no fabricated success
- `GET /v1/cases/:id/audit` — cursor audit replay, role-redacted
- `POST /v1/agent-results` + `GET /v1/agent-results/:id` — untrusted claim + retained-value evaluations
- `POST /v1/demo/reset` + `POST /v1/demo/scenarios/:id/advance` — environment- and role-gated

### 3.2 §14.2 frontend-readiness endpoints to ADD (contract + handler + OpenAPI + invalid-corpus tests)
- `GET /v1/overview` — computed synthetic KPIs, lifecycle distribution, opened/closed trend, top cases, opening claim-reversal summary, dataset timestamp
- `GET /v1/data-health` — source capabilities, received/duplicate/conflict/schema-failure counts, lag, unlinked/candidate/stale counts, model mode
- `GET /v1/demo/status` — current seed, scenario steps, readiness, fixed clock, manifest hash
- `GET /v1/cases/:id/audit/export` — redacted JSON bundle with content hash in body metadata **and** a safe response header; neutralize spreadsheet formula prefixes if CSV is ever added

Every added mutation body and response must be a registered named schema: runtime-validated, OpenAPI-visible, `.strict()`, bounded, and covered by invalid-corpus tests. Update the OpenAPI snapshot deliberately (`npx vitest run tests/unit/contracts/openapi.test.ts -u`) and review the diff. Honor the §14.2 status conventions exactly.

### 3.3 Worker topics to add (PRD §15, versioned payloads + tenant id, idempotent, poison-isolating)
`check-verification.v1`, `reconcile-expectation.v1`, `reevaluate-claim.v1`, `advance-demo-scenario.v1`. Only `dispatch-action.v1` has adapter capability; **replay must not publish any action topic** (extend/reuse the existing guard). Tests may drain jobs deterministically — no arbitrary sleeps.

### 3.4 Domain work (PRD §13, §7.4, architecture §9)
- **Verification contracts + runs**: required-evidence coverage complete; authority buckets (amount/currency/identity/time) pass; `SYNTHETIC_AGENT` never terminal authority; `settlement.processed` never bank proof; blockers/contradictions == 0; effect verification passes. Seed the immutable contracts under the keys the B3 approval basis already references (`TRANSFER_REMEDIATION_VERIFICATION` v1, etc. — see `src/modules/approvals/decision-basis.ts` `VERIFICATION_CONTRACT_BY_TOOL`).
- **Reconciliation**: strict **one-bank-line ↔ one-expectation** allocation; transaction locks both rows, checks tenant/currency/recipient/UTR/date/amount → exactly one match; unique constraints prevent reuse of either side; ambiguity → `RECONCILIATION_AMBIGUOUS`, exposure preserved.
- **ERP closure observed** (not merely requested) → only then verification `EFFECT_VERIFIED`, outcome `VERIFIED`, case `reconciled`. `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION` becomes dispatchable here (it is deliberately **policy-denied in B3** — flip that on only inside the reconciliation-gated path, never as a blanket allow).
- **Agent claims**: always `SYNTHETIC_AGENT/UNTRUSTED_CLAIM`; retained value `= max(0, eligible_recovery_captures − linked_refunds − linked_reversals − linked_disputes − independently_satisfied_baseline)`; the required opening claim gives `₹1,20,000 − ₹1,20,000 = ₹0` → `REVERSED`; evaluations append-only; a claim never changes source financial facts.
- **Reversal**: a later authoritative refund/reversal appends `EFFECT_REVERSED`/`REVERSED`, opens a **new case epoch**, and never erases the prior run/allocation.
- **Synthetic adapters** (`src/integrations/synthetic-*`): signed Route (transfer + processed), separate recipient-settlement source, signed synthetic **bank** (`BankCreditObserved` with amount/currency/recipient/UTR/value-date), synthetic **ERP** (accepts only a reconciled expectation id, emits observed receivable closure), recovery. Every record labelled `synthetic`; none presented as Razorpay or real bank movement. `settlement.processed` never becomes `BankCreditObserved`.
- Use the injected/fixed clock everywhere for determinism. Money stays `bigint`/decimal-string INR.

### 3.5 500-record dataset + demo orchestration (PRD §16)
Generate exactly **500** accepted synthetic lifecycle records, stable ids, fixed UTC times, no PII. The manifest is **computed from persisted records** (not narrative constants) and must assert: `records_total=500`, `records_matched=468`, `unresolved_cases=16`, `unsafe_candidate_matches_blocked=4`, `unresolved_exposure=128000000`, `verified_restored=45500000`, `duplicate_collection_prevented=50000000`, `reversed_recovery=12000000`. Named scenarios: `claim-reversal`, `missing-transfer-remediation`, `conflicting-bank-evidence`, `duplicate-replay`. Reset is idempotent (identical manifest hash); advance requires the caller's expected step (repeated same-step → current result, no duplicate effect; skipped/stale → `409`). Do not force metrics independently of evidence/state.

### 3.6 Acceptance — the four end-to-end scenarios (PRD §2, §19.4) against a real test PostgreSQL + running API/worker
1. **Recovery reversal**: agent claims ₹1,20,000, later full refund → claim `REVERSED`, verified incremental ₹0.
2. **Missing seller transfer**: ₹5,00,000 capture → ₹4,55,000 obligation; missing transfer opens one case; duplicate recovery blocked; approved simulated remediation verified only after bank evidence + unique allocation + observed ERP closure.
3. **Conflicting bank evidence**: equal amount, incompatible UTR/date/seller → unresolved; investigation abstains, policy requests more evidence, exposure stays open.
4. **Duplicate/replay safety**: repeated evidence and repeated execute create no duplicate case/effect/allocation/closure.
Assert one case/action/effect/allocation each, correct rupee values, conflict abstention, claim reversal, complete audit ordering, deterministic replay/reset.

### 3.7 Required B4 tests (add alongside implementation)
Authority coverage and settlement-not-bank proof; exact/ambiguous/contradictory reconciliation; concurrent one-to-one allocation (exactly one wins); observed ERP closure sequencing; claim full/partial/refund/reversal retained value; late reversal after closure reopens epoch; verification without all authoritative checks stays pending (never forced verified); cross-tenant negatives for verification/reconciliation/claims/audit; demo reset/advance idempotency + manifest determinism (seed/reset twice → identical manifest hash); the four E2E scenarios.

---

## 4. Definition of done for this session

Run the **full command gate** and keep it green:

```bash
npm run typecheck && npm run lint && npm run format
npm run test:unit
DATABASE_URL=... npm run test:integration      # run TWICE
DATABASE_URL=... npm run test                   # full suite
npm run build && npm run smoke:api && npm run smoke:worker
DATABASE_URL=... npm run test:e2e               # also with CI=1
npm audit --omit=dev                            # must stay 0
```

Then: process / port / disposable-database / `.env` / credential cleanup (stop & remove the test Postgres container, delete any `.env`, no stray Node processes or occupied ports 3000/5173/4700-4900).

**Stop after a detailed Gate B4 traceability report** (Requirement/section → files → tests → result; migration/seed results; API/OpenAPI route inventory + status matrix; the four scenario results with computed amounts/counts; security/tenant/secret-scan results; known limitations). State **`READY FOR GATE B5`** only if every B4 P0 requirement passes. Do **not** start B5 or frontend.

When done, commit and push to the same GitHub remote (`origin`, branch `main`) — one commit for the gate, message ending with the `Co-Authored-By:` trailer. Do not commit `.env`, `node_modules`, `dist`, or any secret.

---

## 5. Reference: current wired surface (so you know what NOT to rebuild)

**Routes with handlers:** `POST /v1/events`, `POST /v1/webhooks/razorpay`, `GET /v1/cases`, `GET /v1/cases/:id`, `GET /v1/cases/:id/{money-path,evidence,notes,control-loop}`, `POST /v1/cases/:id/{assign,notes,links/:linkId/decision,investigations,evaluate-policy,request-approval,approve,reject,request-more-evidence,execute}`, `GET /v1/approvals`.
**Worker topics live:** `project-evidence.v1`, `evaluate-controls.v1`, `run-investigation.v1`, `dispatch-action.v1`.
**Seed** (`scripts/db/seed.ts`): identity (tenants `ten_demo` + `ten_other`; users `user_viewer`/`user_investigator`/`user_approver`/`user_operator`) + source connections + `moneytrace_demo_v1` policy bundle.
**Money kernel** (`src/domain/money`) and **state machines** (`src/domain/state-machines`) are complete and pure — reuse, don't duplicate. Contract changes must update runtime schema + generated OpenAPI + invalid corpus + snapshots **together**.
