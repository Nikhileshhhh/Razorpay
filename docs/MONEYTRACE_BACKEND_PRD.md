# MoneyTrace Backend PRD — Five-Day Working Prototype

**Version:** 1.0  
**Date:** 29 August 2026  
**Status:** Implementation contract  
**Audience:** Claude Code, backend implementers, and Codex reviewers  
**Delivery order:** Complete and verify this backend before starting `MONEYTRACE_FRONTEND_PRD.md`.

## 1. Document authority and execution rules

This PRD converts the existing product and architecture documents into one buildable backend scope for the remaining five days. It is intentionally smaller than a production system, but everything declared **required** here must run end to end.

When documents differ, use this precedence:

1. The non-negotiable financial-safety rules in `MONEYTRACE_ARCHITECTURE_HANDOFF.md` and `CODEX_REVIEW_CHECKLIST.md`.
2. This PRD for prototype scope, sequencing, APIs, acceptance criteria, and explicit deferrals.
3. `MoneyTrace PRD.md` for product intent and UX context.
4. `CLAUDE_CODE_TASKS.md` as a traceability catalog; its MT-003 through MT-018 tasks are consolidated here to fit the prototype schedule.

Do not guess around a contradiction. Preserve the stricter safety behavior, record the decision in an ADR or completion report, and keep going only when the choice does not alter product scope. Never weaken validation or fabricate a success path to make the demo pass.

## 2. Product outcome

The backend must prove this complete control loop using real persisted backend state:

```text
signed/test evidence
→ durable journal and duplicate/conflict handling
→ deterministic projections and seller expectation
→ invariant violation and deduplicated financial case
→ evidence-backed investigation or explicit abstention
→ registered plan and default-deny policy
→ immutable approval
→ stable action reservation and one simulated effect
→ transfer + settlement + independent bank evidence
→ unique reconciliation and ERP receivable closure
→ verified/reversed/unresolved financial outcome
→ complete audit replay
```

The prototype succeeds only if it can demonstrate all four scenarios:

1. **Recovery reversal:** an agent claims ₹1,20,000, a later full refund arrives, and the claim becomes `REVERSED` with verified incremental amount ₹0.
2. **Missing seller transfer:** a ₹5,00,000 capture creates a ₹4,55,000 seller obligation; the missing transfer opens one case; duplicate recovery is blocked; an approved simulated remediation is verified only after bank evidence, unique allocation, and observed ERP closure.
3. **Conflicting bank evidence:** equal amount but incompatible UTR/date/seller remains unresolved; investigation abstains, policy requests more evidence, and exposure remains open.
4. **Duplicate/replay safety:** repeated source evidence and repeated execute requests create no duplicate case, simulated effect, allocation, or receivable closure.

## 3. Time-boxed scope

### 3.1 Required prototype capabilities

- Existing versioned Zod contracts and generated OpenAPI remain the source of runtime/API shapes.
- Pure `bigint` money kernel, INR-only currency rules, rational allocation, and independent transition guards.
- PostgreSQL migrations, seed data, tenant-scoped repositories, and transactional helpers.
- Append-only evidence journal, exact duplicate detection, modified-duplicate quarantine, canonical projection, and safe replay.
- Expectations, six deterministic controls, financial outcomes, case identity/lifecycle, evidence links, sealed evidence sets, and linear money paths.
- Deterministic offline investigation gateway producing schema-valid finding/abstention artifacts; optional external model adapter behind the same interface.
- Registered plans, default-deny policy, immutable approval basis, separation of duties, stable action idempotency, transactional outbox, and simulated adapters only.
- Verification contracts, independent bank authority, unique one-to-one reconciliation, ERP closure observation, claim reversal, and append-only audit.
- All query/mutation APIs required by the frontend, OpenAPI, demo reset/advance, Data Health, and redacted audit export.
- One-command deterministic demo startup/reset, 500-record manifest, structured logs, health/readiness, tests, and a completion traceability report.

### 3.2 Explicitly deferred from the prototype

- Real money transfer, payout, refund, collection, messaging, or arbitrary ledger write.
- Production OIDC, SSO, SCIM, real session storage, and production permission administration.
- Real bank/ERP/customer PII, production retention workflows, and legal/compliance conclusions.
- Multi-currency conversion, partial/many-to-one reconciliation, a generic accounting engine, tax rules, or general ledger posting.
- Kafka, Redis, object storage, graph database, microservices, Kubernetes, Temporal, Elasticsearch, or a separate BFF deployment.
- General graph exploration, natural-language search, rule compiler, policy editor, settings UI, and mobile editing.
- Claimed production throughput/SLOs, cryptographic audit immutability, or exactly-once delivery.
- A required paid model/API. External model and Razorpay Test Mode calls are optional enhancements and may never be demo dependencies.

Deferral means the capability is absent and documented—not represented by a fake success response.

## 4. Current baseline

MT-001 and MT-002 are the starting point:

- Single TypeScript ESM package with Fastify API, explicit worker, React/Vite web entry point, strict TypeScript, Vitest, Playwright, Drizzle, pg, pg-boss, Pino, and import-boundary guards.
- Browser-safe versioned contracts for canonical events, authority, evidence, cases, findings, claims, plans/tools, policy, approvals, actions, verification, reconciliation, audit, errors, API envelopes, and generated OpenAPI.
- No domain behavior, database tables/migrations, feature routes, projectors, workers, connectors, generated dataset, or feature UI exists yet.

Claude must inspect current source before editing and preserve every passing MT-001/MT-002 check. Contract changes required by this PRD must modify the authoritative runtime schema, generated OpenAPI, invalid corpus, compile-time assertions, and snapshots together.

## 5. Architecture

### 5.1 Runtime

- **API process:** Fastify routes, demo identity resolution, service commands/queries, OpenAPI, health/readiness.
- **Worker process:** pg-boss jobs and outbox dispatch. No effect occurs in the API process.
- **Database:** PostgreSQL is the sole durable dependency for journal, state, outbox, jobs, and audit.
- **Frontend:** separate React/Vite build consuming public APIs only; implementation begins after backend acceptance.
- **External adapters:** signed synthetic OMS, Route, bank, ERP, recovery, and agent sources. Razorpay Test Mode is optional.
- **Investigation:** provider-neutral `ModelGateway`; deterministic offline gateway is required and external gateway is optional.

No module writes another module's tables directly. Cross-module behavior goes through public application services and persisted domain events/outbox jobs.

### 5.2 Required module ownership

| Module                  | Owns                                                                                   | Must not own/do                           |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `domain/money`          | `Money`, signed adjustments, allocation, comparison, formatting-independent arithmetic | I/O, DB, model, HTTP                      |
| `domain/state-machines` | financial outcome, case, claim, plan, approval, action, verification transition guards | persistence or UI state                   |
| `identity`              | demo users, memberships, `TenantContext`, role checks                                  | trust client tenant/role headers          |
| `ingestion`             | source authentication, raw acceptance, hash, dedupe/conflict, journal                  | projection before commit                  |
| `projection`            | idempotent current/history projections, checkpoint/replay                              | action dispatch during replay             |
| `expectations`          | versioned seller obligation and rule inputs                                            | model arithmetic                          |
| `invariants`            | deterministic controls/evaluation hashes                                               | case UI concerns                          |
| `cases`                 | deterministic case key, epoch, lifecycle, ownership, list/detail                       | financial outcome enum substitution       |
| `provenance`            | typed evidence links, candidate isolation, traversal                                   | promote fuzzy match silently              |
| `investigation`         | sealed evidence retrieval, gateway call, validation, finding/abstention                | policy, approval, execution, verification |
| `policy`                | immutable bundle and default-deny decision                                             | external effects                          |
| `approvals`             | decision basis, request/decision/expiry/invalidation                                   | client-derived actor/role                 |
| `actions`               | reservation, outbox, attempts, adapter registry                                        | real money or blind unknown retry         |
| `verification`          | contract/run/blockers/authority checks                                                 | treat ACK as proof                        |
| `reconciliation`        | unique allocation and closure eligibility                                              | amount-only fuzzy closure                 |
| `agent-claims`          | untrusted claim and retained-value evaluation                                          | change source facts                       |
| `audit`                 | append-only artifact/action timeline and export                                        | raw secret exposure                       |
| `demo`                  | deterministic seed/reset/scenario advance/manifest                                     | run outside demo environment              |

## 6. Identity, roles, and tenant isolation

### 6.1 Demo authentication

Use one demo-only request header, `x-demo-user-id`. The server resolves the user, tenant membership, and roles from seeded database records. The client may not submit tenant ID, role, requester, approver, executor, or authority as trusted identity.

Seed these users:

| User ID             | Display           | Roles                                                                 | Purpose                                 |
| ------------------- | ----------------- | --------------------------------------------------------------------- | --------------------------------------- |
| `user_viewer`       | Demo Viewer       | `viewer`                                                              | read-only UI                            |
| `user_investigator` | Demo Investigator | `viewer`, `investigator`, `case_manager`                              | investigation, policy, request approval |
| `user_approver`     | Demo Approver     | `viewer`, `finance_approver`                                          | approve/reject; distinct from preparer  |
| `user_operator`     | Demo Operator     | `viewer`, `executor`, `demo_operator`, `platform_operator`, `auditor` | execute, reset/advance, audit           |

Unknown/missing demo identity returns `401`. Valid identity without permission returns `403`. Demo auth is enabled only for `MONEYTRACE_ENV=demo|buildathon`; non-demo startup must fail unless a real auth provider is configured.

### 6.2 Tenant guarantees

- Every tenant-owned repository method requires `TenantContext` as its first parameter.
- Every tenant-owned table has `tenant_id`; joins, unique keys, jobs, and outbox payloads carry it.
- IDs alone never authorize a record.
- Seed a second tenant used only by negative tests.
- Cross-tenant access tests cover evidence, cases, money path, approvals, actions, verification, claims, and audit.

## 7. Financial kernel and immutable safety rules

### 7.1 Money

- Domain money is `{ amountMinor: bigint, currency: 'INR' }`.
- JSON and database boundaries use canonical decimal integer strings / PostgreSQL `BIGINT`; never JavaScript `number` or floating SQL types for financial decisions.
- Reject exponent notation, decimals, whitespace, leading plus, unsafe leading zeroes, negative unsigned values, and any non-INR currency.
- Addition/subtraction/comparison requires currency equality.
- Signed adjustments are typed by direction and reason; unclassified negative input rejects.

### 7.2 Allocation rule

The required versioned demo contract is exact:

```text
₹5,00,000 customer capture
= ₹4,55,000 seller obligation
+ ₹45,000 platform allocation
```

Represent rates as rational numerator/denominator, use round-half-even, and post any residual to `PLATFORM_ROUNDING_RESIDUAL`. Property tests must prove conservation over zero, boundaries, and rounding cases.

### 7.3 Independent state machines

Persist and guard these independently:

- Financial outcome: `EXPECTED`, `OBSERVED_UNVERIFIED`, `DIVERGED`, `ACTION_PENDING`, `VERIFIED`, `REVERSED`, `UNRESOLVED`.
- Case lifecycle: `candidate`, `open`, `investigating`, `recommendation_ready`, `approval_required`, `approved`, `executing`, `verification_pending`, `reconciled`, plus `abstained`, `escalated`, `rejected`, `expired`, `cancelled`, `closed_no_action`.
- Agent claim: `PENDING`, `VERIFIED`, `PARTIALLY_VERIFIED`, `REJECTED`, `UNRESOLVED`, `REVERSED`.
- Plan, approval, action, and verification states already defined in MT-002 contracts.

Every transition records previous/current state, expected resource version, reason, evidence/contract IDs, actor, and timestamp in one transaction. Forbidden or stale transitions return `409`.

### 7.4 Terminal verification

`VERIFIED` requires all of the following, structurally and at runtime:

- every required evidence type exists;
- amount, currency, identity, and time authority buckets pass;
- `SYNTHETIC_AGENT` is never terminal authority;
- settlement processing is not bank-credit proof;
- blockers/contradictions equal zero;
- effect verification passes;
- exactly one bank line is allocated to exactly one expectation;
- ERP receivable closure is observed, not merely requested.

A later authoritative refund/reversal appends history, moves the outcome to `REVERSED`, and opens a new case epoch where required.

## 8. Persistence contract

Create forward migrations and Drizzle schemas for the following prototype tables. JSONB is acceptable for versioned payload/details, but keys, states, amounts, versions, hashes, tenant scope, and uniqueness fields must be first-class columns.

| Table group      | Required tables and key guarantees                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | `tenants`, `users`, `memberships`; unique tenant/user membership and role enum                                                                                       |
| Sources/evidence | `source_connections`, `ingest_events`, `event_conflicts`; source ID uniqueness, raw hash/bytes, signature/dedupe/quarantine state, no application update/delete path |
| Projection       | `projector_runs`, `entity_revisions`, `entity_current`; idempotency by projector/version/event and non-regressing current pointer                                    |
| Financial state  | `economic_subjects`, `expectations`, `expectation_inputs`, `invariant_evaluations`, `financial_outcomes`; versioned current records and deterministic hashes         |
| Cases            | `cases`, `case_transitions`, `case_notes`; deterministic dedupe key + epoch, optimistic version, and append-only bounded plain-text notes                            |
| Provenance       | `entity_links`, `evidence_sets`, `evidence_set_items`; evidence-backed edges and sealed canonical set hash                                                           |
| Investigation    | `investigations`; unique case/evidence/prompt/model configuration and validated output/failure class                                                                 |
| Control loop     | `plans`, `policy_bundles`, `policy_decisions`, `approvals`, `actions`, `action_attempts`, `outbox`; immutable hashes, stable keys, append-only attempts              |
| Verification     | `verification_contracts`, `verification_runs`, `reconciliation_allocations`; immutable contract and unique bank-line/expectation allocation                          |
| Claims           | `agent_result_claims`, `claim_evaluations`; unique external claim and append-only evaluations                                                                        |
| Audit/demo       | `audit_entries`, `demo_scenario_state`; tenant audit sequence and optimistic scenario step                                                                           |

Required database behavior:

- Monetary columns are `BIGINT` plus currency checks.
- Every state/version/hash field has a not-null/check constraint where appropriate.
- All foreign relationships validate tenant equality.
- Evidence, evaluation history, attempts, transitions, and audit are append-only through repository permissions/API design.
- Migrations apply from an empty database; reset is destructive only for the explicitly configured disposable demo database.
- Repository tests prove unique/FK/check behavior and `bigint` round trips.

## 9. Evidence ingestion, projection, and replay

### 9.1 Acceptance sequence

```text
authenticate source/tenant
→ enforce body/item limits
→ preserve exact raw bytes or canonical import row
→ verify HMAC where required
→ validate source schema and canonical mapping
→ compute exact-byte SHA-256
→ insert journal + audit transactionally
→ respond accepted/duplicate/conflict
→ enqueue projector only for accepted non-conflict evidence
```

- Exact source ID + same hash returns duplicate success and creates no downstream domain effect.
- Same source ID + different hash creates `event_conflicts`, quarantines the new attempt, returns `409 EVIDENCE_CONFLICT`, and never projects it.
- Fallback dedupe includes source/entity/type/event time/raw hash and never merges equal-value distinct events.
- Preserve upstream `source_event_type` separately from canonical `event_type`.
- Preserve event time and ingestion time.

### 9.2 Projection

- Projectors are named/versioned and idempotent by tenant/projector/version/event.
- Current state uses source version when available, otherwise explicit status precedence and event time.
- Late events remain in history and trigger affected expectation/control/case/claim verification reevaluation.
- Unknown critical source states quarantine or become explicit unknown state; never coerce to success.

### 9.3 Replay

Replay may rebuild derived projections in a shadow set and compare a manifest before swap. Replay mode must have a hard action-topic denylist and a runtime test proving it cannot reserve or dispatch effects.

## 10. Deterministic controls, cases, and provenance

### 10.1 Expectations and controls

Implement all six controls from the source PRD:

1. `CTRL-01` captured payment with missing expected transfer.
2. `CTRL-02` processed transfer without verified recipient settlement/bank evidence after SLA.
3. `CTRL-03` seller receivable open after verified settlement.
4. `CTRL-04` duplicate recovery risk.
5. `CTRL-05` conflicting UTR/bank evidence.
6. `CTRL-06` duplicate event safety.

Use an injected/fixed clock for deterministic tests and demo. Every evaluation persists control/rule version, exact input hash, result, amount/currency, window, and evidence IDs.

### 10.2 Case identity and ranking

Case key is a canonical hash of `(tenant, control, economic subject, expectation version, evaluation window)`. Concurrent/replayed violation handling produces one active case epoch. Priority is deterministic from exposure, time sensitivity, customer-harm risk, and evidence coverage. Default list sorting is exposure descending.

### 10.3 Provenance and evidence sets

- Direct identifiers create verified/asserted/derived edges according to authority.
- Amount/date/name matches are candidate only; preserve competing candidates and contradictions.
- Every edge cites existing evidence and resolver version.
- Case traversal has allowlisted edge types, tenant/time bounds, maximum depth/nodes, and excludes rejected edges from authoritative closure.
- Seal each investigation evidence set with deterministic item order and canonical SHA-256 hash.
- API money path returns both structured nodes/edges and an accessible linear sequence.
- An authorized investigator may confirm or reject a candidate link using expected case/link versions and a required reason. Confirmation creates a reviewed `asserted` relationship with reviewer provenance; it does not become terminal financial authority merely because a human confirmed it. Rejection preserves the original candidate and appends a rejected review state. Both decisions trigger reevaluation and audit.

## 11. Investigation gateway

### 11.1 Required offline path

Implement `ModelGateway` with a deterministic `DemoInvestigationGateway` selected by `MODEL_PROVIDER=stub` (the default). It receives only the sealed typed evidence input and returns the existing `ModelInvestigationOutput` schema. Its behavior must be deterministic by evidence pattern, not case ID alone:

- Complete missing-transfer evidence → `FINDING` with registered remediation template.
- Contradictory bank/UTR/date evidence → `ABSTENTION/CONFLICTING_EVIDENCE`.
- Missing required evidence → `ABSTENTION/INSUFFICIENT_EVIDENCE`.

This is labeled an offline deterministic demo gateway in audit/Data Health; it must not be presented as a real hosted model.

### 11.2 Optional external provider

An external provider adapter may be implemented only behind `ModelGateway` and only when its key/config is supplied. No paid API is required for acceptance. The adapter has one normal attempt plus at most one retry for retryable no-side-effect failure, timeout, JSON schema validation, citation allowlist validation, finding/plan enum validation, and safe failure persistence. Provider failure falls back to rules-only abstention/explanation without blocking ingestion or cases.

### 11.3 AI authority boundary

The gateway cannot originate authoritative money, links, policy, approval, execution, verification, reconciliation, or state transitions. Application code injects deterministic exposure after validation. Untrusted source text is delimited; hidden labels, credentials, raw sensitive payloads, arbitrary SQL/URLs, and the tool executor are inaccessible.

## 12. Policy, approval, and action

### 12.1 Registered plans/tools

Use only the MT-002 allowlist:

- `SUPPRESS_SIMULATED_RECOVERY`
- `SIMULATE_TRANSFER_REMEDIATION`
- `REQUEST_MORE_EVIDENCE`
- `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION`

There is no generic HTTP/SQL/tool definition. The sole remediation plan template binds structurally to `SIMULATE_TRANSFER_REMEDIATION` parameters.

### 12.2 Default-deny policy

Seed immutable `moneytrace_demo_v1` rules:

- Any L4/real-money authority → `DENY`.
- Conflicting/blocking evidence → `REQUIRE_MORE_EVIDENCE`.
- Complete duplicate-recovery evidence + suppress simulation → `ALLOW_AUTOMATIC`.
- Transfer remediation simulation → `REQUIRE_APPROVAL` with `finance_approver`.
- Missing input, unknown action, wrong currency/environment/role, stale version, or unregistered plan → `DENY`.

Persist the exact structured input, canonical input hash, matched rules, decision, reason codes, bundle version, and actor context.

### 12.3 Approval

The decision basis hash contains every field in architecture §9.4: tenant/case/version, plan/version/hash, sealed evidence hash, policy bundle/decision, action, target, amount/currency, verification contract key/version, required role, and expiry.

- Requester/approver identities and roles are server-derived.
- Preparer cannot approve their own material plan.
- Approval decisions are append-only and state-correlated.
- Any basis change, blocker, conflict/reversal, role loss, separation-of-duties violation, or expiry invalidates authorization.
- Reservation rebuilds and compares the basis in the same transaction.

### 12.4 Action reservation/outbox

- Stable idempotency key derives from tenant/case/plan hash/tool/target.
- Same key + different request hash returns `409 IDEMPOTENCY_BODY_CONFLICT`.
- Reservation, audit entry, and outbox row commit together.
- Worker alone dispatches a typed synthetic adapter.
- Record attempts and distinguish `ACKNOWLEDGED`, `FAILED`, and `OUTCOME_UNKNOWN`.
- Unknown outcome exposes status checking/reconciliation and is never retried using a new key.
- Repeated execute calls return the existing action and create one simulated external reference/effect.

## 13. Verification, reconciliation, and claims

### 13.1 Simulated remediation evidence

The synthetic Route adapter acknowledges one transfer and emits signed `TransferCreated/Processed` evidence. A separate source emits recipient settlement. A separate signed synthetic bank adapter emits `BankCreditObserved` with amount, currency, recipient, UTR, and value date. A synthetic ERP adapter accepts only a reconciled expectation ID and emits observed receivable closure.

Every synthetic record is labeled `synthetic`; none is presented as Razorpay or real bank movement.

### 13.2 Verification and reconciliation sequence

1. Action acknowledgement creates/reuses `VERIFICATION_PENDING`.
2. Transfer and recipient settlement evidence may progress the run but cannot finish it.
3. Required bank authority validates amount/currency/identity/time.
4. Reconciliation transaction locks expectation and bank line; exact tenant/currency/recipient/amount/UTR/date must yield one match.
5. Unique constraints prevent reuse of either side.
6. ERP closure is requested through the typed tool and then observed as evidence.
7. Only then may verification become `EFFECT_VERIFIED`, outcome become `VERIFIED`, and case become `reconciled`.

Ambiguity leaves `UNRESOLVED`, returns `RECONCILIATION_AMBIGUOUS`, and preserves exposure. A later refund/reversal appends `EFFECT_REVERSED`/`REVERSED` and never erases the prior run/allocation.

### 13.3 Agent result claim

Agent claims are always `SYNTHETIC_AGENT/UNTRUSTED_CLAIM`. Evaluate retained value deterministically:

```text
verified incremental recovery
= max(0, eligible recovery captures
       - linked refunds
       - linked reversals
       - linked disputes
       - independently satisfied baseline)
```

The required opening claim produces `₹1,20,000 - ₹1,20,000 = ₹0` and `REVERSED`. Claim evaluations are append-only versions and do not change source financial facts.

## 14. API contract

All responses use the existing versioned envelopes with `schema_version` and `request_id`; mutations include resulting `resource_version`. Money remains decimal strings. Route validation uses the authoritative Zod schema, and OpenAPI is generated from the same schema instance.

### 14.1 Existing MT-002 routes that must be implemented

| Method/path                                | Purpose                           | Minimum role     | Required behavior                                                                                    |
| ------------------------------------------ | --------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /health`                              | liveness/config-safe environment  | public           | no DB side effect or secret                                                                          |
| `POST /v1/events`                          | canonical/signed event acceptance | connector        | durable accepted/duplicate/conflict                                                                  |
| `POST /v1/webhooks/razorpay`               | raw webhook acceptance            | source HMAC      | verify raw bytes before parse                                                                        |
| `POST /v1/imports`                         | deterministic dataset import      | demo operator    | async/durable import ID and item counts                                                              |
| `GET /v1/cases`                            | cursor case queue                 | viewer           | tenant filters/sorts/pagination plus bounded exact/prefix query over case ID or economic-subject key |
| `GET /v1/cases/:id`                        | case detail                       | viewer           | real persisted summary                                                                               |
| `GET /v1/cases/:id/money-path`             | expected/observed path            | viewer           | evidence-backed graph + linear path                                                                  |
| `POST /v1/cases/:id/investigations`        | run/reuse investigation           | investigator     | version/idempotency guard                                                                            |
| `POST /v1/cases/:id/evaluate-policy`       | run policy for plan               | case manager     | exact input/hash/default deny                                                                        |
| `POST /v1/cases/:id/request-approval`      | create bound request              | case manager     | one current request per basis                                                                        |
| `POST /v1/cases/:id/approve`               | approve current basis             | finance approver | no self-approval/stale basis                                                                         |
| `POST /v1/cases/:id/reject`                | reject current basis              | finance approver | reason required                                                                                      |
| `POST /v1/cases/:id/execute`               | reserve simulated action          | executor         | transaction/outbox/idempotency                                                                       |
| `GET /v1/cases/:id/verification`           | contract/run/evidence view        | viewer           | ACK distinct from verification                                                                       |
| `POST /v1/actions/:id/verification-checks` | idempotent recheck                | operator/worker  | no fabricated success                                                                                |
| `GET /v1/cases/:id/audit`                  | cursor audit replay               | viewer/auditor   | redacted by role                                                                                     |
| `POST /v1/agent-results`                   | accept untrusted claim            | agent connector  | unique external claim                                                                                |
| `GET /v1/agent-results/:id`                | claim/evaluation view             | viewer           | retained-value versions                                                                              |
| `POST /v1/demo/reset`                      | deterministic reset               | demo operator    | environment gate and exact seed                                                                      |
| `POST /v1/demo/scenarios/:id/advance`      | inject next scenario step         | demo operator    | expected-step idempotency                                                                            |

Implement the exact status/error matrix already registered in `src/contracts/registry.ts` unless this PRD explicitly adds an endpoint below.

### 14.2 Additional frontend-readiness endpoints

Add authoritative Zod/OpenAPI contracts and handlers for:

| Method/path                                 | Response purpose                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/overview`                          | computed synthetic KPIs, lifecycle distribution, opened/closed trend, top cases, opening claim-reversal summary, dataset timestamp |
| `GET /v1/cases/:id/evidence`                | role-redacted evidence timeline with event/ingest time, source authority, hash/reference, contradictions/missing types             |
| `GET /v1/cases/:id/notes`                   | cursor list of append-only operator notes with server-derived author and timestamp                                                 |
| `GET /v1/cases/:id/control-loop`            | current finding/abstention, plan, policy, approval, action, verification, reconciliation summaries and allowed next commands       |
| `GET /v1/approvals`                         | cursor list of requested/decided/expired/invalidated approvals with case/amount/expiry                                             |
| `POST /v1/cases/:id/request-more-evidence`  | finance approver decision with required reason; invalidates current actionable path                                                |
| `POST /v1/cases/:id/assign`                 | assign/unassign to a seeded user/team using expected case version                                                                  |
| `POST /v1/cases/:id/notes`                  | append a bounded plain-text operator note using expected case version; server derives author and audits it                         |
| `POST /v1/cases/:id/links/:linkId/decision` | investigator confirms/rejects a candidate with reason and expected versions; never silently creates terminal authority             |
| `GET /v1/data-health`                       | source capabilities, received/duplicate/conflict/schema-failure counts, lag, unlinked/candidate/stale counts, model mode           |
| `GET /v1/demo/status`                       | current seed, scenario steps, readiness, fixed clock, manifest hash                                                                |
| `GET /v1/cases/:id/audit/export`            | redacted JSON audit bundle with content hash; neutralize spreadsheet formula prefixes if CSV is later added                        |
| `GET /openapi.json`                         | generated OpenAPI document used for backend/frontend handoff                                                                       |

These endpoints are required; do not hard-code UI-only copies of their data.

Status conventions for the added endpoints are binding:

- Collection/readiness GETs (`overview`, `approvals`, `data-health`, `demo/status`, `openapi`) return `200`; invalid query is `400`, missing identity is `401`, and disallowed role is `403`.
- Case-scoped GETs (`evidence`, `notes`, `control-loop`) return `200`, `403`, or `404`; invalid cursor/filter is `400`.
- Assignment, request-more-evidence, and link decisions return a `200` mutation envelope or `403/409/422`.
- Note creation returns a `201` mutation envelope or `403/409/422`.
- Audit export returns `200 application/json`, `403`, or `404` and includes its content hash in both body metadata and a safe response header.
- Added mutation bodies and all added responses must be registered named schemas, runtime-validated, OpenAPI-visible, strict, bounded, and covered by invalid-corpus tests.

### 14.3 Error behavior

Use the standard safe envelope and explicit codes including `SCHEMA_INVALID`, `TENANT_SCOPE_REQUIRED`, `EVIDENCE_CONFLICT`, `VERSION_CONFLICT`, `POLICY_DENIED`, `APPROVAL_STALE`, `APPROVAL_FORBIDDEN`, `IDEMPOTENCY_BODY_CONFLICT`, `OUTCOME_UNKNOWN`, `CURRENCY_MISMATCH`, `RECONCILIATION_AMBIGUOUS`, `VERIFICATION_INCOMPLETE`, `SOURCE_UNAVAILABLE`, and `RATE_LIMITED`. Retriability is explicit. Never return raw database/provider errors or secrets.

## 15. Jobs and orchestration

Use pg-boss/outbox topics with versioned payload schemas and tenant IDs:

- `project-evidence.v1`
- `evaluate-controls.v1`
- `run-investigation.v1`
- `dispatch-action.v1`
- `check-verification.v1`
- `reconcile-expectation.v1`
- `reevaluate-claim.v1`
- `advance-demo-scenario.v1`

Each handler is idempotent, records retry class, and isolates poison data. Only `dispatch-action.v1` has adapter capability, and replay mode cannot publish it. The demo startup command must start API and worker; readiness must show worker/database state. Tests may drain jobs deterministically without arbitrary sleeps.

## 16. Synthetic dataset and demo orchestration

### 16.1 Manifest

Generate exactly 500 accepted synthetic lifecycle records with stable IDs, fixed UTC times, and no PII. The manifest is calculated from persisted records, not returned as narrative constants, and must assert:

- `records_total = 500`
- `records_matched = 468`
- `unresolved_cases = 16`
- `unsafe_candidate_matches_blocked = 4`
- `unresolved_exposure = 128000000 INR minor units` (₹12.8 lakh)
- `verified_restored = 45500000 INR minor units` (₹4.55 lakh after the main scenario closes)
- `duplicate_collection_prevented = 50000000 INR minor units` (₹5 lakh)
- `reversed_recovery = 12000000 INR minor units` (₹1.2 lakh)

Before the relevant scenario step, metrics reflect the current persisted stage; after advance they change deterministically. Do not force metrics independently of evidence/state.

### 16.2 Named scenarios

- `claim-reversal`
- `missing-transfer-remediation`
- `conflicting-bank-evidence`
- `duplicate-replay`

Reset is idempotent for the disposable demo database and returns the same manifest hash. Advance requires the caller's expected current step; repeated same-step commands return the current result without duplicate effects, while skipped/stale steps return `409`.

## 17. Optional Razorpay Test Mode adapter

- Optional credentials are server/worker environment variables only; never required for tests/reset/demo.
- Reject live-key prefixes in demo/buildathon.
- Webhook HMAC uses exact raw bytes and stores `x-razorpay-event-id` as source event ID.
- Map only allowlisted public event strings already represented in classification contracts.
- API fetch and webhook snapshot remain different evidence records.
- Preserve merchant versus recipient settlement scope.
- Capability absence is visible in Data Health and selects an explicitly synthetic adapter.
- `settlement.processed` never becomes `BankCreditObserved`.

No credential value belongs in source, fixtures, docs, logs, model context, frontend, test snapshots, or completion reports.

## 18. Security and operational requirements

- Validate request/query/path/body schemas and bounded text/arrays at the route boundary.
- Apply sensible prototype body and rate limits; permit legitimate signed webhook retries.
- Server derives identity/tenant/roles and enforces resource/action/amount/environment in service methods, not routes alone.
- Pino structured logs include safe request/event/case/action/correlation IDs, operation, result, latency, and retry class; exclude raw payloads, PII, credentials, auth headers, and database URLs.
- Model receives minimal redacted evidence only.
- Demo routes are disabled outside demo/buildathon.
- `/health` is liveness; add readiness details without leaking connection strings.
- Audit every evidence acceptance/conflict, finding/abstention, policy decision, approval, reservation/attempt, verification, allocation, closure, reversal, manual assignment, reset, and advance.
- If the audit write required for an action cannot commit, the action must not reserve/dispatch.

## 19. Required tests and verification matrix

### 19.1 Unit P0

- `bigint` money, currency mismatch, rational half-even allocation, residual, signed adjustment, conservation properties.
- Every independent state-machine transition, including forbidden/reversal paths.
- Canonical hashes and idempotency keys.
- Six controls and fixed-clock edge cases.
- Policy exhaustive/default-deny matrix.
- Approval basis field-by-field invalidation and separation of duties.
- Authority coverage and settlement-not-bank proof.
- Exact/ambiguous/contradictory reconciliation.
- Claim full/partial/refund/reversal retained value.
- Investigation schema/citation/plan validation and injection strings.

### 19.2 Database/integration P0

- Migrate from empty; seed/reset twice with identical manifest.
- Tenant/FK/unique/check/append-only behavior and `BIGINT` round trip.
- Event same ID/same body, same ID/different body, concurrent duplicate, malformed/oversized, accepted-before-ack.
- Out-of-order state non-regression, late reevaluation, replay twice, replay dispatch denial.
- Event-to-expectation/control/case and case dedupe under concurrency.
- Evidence traversal bounds and sealed hash stability.
- Candidate-link confirm/reject provenance, stale review, cross-tenant review, and proof that confirmation is not terminal authority.
- Case-note author derivation, text bounds/plain rendering contract, optimistic versioning, and audit.
- Approval-to-reservation/outbox and crash before/after dispatch.
- Same idempotency key/different body, timeout after acceptance, no new-key retry.
- Concurrent one-to-one allocation and observed ERP closure.
- Cross-tenant negative tests for every aggregate.

### 19.3 API/contract P0

- Every route validates the same schema used by OpenAPI.
- Exact method/path/status/error matrix and mutation resource versions.
- Cursor pagination and allowlisted filters/sorts.
- Role matrix and client identity injection rejection.
- Secrets/raw payloads absent from responses, logs, OpenAPI, and browser-safe contracts.

### 19.4 End-to-end backend P0

Automate the four scenarios in §2 against a real test PostgreSQL database and running API/worker. Assert one case/action/effect/allocation, correct rupee values, conflict abstention, claim reversal, complete audit ordering, and deterministic replay/reset.

### 19.5 Standard command gate

All existing commands must remain green: typecheck, lint, format, unit, integration twice, complete tests, build, built API/worker smoke, E2E smoke, and production dependency audit. Add migration/seed/backend-E2E commands with documented names. No populated `.env`, leaked credentials, stray servers, or occupied development ports may remain after tests.

## 20. Three-day backend execution sequence

The five-day product schedule reserves roughly three days for backend, one and a half for frontend, and half a day for end-to-end hardening. Claude must work in this dependency order, keeping the repository green at each checkpoint:

1. **Gate B1 — kernel and database:** money/state machines, migrations, tenant repositories, seed identity. No routes yet.
2. **Gate B2 — evidence to case:** ingestion, projection, expectations, six controls, cases, provenance, sealed evidence, query APIs.
3. **Gate B3 — control loop:** investigation, plan/policy, approvals, action/outbox/synthetic adapters.
4. **Gate B4 — verification and demo:** bank/ERP verification, reconciliation, claims/reversal, audit, reset/advance, overview/Data Health/read models.
5. **Gate B5 — hardening and handoff:** all tests, OpenAPI, fixtures, runbook, measured manifest, security scan, backend completion report.

Do not begin frontend implementation while any backend P0 test, required endpoint, migration, or demo scenario is incomplete.

## 21. Backend definition of done and frontend handoff

Backend is complete only when all statements are true:

- A clean setup can create/migrate/reset the demo database and start API + worker with documented commands.
- All required APIs return real persisted state and match generated OpenAPI.
- Exactly 500 records and manifest metrics are reproducible from reset.
- All four scenarios run end to end with required financial and safety outcomes.
- No real-money capability exists; optional external integrations can be disabled without loss of demo behavior.
- P0 tests and the permanent applicable checklist pass; known non-P0 limitations are explicit.
- The handoff includes `/openapi.json`, example request/response fixtures for every frontend endpoint, seeded demo users/role instructions, scenario IDs/steps, error code catalog, and a backend completion report mapping every section of this PRD to files and tests.

Claude's backend completion report must contain:

```text
Requirement ID/section → implementation files → tests → result
Database migration/seed commands and results
API/OpenAPI route inventory and status matrix
Four scenario results with computed amounts/counts
Security/tenant/secret-scan results
Known limitations and explicit deferred scope
BACKEND READY FOR FRONTEND: YES/NO
```

`YES` is forbidden if any required item is skipped, mocked, or represented only in documentation.

## 22. Permanent prohibitions

1. No real-money or generic arbitrary action.
2. No model-originated authoritative values, links, decisions, or state.
3. No floating-point money or missing currency.
4. No parsed webhook signature verification.
5. No assumption of ordered/exactly-once delivery.
6. No overwrite or projection of conflicting evidence.
7. No settlement-as-bank-proof shortcut.
8. No candidate-as-verified shortcut.
9. No action without current policy and bound approval where required.
10. No blind retry of unknown outcomes.
11. No double allocation/closure.
12. No verification without all authoritative checks and zero blockers.
13. No erased reversal history.
14. No unscoped tenant query/job/key.
15. No secret in browser/model/log/source/fixture/docs.
16. No replay dispatch.
17. No hidden-label runtime/model access.
18. No fake metrics, fake AI, fake progress, or hard-coded success response.

## 23. Source-requirement traceability

This matrix proves that every backend task family in the original roadmap is either required here or explicitly deferred in §3.2.

| Source requirement/task                        | Implemented by this PRD                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-ING-001–007 / MT-005, MT-006                | §§8–9 and §15: journal, validation, dedupe/conflict, projection, late events, replay, durable jobs                                                                     |
| FR-LINK-001–004 / MT-009                       | §§10.3 and 14.2: typed provenance, candidate isolation, evidence sets, bounded paths, audited confirm/reject review without terminal-authority promotion               |
| FR-EXP-001–003 and CTRL-01–06 / MT-003, MT-007 | §§7 and 10.1: money kernel, versioned expectations, six deterministic controls                                                                                         |
| FR-CASE-001–005 / MT-008                       | §§7.3 and 10.2: deterministic identity/epoch, priority, lifecycle, ownership, dedupe; general merge UI is deferred but merge/suppression history remains backend state |
| FR-AI-001–005 / MT-012                         | §11: bounded sealed retrieval, structured/cited output, deterministic values, abstention, offline/optional provider modes                                              |
| FR-POL-001–005 / MT-013                        | §12.2: versioned exhaustive default-deny policy and separation of duties                                                                                               |
| FR-ACT-001–005 / MT-014, MT-015                | §§12.1, 12.3, 12.4 and 15: typed tools, immutable approval, stable key, outbox, unknown outcome, simulated effects only                                                |
| FR-VER-001–003 / MT-016, MT-017, MT-018        | §13: contract verification, bank authority, reconciliation, ERP closure, reversal, claim retained value                                                                |
| FR-AUD-001–003                                 | §§8, 14.2, 18, and 21: append-only run record, human-readable replay, redacted export                                                                                  |
| MT-004                                         | §§6 and 8: PostgreSQL schema, tenant repositories, constraints, migrations, reset boundaries                                                                           |
| MT-010                                         | §16: 500-record deterministic seed, manifest, scenario reset/advance, hidden-label isolation                                                                           |
| MT-011                                         | §17: optional public Test Mode adapter with raw HMAC/capability-visible synthetic fallback                                                                             |
| MT-021 backend/reliability                     | §§16, 18–21: demo orchestration, observability, adversarial/E2E gates, handoff report                                                                                  |

Production-only identity, infrastructure, generalized reconciliation, graph exploration, settings, and real connectors are not silently omitted; they are listed in §3.2 and are not part of the five-day prototype claim.
