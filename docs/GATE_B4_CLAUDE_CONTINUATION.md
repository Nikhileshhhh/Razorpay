# MoneyTrace Gate B4 — Claude Continuation Handoff

## Purpose and authority

Continue from the **current working tree** and complete Gate B4. Do not restart the implementation, discard uncommitted work, or replace correct B3/B4 behavior. This handoff supplements, but does not weaken, the controlling documents.

Read in this order before editing:

1. `docs/CODEX_PROJECT_ROLE.md` completely.
2. Every controlling document it lists, in its required order.
3. `PROJECT_HANDOFF.md`.
4. `GATE_B4_PROMPT.md`.
5. `docs/GATE_B4_IMPLEMENTATION_PLAN.md` completely.
6. This continuation handoff.

If this file conflicts with a PRD, the role document, or the Gate B4 prompt, follow the controlling document. Preserve all security, tenant, monetary, append-only, atomicity, idempotency, and verification requirements. This is a fully functional prototype, not production infrastructure: do not add production HA, enterprise authentication, real-money capability, hosted services, or frontend work, but every promised demo function must actually work from persisted evidence and domain state.

## Scope and stopping boundary

- Current gate: **Gate B4 only**.
- Continue from the current dirty worktree at base commit `ebfbbcd`.
- Preserve all existing B3 remediation and B4 changes.
- Do not begin Gate B5 or frontend implementation.
- Do not commit, push, deploy, use hosted PostgreSQL, use paid APIs, or use real Razorpay/bank credentials.
- Do not rewrite applied historical migrations `0001` or `0002`. The uncommitted forward migrations `0003` and `0004` are current gate work and may be corrected before acceptance.
- Do not trust this progress report without inspecting the actual diff, schema, contracts, routes, tests, and database behavior.
- Do not state `READY FOR GATE B5` while any applicable P0 requirement, scenario, API contract, migration check, or command gate is incomplete.

## Working-tree caution

The repository contains broad line-ending-only modifications in tracked files plus substantive uncommitted B3/B4 work. Do not run destructive Git commands and do not discard or wholesale normalize the tree. Restrict edits to files needed for Gate B4. Preserve user work. There is no repository `.env` at this checkpoint.

## Verified checkpoint at handoff

Immediately before this file was written:

- `npm run typecheck`: **pass**.
- `npm run lint -- --quiet`: **pass**.
- Prettier check for the last edited audit writer: **pass**.
- Latest complete unit run: **44 files, 714 tests passed**.
- Built API and worker smoke tests passed earlier in this takeover.
- `npm run build` passed outside the restrictive filesystem sandbox.
- A fresh local PostgreSQL role/database run proved the existing integration suites can execute. After updating B3 fixtures for B4 verification contracts, the displayed existing suites were green; rerun the complete integration command and capture its final summary because the prior output was truncated before the aggregate line.

### Exact last red/green sequence

A new real-PostgreSQL scenario test exists at `tests/integration/db/b4-scenarios.test.ts`.

1. First run: claim reversal passed; remediation and duplicate replay exposed a worker identity foreign-key defect; conflict exposed an invalid demo UTR.
2. Fixed worker persistence so a trusted worker uses `actor_role='worker'` and `actor_id=NULL`, never a fabricated `users.id`; fixed the UTR to the canonical alphanumeric format.
3. Second run: claim reversal, missing-transfer remediation, and conflicting-bank scenarios passed. Duplicate replay reached the second reconciliation and failed because deterministic audit comparison used non-canonical `JSON.stringify` key order.
4. The audit writer was then changed to compare details with `canonicalJsonStringify`.
5. **The four-scenario test has not been rerun after that final one-line fix. Start there.**

Do not assume the audit fix is sufficient until the test passes.

## Implemented foundation to preserve and independently review

### B3 remediation already present

- Service-boundary identity/role checks and demo-auth environment fail-closed behavior.
- Transaction-aware case transitions with audit/history.
- Atomic approval and action reservation behavior, current-role rechecks, advisory locks, stable idempotency, and safe error handling.
- Forward migration `0003_b3_reliability.sql` with stable runtime constraint names.
- Investigation retry repair and route/error hardening.

### Gate B4 schema/contracts

- `docs/adr/0002-gate-b4.md` records Gate B4 decisions.
- `db/migrations/0004_b4_integrity.sql` adds/repairs reconciliation, closure, reversal, verification-head, claim-head, import, dataset, heartbeat, tenant-FK, audit-type, check, index, and append-only behavior.
- Drizzle schemas and `ALL_APP_TABLES` were extended.
- Verification and claim history use append-only rows plus mutable current-head tables.
- Stable names were added for B4 unique constraints. Verify exact catalog parity on a fresh migrated database.
- Contracts/OpenAPI include Gate B4 routes/read models, CLOSE plan binding, reconciliation state, agent claims, verification views, audit export, demo status, overview, Data Health, and readiness.
- `SellerReceivableOpened` and `SellerReceivableClosed` map to distinct evidence types.
- Four immutable verification contracts are seeded by normal seed/reset flows.

### Shared identity/audit/service work

- `src/modules/identity/application-actor.ts`: resolved-user/trusted-worker union; workers are branded and cannot arrive from HTTP input.
- `src/modules/identity/connector-principal.ts`: exact-byte HMAC-authenticated connector principal.
- `src/modules/audit/audit-writer.ts`: transaction-aware allowlisted writer with deterministic retry semantics.
- `src/modules/audit/audit-service.ts`: tenant/case-scoped audit listing and deterministic redacted export.
- `openOrGetCaseInTransaction`, `evaluateCasePolicyInTransaction`, and `reserveActionInTransaction` exist.
- Public wrappers still resolve current memberships; only internal reconciliation may pass the branded worker and reconciliation projection.
- CLOSE is structurally L3, zero INR, worker-only, and guarded again at reservation by locked allocation/closure/reversal/evidence facts.

### Verification/reconciliation/closure/reversal/claims

- `src/modules/verification/authority-evaluator.ts`: pure authority-bucket evaluator.
- `src/modules/verification/verification-service.ts`: pending run/head creation, append-only evaluation versions, contract evaluation, transfer/close/suppression checks, financial outcome updates, case verification view, and `check-verification.v1` enqueueing.
- ACK and unknown action outcomes create pending verification; failed actions do not.
- `src/modules/reconciliation/reconciliation-service.ts`: full exact candidate enumeration without `LIMIT 1`, advisory/row locks, zero/ambiguous/unique outcomes, one-to-one allocation, and atomic CLOSE plan/policy/action orchestration.
- Existing allocation replay was adjusted to locate its original terminal case rather than requiring a still-active epoch. Verify this with the duplicate scenario.
- `closure-service.ts`: signed synthetic ERP closure observation, append-only closure, verification evaluation.
- `reversal-service.ts`: authoritative refund reversal, append-only reversal/history, financial `REVERSED`, and new case epoch.
- `claim-service.ts`: connector-authenticated claim acceptance, key/body idempotency, retained-value evaluation, append-only history/head, refund reversal, and read model.
- The retained-value demo path has already passed on real PostgreSQL: ₹1.20 lakh `VERIFIED` before refund, then `REVERSED` with zero verified amount.

### Worker/adapters/jobs

- Synthetic ERP adapter exists and returns only an ACK; ACK is not closure proof.
- Registered B4 topics: `check-verification.v1`, `reconcile-expectation.v1`, `reevaluate-claim.v1`, and `advance-demo-scenario.v1`.
- Worker heartbeat updates every two seconds; readiness marks it stale after ten seconds.
- Replay protection blocks effect-capable action/reconciliation/scenario topics.
- Evidence/control jobs invoke closure, reversal, claim reevaluation, and reconciliation services as appropriate.
- `advance-demo-scenario.v1` now invokes `runDemoScenarioStep` instead of merely validating a step marker.

### APIs and prototype rate limits

- Gate B4 core routes: case verification, manual verification check, audit list/export, signed agent-result POST, agent-result GET.
- Demo/read routes: imports, overview, Data Health, demo status/reset/advance.
- `/ready` and `/openapi.json` exist.
- A small in-process fixed-window limiter now enforces real 429 behavior for advertised Gate B4 mutation endpoints while allowing normal retries. It is intentionally single-node prototype infrastructure.
- Rate limiter unit tests pass.

### Dataset and scenarios

- Reset creates exactly 500 dataset ledger/journal records, 16 unresolved cases at ₹80,000 each, four unsafe candidate records, seed manifest, scenario state, and audit in one transaction.
- Exact scenario IDs are now:
  - `claim-reversal`
  - `missing-transfer-remediation`
  - `conflicting-bank-evidence`
  - `duplicate-replay`
- `src/modules/demo/scenario-runner.ts` now performs real domain operations for each step:
  - signed/verified evidence acceptance and projection;
  - deterministic control evaluation;
  - investigation and policy;
  - approval with separation of duties;
  - idempotent reserve/dispatch;
  - settlement/bank reconciliation and worker-only CLOSE;
  - observed ERP closure;
  - agent claim evaluation and refund reversal;
  - deliberate duplicate evidence/action/reconciliation/closure replay.
- The deterministic investigation gateway now has a `CTRL-05` branch that returns `ABSTENTION/CONFLICTING_EVIDENCE` for incompatible authoritative bank records.

## Remaining P0 work

### 1. Reproduce and finish the four scenarios

Run the focused PostgreSQL test first:

```powershell
npx vitest run tests/integration/db/b4-scenarios.test.ts
```

Use a newly generated process-local PostgreSQL credential. Do not reuse any secret from another agent/session and never print it. On this machine PostgreSQL is in WSL Ubuntu and peer authentication requires the local OS `postgres` account; the successful administrative form used `wsl -d Ubuntu -u root -- runuser -u postgres -- ...`. Create a unique LOGIN role with CREATEDB, set `DATABASE_URL` only in the test process, then always drop any owned `moneytrace_test_*` databases and the role in `finally`.

If duplicate replay remains red, diagnose the actual persisted rows and fix the service idempotency—not the assertion. The required result is:

- one active/logical CTRL-01 case for the scenario;
- one transfer-remediation action and one reconciliation-generated CLOSE action;
- one simulated external reference per action;
- one reconciliation allocation;
- one receivable closure;
- no duplicate accepted ingest event for repeated exact bytes;
- terminal verified/reconciled state.

### 2. Replace narrative dataset/metrics with measured persisted state

This remains the largest known implementation gap.

Current `dataset.ts` inserts accepted-looking journal rows directly and stores several manifest values as constants. Current overview reads restored/prevented/reversed amounts from the stored manifest. This does not yet satisfy the PRD rule: **do not force metrics independently of evidence/state**.

Complete the implementation so:

- The registered 500-record dataset travels through a transaction-aware equivalent of normal acceptance/projection/control logic, or otherwise proves byte-equivalent acceptance/projection/control invariants inside the reset transaction.
- Exactly 500 `demo_dataset_records` link one-to-one to accepted, verified, non-quarantined `ingest_events`.
- `records_matched=468` is computed from persisted deterministic subject/path/link state, not ordinal narration alone.
- `unresolved_cases=16` and `unresolved_exposure=128000000` are computed from current persisted cases/outcomes.
- `unsafe_candidate_matches_blocked=4` is computed from persisted unsafe/conflict/reconciliation facts.
- `verified_restored=45500000` derives once per expectation from current verified transfer-remediation verification.
- `duplicate_collection_prevented=50000000` derives from a persisted verified suppression/control effect.
- `reversed_recovery=12000000` derives from claims whose current head is `REVERSED`.
- Before a relevant scenario step, overview metrics reflect the persisted current stage; after advance they change deterministically.
- Manifest generation queries persisted rows, uses stable ordering, and hashes only stable logical facts.
- Reset twice produces the same logical rows and manifest hash.

Do not solve this by weakening the PRD, hard-coding UI values, or inserting terminal result rows disconnected from source evidence.

### 3. Finish B4 database integration coverage

Add or complete real PostgreSQL tests for:

- Fresh `0001 -> 0004` migration and exact constraint/index/trigger catalog.
- Drizzle/head primary-key parity.
- Verification pending/verified/reversed history and current-head CAS behavior.
- Transfer verification remains pending without each independent required fact.
- Settlement evidence never satisfies the bank-authority bucket.
- Exact, zero-candidate, multi-candidate, and concurrent reconciliation.
- One bank line and one expectation cannot allocate twice under concurrency.
- No closure on adapter ACK; only correlated signed ERP closure completes it.
- Late authoritative reversal after closure reopens an epoch and preserves allocation/closure history.
- Claim full/partial/unresolved/reversed evaluation and concurrent same-key requests.
- Claim same key/same bytes returns replay; different bytes returns typed 409 with no second effect.
- Cross-tenant denial for verification, reconciliation, claims, audit, imports, and scenario access.
- Audit mutation atomicity and deterministic retry/conflict behavior.
- Reset/manifest determinism and scenario step replay/stale/skipped behavior.

### 4. Finish Fastify route matrices

Add Fastify `inject` coverage for every new B4 route:

- missing identity/signature;
- malformed body/path/query;
- forbidden role;
- valid role/principal;
- opaque cross-tenant ID;
- stale verification/scenario version;
- exact idempotent replay;
- body conflict;
- oversized claim/import where applicable;
- real 429 boundary;
- safe 503/unexpected-error envelope;
- persisted resource versions;
- runtime/OpenAPI method/path/status parity.

Review query coercion: Fastify supplies query-string values as strings, so numeric pagination/limits must parse valid HTTP query values without weakening bounds.

Document or register `/ready` and `/openapi.json` consistently with the intended OpenAPI inventory. Never expose database URLs, credentials, raw provider errors, or raw evidence.

### 5. Add backend E2E through API + worker

The current four-scenario integration test calls the scenario runner directly. Keep it, but also add the required backend E2E harness that uses:

- a fresh migrated disposable PostgreSQL database;
- real Fastify routes;
- real outbox dispatch and worker job handlers;
- only synthetic signed connectors;
- deterministic job draining without arbitrary sleeps;
- complete `finally` cleanup.

Exercise demo reset/advance over HTTP and assert persisted counts, amounts, audit ordering, case/action/allocation/closure uniqueness, conflict abstention, claim reversal, and replay/reset determinism.

Add a documented package command such as `test:e2e:backend` if required by the existing plan/PRD. Do not conflate the frontend Playwright smoke with backend scenario E2E.

### 6. Review known implementation risks

Inspect and resolve these rather than assuming they are harmless:

- `SellerReceivableClosed` processing should safely ignore an unrelated typed closure or quarantine it according to the contract; it must not poison the worker indefinitely.
- Scenario advancement commits state/outbox atomically, while effects are asynchronous. Ensure status/read models distinguish queued versus completed work or otherwise never claim completion before the durable worker effect succeeds.
- Worker tenant environment must be derived from persisted tenant/environment where security-relevant; do not blindly hard-code demo for arbitrary tenant payloads.
- Audit deterministic equality must be canonical and semantically exact after JSONB round-trip.
- Claim reevaluation should append a material version when evidence changes even if the high-level status remains the same but the verified amount/facts change.
- Reconciliation retry should return persisted closure state when already closed.
- Overview/Data Health lag, duplicate, unsigned, schema-failure, unlinked, candidate, and stale counts must be measured or explicitly represented as unsupported—never misleading constants.
- Imports must be allowlisted and idempotent; a partial prior import cannot masquerade as a valid completed import.
- `/ready` must remain safe when DB is down and accurate when the worker is stale.

## Required verification sequence

Run each command individually and record exact outcomes. Do not collapse failures into a generic statement.

```powershell
npm run typecheck
npm run lint
npm run format
npm run test:unit
npm run test:integration
npm run test:integration
npm test
npm run build
npm run smoke:api
npm run smoke:worker
npm run test:e2e:backend
npm run test:e2e
$env:CI='1'; npm run test:e2e; Remove-Item Env:CI
npm audit --omit=dev
npm audit
```

Install the matching Playwright Chromium binary locally if required. A missing browser is an environment blocker, not a test pass. A missing/invalid `DATABASE_URL` is an environment blocker, not an implementation pass. Never use hosted infrastructure to bypass local CREATEDB requirements.

## Cleanup and security checks

Before stopping:

- Drop every disposable database/role created for this work.
- Confirm no leaked `moneytrace_test_*` database owned by the temporary role.
- Confirm `.env` is absent/unpopulated.
- Confirm `.wslconfig` was not created or modified for this task.
- Stop test API/worker/Vite/Playwright/Vitest processes.
- Confirm documented ports and temporary 4700–4900 smoke ports are not left listening.
- Scan tracked/untracked source, logs, reports, OpenAPI, and fixtures for real credentials/private keys and test-only secret markers.
- Never print a connection string, password, HMAC secret, provider payload, or raw secret-bearing error.

## Required final Gate B4 handoff

Update `PROJECT_HANDOFF.md` with evidence, not claims:

```text
Requirement/PRD section -> implementation files -> tests -> observed result
Migration order -> exact constraint/index/trigger catalog evidence
API/OpenAPI route -> auth -> request/response -> success/error status matrix
Scenario -> persisted steps -> final amounts/statuses/counts
Exact command -> pass/fail -> file/test counts
Environment issue -> separate from implementation defect
Security/tenant/HMAC/credential/real-money statement
Known limitations and explicitly deferred production scope
READY FOR GATE B5: YES/NO
```

State `READY FOR GATE B5: YES` only if every applicable Gate B4 P0, route, job, dataset metric, scenario, migration assertion, and command gate is green. Otherwise state `NO`, list exact blockers, and stop. Do not proceed to Gate B5 or frontend work.
