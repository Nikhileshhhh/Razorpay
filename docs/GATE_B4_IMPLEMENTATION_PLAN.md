# MoneyTrace Gate B4 Implementation Plan

**Status:** Approved implementation guide for Claude; implementation has not started  
**Gate:** B4 only — verification, reconciliation, claims, audit, demo, and required read models  
**Starting point:** `main` at `ebfbbcd` plus the independently verified, intentionally uncommitted B3 remediation  
**Stop boundary:** Stop before Gate B5 and all frontend work  
**Repository actions:** Do not commit, push, deploy, call paid/external services, or use real credentials

## 1. Authority and operating rules

Before editing, read completely and in this order:

1. `docs/CODEX_PROJECT_ROLE.md`.
2. `MoneyTrace PRD.md`.
3. `docs/MONEYTRACE_BACKEND_PRD.md`.
4. `docs/MONEYTRACE_FRONTEND_PRD.md` only to preserve the backend handoff contract; do not begin frontend work.
5. `docs/MONEYTRACE_ARCHITECTURE_HANDOFF.md`.
6. `docs/CLAUDE_CODE_TASKS.md`.
7. `docs/CODEX_REVIEW_CHECKLIST.md`.
8. Every existing ADR in `docs/adr/`.
9. `PROJECT_HANDOFF.md`.
10. `GATE_B4_PROMPT.md`.
11. This file.

The latest explicit user instruction wins over a working prompt. On financial safety, tenant isolation, evidence integrity, credentials, irreversible effects, and audit consistency, the stricter controlling rule wins. Do not edit any controlling PRD, architecture, task-catalog, checklist, role, or prior ADR document to make implementation appear compliant. Record Gate B4 decisions in a new forward ADR.

Preserve the complete uncommitted B3 remediation. The broad working-tree modification list is mostly line-ending churn; inspect material changes with `git diff --ignore-space-at-eol` and never reset, discard, or rewrite unrelated work. Do not rewrite migrations `0001`, `0002`, or `0003`.

## 2. Verified checkpoint and baseline

The actual repository checkpoint is:

- Branch `main`, `HEAD ebfbbcd`.
- Gate B3 reliability remediation is present but uncommitted.
- Forward migrations `0001_init.sql`, `0002_b1_b2_integrity.sql`, and `0003_b3_reliability.sql` exist.
- Verification, reconciliation, agent-claim, audit-read/export, full demo, and synthetic B4 connector services are not implemented.
- B4 wire contracts and initial tables exist, but several existing schema choices require a forward B4 integrity migration before service code is safe.
- The independently verified B3 baseline is 695 unit tests, 136 integration tests on each of two fresh PostgreSQL runs, and 831 combined tests. Typecheck, lint, format, build, API/worker smokes, Playwright normal/CI, and production audit were green.
- In the current review environment, typecheck, lint, and format passed. The unit suite passed only when run outside the restrictive filesystem sandbox; the in-sandbox failure was an environment access error resolving `vitest.config.ts`, not an implementation failure.

Before B4 edits, reproduce individually:

```text
npm run typecheck
npm run lint
npm run format
npm run test:unit
npm run test:integration
```

Run integration only with a local disposable PostgreSQL and a process-scoped `DATABASE_URL`. Do not print the URL or its credential. If PostgreSQL is unavailable, report the environment blocker and continue only with work that does not depend on an unverified database assumption.

## 3. Permanent Gate B4 invariants

- No real money, real collection, real transfer, real refund, generic HTTP tool, arbitrary SQL tool, or generic ledger write.
- The worker remains the only process with adapter capability.
- Model or agent output is never authority for money, identity, links, policy, approval, verification, reconciliation, closure, or state.
- All authoritative money is `bigint`/PostgreSQL `BIGINT`; APIs use canonical decimal strings and explicit `INR`.
- HMAC is verified over the exact upstream raw bytes before parsing or mapping.
- The canonical `payload_hash` is the SHA-256 of those exact accepted source bytes; it is not a self-referential hash of a canonical envelope containing its own hash.
- `SettlementProcessed` is acknowledgement/settlement evidence, never independent bank-credit proof.
- `SYNTHETIC_AGENT` is always `UNTRUSTED_CLAIM` and never satisfies a terminal authority bucket.
- A candidate or human-confirmed relationship is not terminal financial authority.
- One bank line can allocate to one expectation, and one expectation can consume one bank line.
- Candidate selection must prove exact cardinality; choosing the first matching row is forbidden.
- Action acknowledgement and `OUTCOME_UNKNOWN` may start observation, but neither is verification.
- `VERIFIED` requires contract-complete evidence, exact reconciliation, observed ERP closure where required, and zero blockers.
- Reversal is append-only: retain the original action, verification, allocation, and closure; append reversal artifacts and open a new case epoch.
- Every B4 query, join, FK, lock, job, dedupe key, cursor, audit operation, and export is tenant-scoped.
- Every required domain mutation and its audit row commit in the same transaction. If audit fails, the mutation fails.
- Replay may rebuild derived state but may not reserve or dispatch an action or publish a job that can eventually cause an adapter effect.
- Metrics are derived from persisted rows. Narrative constants may be test expectations only, never response values.

## 4. Binding Gate B4 decisions to record in ADR 0002

Create `docs/adr/0002-gate-b4.md` before implementation and record the following decisions and rejected alternatives.

### D1 — Claim reversal follows the existing state machine

Do not add `PENDING -> REVERSED`. The opening claim progresses:

```text
PENDING
-> VERIFIED with retained amount 12000000 before refund
-> REVERSED with retained amount 0 after the authoritative full refund
```

Both evaluations remain append-only. This resolves the product shorthand “₹1.2 lakh minus ₹1.2 lakh equals REVERSED” without weakening architecture §9.2.

### D2 — Evaluation history uses append-only rows plus explicit current pointers

The existing `claim_evaluations.is_current` partial unique index conflicts with the append-only trigger. Do not update an old evaluation to make a new evaluation current. Add explicit mutable head tables for claim evaluations and verification runs; history rows remain append-only.

### D3 — Allocation, closure, and reversal are separate append-only facts

Never update `reconciliation_allocations.closed_receivable_id` or `status`. Add append-only `receivable_closures` and `reconciliation_reversals` records. Read models derive current logical state by joining allocation, closure, and reversal facts. This preserves historical reconciliation after a reversal.

### D4 — Reconciliation proves candidate-set cardinality

An allocation is legal only when the complete eligible set contains exactly one expectation and exactly one unconsumed authoritative bank line after exact tenant, currency, recipient, amount, UTR, and value-date-window predicates. The transaction locks the expectation and the full eligible candidate set. It never uses `LIMIT 1` as a business decision.

A uniqueness race is classified as follows:

- The identical allocation identity returns the existing allocation idempotently.
- A different expectation or bank-line contender returns `RECONCILIATION_AMBIGUOUS`, appends an unresolved audit fact, and creates no second effect.
- Raw PostgreSQL constraint details never escape the service or logs.

### D5 — Receivable closure is a registered automatic action with layered authorization

Add a `CLOSE_RECEIVABLE_AFTER_RECONCILIATION` plan bound only to `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION`. It has `L3`, zero money impact, and a typed `expectation_id` parameter.

Closure is permitted only when all layers agree:

1. A registered typed plan exists.
2. Deterministic policy receives a persisted reconciliation projection and returns `ALLOW_AUTOMATIC` for a trusted worker actor.
3. Reservation re-locks and revalidates the exact allocation, authoritative bank evidence, absence of reconciliation reversal, and absence of an existing closure.
4. The worker-only ERP adapter accepts only the reconciled expectation and close action.
5. Adapter ACK records only a request. A signed `SellerReceivableClosed` event correlated to the close action is required for observed closure.

The generic public policy endpoint cannot manufacture the reconciliation projection and therefore continues to deny CLOSE.

### D6 — Cross-module orchestration joins one caller-owned transaction

Do not call public wrappers that each open independent transactions from the reconciliation or reversal flow. Add narrowly scoped transaction-aware variants while preserving public wrappers:

- `openOrGetCaseInTransaction`.
- `evaluateCasePolicyInTransaction` with either a server-resolved user actor or branded trusted worker actor.
- `reserveActionInTransaction` with the same actor distinction and CLOSE-specific hard gate.
- Any verification/outcome/current-pointer helpers required by the caller transaction.

Continue to reuse `proposePlanInTransaction`, `lockControlLoopCase`, and `transitionCaseInTransaction`. No B4 module writes another module’s tables directly when a public application service owns that state.

### D7 — Verification predicates and financial metrics are contract-specific

Do not make “observed ERP closure” a universal predicate for every verification contract.

- Transfer remediation requires transfer, recipient settlement, independent bank evidence, unique allocation, and observed ERP closure. Its verified amount is `45500000` for the main scenario.
- Receivable closure requires the correlated ERP closure observation after a still-valid allocation. Its verified amount is `0`; closure is a state effect, not additional restored money.
- Recovery suppression requires observed signed recovery-suppression evidence. Its verified amount is used only by the prevented-loss metric.
- `REQUEST_MORE_EVIDENCE` has a no-effect contract and no adapter dispatch.

`verified_restored` sums only current verified transfer-remediation outcomes, grouped once per expectation. It must not double-count the CLOSE verification run.

### D8 — Unknown action outcomes remain observable, not retryable

Both `ACKNOWLEDGED` and `OUTCOME_UNKNOWN` may create a pending verification run and status-check job. `OUTCOME_UNKNOWN` remains explicitly unknown until independent authoritative evidence proves or disproves the effect or the contract times out. No new idempotency key or blind adapter retry is allowed.

### D9 — “500 records” means an auditable imported dataset, not 500 subjects

Do not redefine the backend PRD’s “exactly 500 accepted synthetic lifecycle records” as 500 economic subjects. Add an append-only dataset-item ledger that links exactly 500 imported source records to their accepted `ingest_events` rows. Live scenario-step evidence may be additional operational evidence but is not a dataset item.

The dataset manifest counts the 500 ledger items and verifies that every item has exactly one accepted, non-quarantined journal row. `records_matched` counts dataset items whose persisted subject/path meets the registered match predicate. Subject count is a separate diagnostic and is never substituted for record count.

Hidden expected labels stay under `fixtures/hidden-ground-truth` and may be imported only by tests. Runtime dataset rows contain stable identifiers and provenance, not ground-truth labels.

## 5. Phase 1 — Contracts and forward migration

Complete this phase before adding service behavior.

### 5.1 Contract changes

Update authoritative runtime schemas, barrels, registry components, generated OpenAPI, invalid corpus, compile-time assertions, and snapshots together.

Required changes:

- Add `CLOSE_RECEIVABLE_AFTER_RECONCILIATION` to `PlanTemplateId`, `PLAN_TEMPLATE_TOOL_MAP`, and the `Plan` discriminated union. Bind it only to `CloseReceivableParams`.
- Add a typed `reconciliation_state` object to `PolicyInputProjection`, not a lone authorization boolean. It must contain allocation identity, expectation identity, status, closure status, reversal status, and resource version, or be explicitly `null`.
- Extend settlement event data so a terminal `SettlementObserved` can preserve optional typed `utr` and `value_date`. Terminal verification requires both for the main transfer contract; `SettlementProcessed` remains insufficient even if it carries similar text.
- Expand audit artifact types only where needed for unambiguous replay: agent claim/evaluation, closure, reversal, import, and demo command. Do not place raw details in browser-safe audit contracts.
- Replace the unsafe import body with an allowlisted deterministic seed request. The server computes source, item count, accepted count, duplicate count, and manifest hash; it never trusts a client-provided item count, tenant, file path, or URL.
- Add strict bounded schemas for overview, data health, rich demo status, readiness, audit export, dataset manifest, closure/reversal summaries, and all B4 mutation data.
- Add `check_status` and verification/reconciliation-aware commands to `ControlLoopCommand` only when a real service path exists.
- Add explicit idempotent-duplicate success representation for agent claims.
- Keep all money as decimal strings and all resource versions sourced from persisted rows.

### 5.2 Migration `db/migrations/0004_b4_integrity.sql`

The migration must be forward-only, safe on a fresh `0001 -> 0004` database, and safe when rerun by the project migration runner. Use catalog inspection by column signature where a generated constraint name is unknown.

Required database work:

1. Rename, rather than drop/recreate, the two existing reconciliation unique constraints to:
   - `reconciliation_allocations_bank_line_uq`.
   - `reconciliation_allocations_expectation_uq`.
2. Do not re-add B4 tenant FKs already present in `0002`. Introspect and add only genuinely missing constraints.
3. Add a tenant-scoped unique target `(tenant_id, id)` wherever a new composite FK needs it.
4. Add append-only `receivable_closures` with unique tenant-scoped allocation, expectation, close action, and closure evidence relationships.
5. Add append-only `reconciliation_reversals` with a unique current reversal per allocation and authoritative reversal evidence.
6. Add `claim_evaluation_heads` and `verification_run_heads`, backfill by highest version when data exists, then remove contradictory partial-current indexes and deprecated `is_current` columns. Add append-only triggers to both history tables.
7. Add `request_hash` to `agent_result_claims`; exact claim key plus same hash is idempotent, same key plus different hash is a typed conflict.
8. Add tenant-scoped append-only `data_imports` and `demo_dataset_records`. Dataset records have stable `(tenant_id, seed_id, ordinal)` and a unique link to an accepted ingest event.
9. Add a worker-heartbeat table or equivalent persisted readiness record. It contains no connection string or secret.
10. Add missing nonnegative/version/check constraints to scenario state and new optimistic aggregates.
11. Add append-only enforcement and exact FKs for every history/closure/reversal/dataset table.
12. Add indexes for current-head lookup, verification by action, reconciliation candidate lookup, audit cursor, scenario state, and dataset manifest queries.

Update Drizzle schemas and `src/config/db-schema.ts` exports in the same phase. Add all new reset-owned tables to `ALL_APP_TABLES` in dependency-safe order.

### 5.3 Migration tests

- Apply `0001`, `0002`, `0003`, and `0004` to a fresh real PostgreSQL database.
- Run the migration command twice and prove no second change/error.
- Assert exact catalog names for all runtime-classified unique constraints.
- Perform real cross-tenant negative inserts for every new composite FK.
- Prove append-only tables reject update and delete.
- Prove claim and verification history accept multiple versions while their head points to one version.
- Prove one bank line, expectation, closure evidence, and closure action cannot be consumed twice.
- Prove reversal does not mutate or delete the allocation/closure.

## 6. Phase 2 — Shared transaction, actor, and audit foundations

Implement the shared primitives needed by later phases before orchestration.

### 6.1 Trusted principals

- Preserve `MONEYTRACE_WORKER_ACTOR` as a branded in-process identity that cannot come from a job payload or HTTP body.
- Add a branded authenticated connector principal returned only after source-account lookup and exact-byte HMAC validation.
- Public user services continue to accept an actor ID only and re-resolve current tenant membership/roles inside the mutation transaction.
- Agent claim POST uses connector authentication, not a free-form demo user with a claimed `connector` role.
- Body `tenant_id` is treated as an assertion and must equal the authenticated source tenant; it never establishes tenant scope.

### 6.2 Transaction-aware application services

Refactor without duplicating business logic:

- Public `evaluateCasePolicy` wraps `evaluateCasePolicyInTransaction` and server-derived user authorization.
- Public `reserveAction` wraps `reserveActionInTransaction` and user authorization.
- Reconciliation uses the internal variants with the branded worker actor.
- Add `openOrGetCaseInTransaction`; the current public wrapper retains its transaction.
- Preserve B3’s advisory locks, row locks, current-basis rebuild, idempotency ordering, and case transition behavior.
- Add CLOSE-specific reservation checks after idempotent-existing-action lookup but before action/audit/outbox insertion.

### 6.3 Audit writer and read boundary

Create one transaction-aware audit append helper supporting deterministic audit IDs for retry-repair flows. It accepts only allowlisted safe detail shapes per artifact type. It never accepts arbitrary raw payloads, headers, provider errors, URLs, or credentials.

Audit read/export rules:

- Cursor is based on tenant audit sequence, not client timestamp sorting.
- A viewer receives a safe artifact summary and references.
- An auditor may receive additional allowlisted metadata but no raw evidence or secret-bearing fields.
- Cross-tenant opaque IDs are indistinguishable from not found.
- JSON export is built by the server from persisted audit rows; the client cannot author it.
- Compute the content hash over canonical export content without its hash field, then place the same value in body metadata and `x-moneytrace-content-sha256`.

## 7. Phase 3 — Immutable verification contracts and evaluator

### 7.1 Seed contracts

Add `src/modules/verification/verification-contracts-seed.ts` and idempotently seed the four exact keys already used by `VERIFICATION_CONTRACT_BY_TOOL`:

- `TRANSFER_REMEDIATION_VERIFICATION` v1.
- `SUPPRESS_RECOVERY_VERIFICATION` v1.
- `NO_EFFECT_VERIFICATION` v1.
- `RECEIVABLE_CLOSURE_VERIFICATION` v1.

Validate every JSON definition through `VerificationContract` before insertion. Seed through `scripts/db/seed.ts` and full demo reset. Contract rows are immutable; same key/version with different content is a seed failure, not an update.

### 7.2 Pure authority evaluator

Create a pure evaluator that receives a registered contract, fixed clock, action/expectation projection, and typed evidence facts. It returns a typed pending/verified/failed/timed-out/reversed decision with explicit blockers.

It must prove:

- Every required evidence type exists.
- Every evidence ID exists in the same tenant and is accepted/non-quarantined.
- Amount, currency, identity, and time checks each satisfy their own registered authority bucket.
- Recipient settlement scope is `RECIPIENT`.
- Bank evidence comes from signed `SYNTHETIC_BANK` and supplies amount, INR, recipient, UTR, and value date.
- Settlement and bank UTR/value date agree exactly within the registered date window.
- `SYNTHETIC_AGENT`, MoneyTrace control artifacts, adapter ACKs, and candidate links do not satisfy terminal source authority.
- Blocking refund/dispute/reversal/conflict evidence prevents verification.
- Optional evidence never compensates for missing required authority.

### 7.3 Verification service

Implement:

- Create/reuse initial `VERIFICATION_PENDING` after an effect-bearing action becomes `ACKNOWLEDGED` or `OUTCOME_UNKNOWN`.
- Append a new version for every material re-evaluation and atomically move the current head.
- Idempotency by a canonical evaluation key containing tenant, action, contract key/version, prior head version, evidence-set hash, and evaluation clock.
- Optimistic expected-version check for manual verification requests.
- Contract-specific terminal predicates from D7.
- Pending timeout based only on injected clock and contract window.
- Reversal evaluation after an earlier verified run.

The dispatch transaction must atomically write action attempt/status, action audit, initial verification row/head, and `check-verification.v1` outbox record. A failed adapter creates no false pending verification. Repeated dispatch or job delivery creates one head/version for the same evaluation key.

## 8. Phase 4 — Exact reconciliation and observed ERP closure

### 8.1 Reconciliation candidate query

Build a deterministic repository query that enumerates all eligible bank lines and relevant expectations. Required predicates are tenant, current expectation version, INR, exact amount, exact recipient, exact UTR, accepted/signature-verified evidence, non-quarantined state, and registered value-date window.

Inside one transaction:

1. Acquire a stable tenant+expectation advisory lock.
2. Lock the case, expectation, current outcome, existing allocation/reversal/closure rows, and eligible bank candidates.
3. Recompute the complete candidate set after locks.
4. Require cardinality exactly one on both sides.
5. Recheck that neither side has been consumed.
6. Insert the immutable allocation and audit row.
7. On exact idempotent repeat, return the existing allocation.
8. On ambiguity or a different concurrent contender, append unresolved audit state, leave exposure open, and return the safe typed conflict.

Do not use amount-only, name-fuzzy, first-row, ingestion-order, or random-ID tie breaking.

### 8.2 Closure orchestration

After allocation, in one caller-owned transaction:

- Create/reuse the registered CLOSE plan using `proposePlanInTransaction`.
- Evaluate and persist policy using the exact persisted reconciliation projection.
- Reserve the automatic CLOSE action using `reserveActionInTransaction` and its hard gate.
- Commit plan/policy/action/audit/outbox consistently.

The worker ERP adapter returns only ACK/FAILED/UNKNOWN and a deterministic external reference. It cannot accept arbitrary receivable or ledger parameters. The signed ERP event must set `causation_id` to the close action and map back through the plan’s expectation ID.

When closure evidence arrives, one transaction:

- Locks the close action, allocation, expectation, closure/reversal records, transfer verification head, close verification head, financial outcome, and case.
- Revalidates the allocation and absence of reversal.
- Inserts the immutable closure record and audit.
- Appends terminal verification version(s): transfer amount `45500000` for the main scenario, close amount `0`.
- Appends a new current financial-outcome version `VERIFIED` using `assertFinancialOutcomeTransition`.
- Moves `executing -> verification_pending -> reconciled` through guarded case transitions as applicable, with exact history and no swallowed transition.

No state becomes verified or reconciled on ERP adapter ACK alone.

### 8.3 Reversal

On authoritative refund/reversal/dispute after closure:

- Validate source, tenant, correlation, amount/currency, event time, and affected expectation.
- Insert `reconciliation_reversals`; do not update allocation or closure.
- Append `EFFECT_REVERSED` verification and `REVERSED` financial outcome versions.
- Mark the prior case epoch historical and open a new epoch atomically through `openOrGetCaseInTransaction`, including `reopened_from` relationship and audit.
- Recompute overview/manifest values from current state while keeping historical audit visible.

## 9. Phase 5 — Agent claims and retained value

### 9.1 Claim acceptance

`POST /v1/agent-results` is an authenticated synthetic connector endpoint:

- Verify HMAC over exact bytes before parsing.
- Resolve source account to tenant and require `SYNTHETIC_AGENT` capability.
- Parse the strict claim schema, compare asserted tenant, and reject cross-tenant evidence references opaquely.
- Validate each evidence reference exists, is accepted, is within the claim’s allowed observation/correlation boundary, and belongs to the same economic subject.
- Compute a canonical request hash over the validated claim.
- Same external agent/claim key plus same hash returns the existing claim without a second evaluation/effect.
- Same key plus different hash returns `409 IDEMPOTENCY_BODY_CONFLICT`.
- Insert claim, initial `PENDING` evaluation/head, audit, and `reevaluate-claim.v1` outbox atomically.

### 9.2 Deterministic evaluation

Use `computeRetainedValue` without copying its arithmetic. Repository queries deterministically sum eligible captures, linked refunds, linked reversals, linked disputes, and independently satisfied baseline using `bigint` and explicit INR.

Map retained result to state only through `assertAgentClaimTransition`:

- Complete retained amount equals claim: `VERIFIED`.
- Positive retained amount below claim: `PARTIALLY_VERIFIED`.
- Missing/conflicting authority: `UNRESOLVED` or `REJECTED` according to registered reason.
- A later full refund from VERIFIED/PARTIALLY_VERIFIED: `REVERSED` with zero.

Every re-evaluation appends one version, updates only the head row, audits in the same transaction, and never changes source financial facts.

## 10. Phase 6 — Signed synthetic connectors and jobs

### 10.1 Exact-byte connector boundary

Create a shared synthetic source submission helper with two distinct representations:

1. A strict upstream synthetic-source payload that does not contain a self-referential payload hash.
2. A canonical event produced only after exact-byte HMAC verification and parsing/mapping.

Sequence:

```text
build strict upstream payload
-> canonical serialize once to exact Buffer
-> HMAC-SHA256 that Buffer
-> authenticate source account and verify HMAC on the same Buffer
-> parse/map to CanonicalEvent
-> set canonical payload_hash = rawBytesHash(upstream Buffer)
-> accept evidence with rawRepresentation=exact_bytes
```

Use an injected test-only secret in tests and the validated server-side environment secret at runtime. Never hard-code or log it.

Implement explicitly synthetic Route, recipient settlement, bank, ERP, recovery, and agent connectors. Every canonical record uses `metadata.environment='synthetic'`, its correct `SYNTHETIC_*` source, fixed UTC times, stable source event IDs, and no PII.

### 10.2 Jobs

Add strict versioned payload schemas and handlers for:

- `check-verification.v1`.
- `reconcile-expectation.v1`.
- `reevaluate-claim.v1`.
- `advance-demo-scenario.v1`.

Payloads carry tenant ID, stable aggregate ID, expected version/evaluation key, and `replay`. They never carry roles, secrets, raw evidence, or adapter instructions. Handlers derive a tenant context, use the branded worker actor, and call idempotent services.

Only `dispatch-action.v1` imports the adapter registry. Extend replay protection so replay cannot publish `dispatch-action.v1` or any B4 job whose normal handling could reserve a close action. A replay-mode verification/reconciliation service may compute a shadow result but must have a hard `effectsAllowed=false` guard.

Poison jobs fail safely with bounded pg-boss retries and safe retry-class metadata. Tests call handlers/services deterministically without arbitrary sleeps.

## 11. Phase 7 — API, OpenAPI, readiness, and read models

### 11.1 Route implementation

Register real handlers for:

- `POST /v1/imports`.
- `GET /v1/cases/:id/verification`.
- `POST /v1/actions/:id/verification-checks`.
- `GET /v1/cases/:id/audit`.
- `POST /v1/agent-results`.
- `GET /v1/agent-results/:id`.
- `POST /v1/demo/reset`.
- `POST /v1/demo/scenarios/:id/advance`.
- `GET /v1/overview`.
- `GET /v1/data-health`.
- `GET /v1/demo/status`.
- `GET /v1/cases/:id/audit/export`.
- `GET /openapi.json`.
- `GET /ready` while retaining `/health` as DB-free liveness.

Each route follows the existing parse/service/envelope/problem pattern. Every user route requires demo identity and role at HTTP and service boundaries. Connector routes use source authentication. Demo/import/advance services recheck environment and current roles themselves.

### 11.2 Binding success/error matrix

| Route family                     |                       Success | Required safe errors                   |
| -------------------------------- | ----------------------------: | -------------------------------------- |
| `/health`                        |                           200 | none; DB-free liveness                 |
| `/ready`                         |                    200 or 503 | safe database/worker readiness only    |
| `/openapi.json`                  |                           200 | 401, 403, 503                          |
| `POST /v1/imports`               |                           202 | 400, 401, 403, 409, 413, 422, 429, 503 |
| Case verification GET            |                           200 | 400, 401, 403, 404, 503                |
| Verification check POST          |                           200 | 400, 401, 403, 404, 409, 422, 429, 503 |
| Case audit GET/export            |                           200 | 400, 401, 403, 404, 503                |
| Agent claim POST                 | 201 new / 200 exact duplicate | 400, 401, 403, 409, 413, 422, 429, 503 |
| Agent claim GET                  |                           200 | 400, 401, 403, 404, 503                |
| Demo reset/advance               |                           200 | 400, 401, 403, 409, 422, 429, 503      |
| Overview/Data Health/demo status |                           200 | 400, 401, 403, 503                     |

Runtime and OpenAPI must advertise the same methods, paths, statuses, request bodies, response schemas, and content types. Add 401/503 to older placeholder B4 specs; missing identity is never omitted merely because a route was originally a placeholder.

Serve `buildOpenApiDocument()` directly at runtime and test deep equality with the generated document. Do not introduce a weaker hand-written OpenAPI document.

### 11.3 Read models

- Overview derives all KPIs, distributions, trend, top cases, claim-reversal summary, seed/version, and dataset time from persisted rows.
- `verified_restored` is grouped once per expectation and restricted to transfer-remediation verification.
- `duplicate_collection_prevented` derives from verified suppression/control state, not a hard-coded ₹5 lakh.
- Data Health reports source capability, signed/unsigned counts, accepted/duplicate/conflict/schema failure counts, projector/job lag, pending verification, candidates/unlinked/stale projections, model mode, DB state, and worker heartbeat. Optional external provider/Razorpay absence is a warning, not failed synthetic readiness.
- Demo status reports all named scenario steps, fixed clock, state version, manifest hash, and readiness.
- Verification view includes ACK/unknown status separately from contract evaluation, blockers, allocation, closure, and reversal history.
- Control-loop view adds verification and reconciliation summaries only from real rows.

### 11.4 Limits and startup

- Set a global bounded body limit and retain the stricter evidence raw-body parser limit.
- Implement a small injected-clock rate limiter with global/IP protection and a post-auth tenant/source key. Webhook/source limits must allow legitimate idempotent retries. Return `429 RATE_LIMITED`; never log bodies or auth headers.
- Persist a worker heartbeat and have `/ready` fail safely when DB is unavailable or the heartbeat is stale. Return no URL, host credential, queue payload, or raw error.
- Add a cross-platform one-command demo start script that starts built API and worker, forwards shutdown, and uses safe diagnostics. Do not add a new process manager dependency.

## 12. Phase 8 — Deterministic 500-record dataset and demo orchestration

### 12.1 Dataset ledger and generator

Create a versioned dataset specification under `fixtures/synthetic` and a generator under `src/modules/demo` or `scripts/db` that produces exactly 500 dataset records with:

- Stable seed ID and ordinal 1–500.
- Stable source event IDs and economic-subject keys.
- Fixed UTC event/ingestion times through an injected clock.
- Only synthetic identifiers; no PII.
- Exact raw bytes and valid HMAC through the normal source-auth/ingestion boundary.
- One `demo_dataset_records` row linked to each accepted non-quarantined ingest event.
- Duplicate deliveries represented as delivery attempts/audit, not extra accepted dataset records.
- Competing false candidates preserved as candidates.

Do not start from the revised draft’s “467 clean subjects + 33 other subjects” table. First write persisted-query manifest tests, then choose an event/subject distribution whose real results satisfy them. A subject may have several records; record and subject counts remain distinct.

### 12.2 Manifest formulas

Compute and persist, never narratively assign:

- `records_total`: count dataset-ledger rows with one accepted non-quarantined ingest event = `500`.
- `records_matched`: count dataset-ledger rows whose linked subject satisfies the registered matched predicate = `468`.
- `unresolved_cases`: active nonterminal case epochs = `16`.
- `unsafe_candidate_matches_blocked`: unresolved/unconfirmed candidate links in the dataset = `4`.
- `unresolved_exposure`: sum active unresolved case exposure = `128000000` INR minor units.
- `verified_restored`: one current verified transfer-remediation amount per expectation = `45500000`.
- `duplicate_collection_prevented`: verified persisted suppression/control amount = `50000000`.
- `reversed_recovery`: claim amount whose current claim head is REVERSED = `12000000`.

The manifest hash is a canonical hash of stable source IDs, payload hashes, dataset ordinals, registered versions, scenario versions, and computed metrics. Exclude random database surrogate IDs, audit sequence values, wall-clock timestamps, and row-return order.

### 12.3 Reset

Reset is allowed only in demo/buildathon, by current `demo_operator`, against the explicitly configured disposable demo database.

Refactor acceptance/projection/control helpers into caller-transaction variants where necessary so truncate, identity/source/policy/contract seed, 500-record import, dataset ledger, scenario state, manifest, and reset audit either all commit or all roll back. Do not claim atomic reset if data seeding happens in independent transactions.

Running reset twice produces the same logical rows and manifest hash. It does not leak a populated `.env` or leave background jobs from the previous seed.

### 12.4 Scenario advance

Named scenarios:

- `claim-reversal`.
- `missing-transfer-remediation`.
- `conflicting-bank-evidence`.
- `duplicate-replay`.

Every scenario has a closed, versioned step registry. Advance locks scenario state and uses expected step/version.

- Repeating the immediately completed command returns the current result with no second evidence/domain effect.
- Skipping a step or sending a stale different command returns `409 VERSION_CONFLICT`.
- The state update, accepted scenario evidence or durable job command, audit, and resource version commit atomically.
- Advancing cannot accept an unregistered scenario/event/action.

The missing-transfer scenario must visibly pass through approval, one action, transfer, settlement, bank evidence, one allocation, ERP close request, observed closure, verified outcome, and reconciled case. The conflict scenario must retain exposure. Duplicate replay must prove one case/action/effect/allocation/closure. Claim reversal must show VERIFIED before refund and REVERSED/zero after refund.

## 13. Phase 9 — Test plan

Add tests alongside each phase. Do not postpone safety tests until the end.

### 13.1 Unit and contract tests

- All contract variants, strict bounds, invalid corpus, barrel exports, and OpenAPI snapshots.
- CLOSE plan/tool binding and default-deny policy matrix.
- Contract-specific authority coverage; settlement-not-bank; agent-not-authority.
- Missing/wrong amount, currency, recipient, UTR, value date, scope, signature, and blocker.
- Reconciliation zero/one/multiple candidate cardinality and deterministic idempotency classification.
- Claim full, partial, baseline, refund, dispute, missing authority, VERIFIED-to-REVERSED.
- Verification pending, verified, timeout, failed, reversed, expected-version conflict.
- Exact-byte HMAC success and tamper rejection.
- Dataset manifest canonical ordering and exclusion of random IDs.
- Replay denial for every effect-capable path.
- Exhaustive audit redaction and export hashing.
- Rate-limit windows and readiness heartbeat staleness using an injected clock.

### 13.2 Real PostgreSQL integration tests

- Fresh migration and exact catalog evidence.
- Append-only current-head behavior for claims/verifications.
- Concurrent first reconciliation with no allocation: exactly one allocation.
- Same bank/two expectations and same expectation/two bank lines: ambiguity, no arbitrary winner.
- Same reconciliation request twice: one allocation/audit/close action.
- Closure reservation after allocation reversal: denied, no action/outbox.
- ERP ACK without closure event: pending.
- Closure event with wrong action/expectation/tenant: ignored or safe error, never verified.
- Atomic allocation/plan/policy/action/audit/outbox rollback under injected failure.
- Late refund after closure: immutable prior history, reversed current heads, new case epoch.
- Agent claim same key/same body and same key/different body under concurrency.
- Cross-tenant negative tests for verification, reconciliation, claims/evidence refs, audit/export, imports, dataset records, demo commands, and jobs.
- Worker redelivery, poison retry bounds, post-ACK crash repair, and unknown outcome observation without a new key.
- Reset twice and advance repeats with exact manifest/state/resource versions.
- Safe unexpected DB error with test-only secret markers absent from response and captured logs.

### 13.3 Fastify inject contract matrix

For every B4 route test:

- Missing identity/source auth.
- Forbidden role/capability.
- Valid role/source.
- Malformed params/query/body, unknown keys, bounds, and oversized body.
- Stale resource version/evaluation key.
- Cross-tenant opaque resource ID.
- Every documented success/error status and standard envelope.
- Runtime response parsing by the same authoritative schema used by OpenAPI.
- No raw evidence, secret marker, provider detail, DB detail, or tenant existence leak.

### 13.4 Backend E2E

Add `tests/e2e-backend` and `npm run test:e2e:backend`. It must use a fresh real PostgreSQL database, real Fastify server, real outbox/job handlers, and synthetic signed adapters without network/paid services.

Automate the four PRD scenarios over HTTP plus worker processing and assert:

- Required rupee values and statuses.
- One case/action/simulated external reference/allocation/closure.
- No closure before bank match or ERP observation.
- Conflict abstention and persistent exposure.
- Claim VERIFIED then REVERSED with zero retained value.
- Complete ordered audit facts.
- Duplicate evidence/execute/advance produces no second financial/domain effect.
- Reset and replay are deterministic.

Do not intercept production APIs with fake success in this suite. Keep the existing Playwright web smoke unchanged.

## 14. Verification command gate

Run commands individually and record exact counts/results:

```text
npm run typecheck
npm run lint
npm run format
npm run test:unit
npm run test:integration
npm run test:integration
npm test
npm run test:e2e:backend
npm run build
npm run smoke:api
npm run smoke:worker
npm run test:e2e
$env:CI='1'; npm run test:e2e
npm audit --omit=dev
npm audit
```

Use shell-appropriate CI syntax. `npm audit --omit=dev` must report zero vulnerabilities. The full audit may retain only the documented four moderate dev-only `drizzle-kit -> @esbuild-kit -> esbuild` advisories; do not run `npm audit fix --force`.

`npm run format` currently passes. Do not excuse a future format failure as line-ending churn and do not edit controlling documents merely to satisfy formatting. Investigate the exact changed file, preserve content, and leave the command gate honest.

## 15. Cleanup and security verification

At completion confirm, without printing secret values:

- No leaked `moneytrace_test_*` databases.
- No populated `.env` in the project.
- `DATABASE_URL` and test-only secrets unset from the final shell/process where practical.
- No listeners on documented development/test ports.
- No lingering API, worker, Vite, Vitest, Playwright, or Chromium process from this work.
- No live Razorpay key prefix, OpenAI-style key, private-key marker, database credential, or real PII in source, fixtures, logs, snapshots, OpenAPI, browser bundle, reports, or Git diff.
- No hidden-ground-truth runtime/model import.
- No raw secret-bearing command output pasted into reports.

Only clean exact disposable test resources. Do not delete broad paths, repositories, non-test databases, or unrelated user data.

## 16. Required completion report and stop condition

Update `PROJECT_HANDOFF.md` only after verification, preserving its operational history. Finish with:

```text
Gate and explicit stop boundary
Requirement/section -> implementation files -> tests -> observed result
Files added/changed and purpose
Migration order, exact constraint/index/trigger evidence, and seed/reset results
API/OpenAPI method/path/status matrix
Four E2E scenario results with persisted counts and money
Exact command results and test counts
Security/tenant/HMAC/credential statement
Environment failures separated from implementation failures
Known limitations and explicitly deferred scope
READY FOR GATE B5: YES/NO
```

State `READY FOR GATE B5: YES` only when every applicable B4 P0, explicit route/job/dataset/scenario requirement, migration assertion, and command gate is green. Otherwise state `NO` and list exact blockers. Stop after Gate B4 review material; do not implement Gate B5 or frontend.

## 17. Explicitly out of scope

- Gate B5 hardening/completion beyond the B4 handoff report.
- Any frontend code under `src/web`.
- Optional Razorpay Test Mode expansion.
- Real money, hosted database, real bank/ERP, paid model, deployment, commit, or push.
- Multi-currency, partial allocation, many-to-one reconciliation, generic accounting, generic graph exploration, policy editor, or new infrastructure.
- Weakening a schema/test, hard-coding success metrics, or fabricating readiness to meet schedule.
