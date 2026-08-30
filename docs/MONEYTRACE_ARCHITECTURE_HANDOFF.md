# MoneyTrace architecture and implementation handoff

**Status:** architecture decision record and Buildathon implementation contract  
**Date:** 25 August 2026  
**Input:** `MoneyTrace PRD.md` version 1.0  
**Scope:** documentation only; no application source was changed

This document is the controlling technical handoff for implementation. Where it is stricter than the PRD, the stricter financial-safety rule applies. It describes a proposed MoneyTrace system, not Razorpay's private architecture.

## 1. Executive architectural verdict

MoneyTrace is a strong and differentiated product concept. Its best Buildathon form is a TypeScript modular monolith backed by PostgreSQL, with an append-only evidence journal, deterministic financial kernel, relational provenance edges, durable PostgreSQL jobs, a bounded model gateway, default-deny policy, immutable approvals, a simulated action adapter, authoritative verification, and audit replay.

The PRD's central thesis must remain unchanged: MoneyTrace is an outcome-verification and financial-control layer, not a payment chatbot, generic anomaly dashboard, or autonomous money-moving agent.

The PRD is not yet safe to hand directly to a coding agent. It needs the contracts fixed in this document: source authority, canonical events, separate state machines, allocation arithmetic, approval binding, reconciliation uniqueness, test-mode boundaries, exact module ownership, and ordered implementation tasks.

**Build verdict:** proceed, but implement one deterministic vertical slice before AI. The minimum winning slice is:

```text
captured marketplace payment
-> seller obligation
-> missing-transfer divergence
-> evidence-backed case
-> typed remediation plan
-> deterministic policy
-> immutable approval
-> idempotent simulated action
-> simulated Route/settlement evidence
-> independent synthetic bank credit
-> unique receivable allocation
-> outcome verification
-> audit replay
```

## 2. PRD audit and critical issues

### 2.1 What is already excellent

- The product category is clear: expected-versus-observed financial outcomes.
- The AI boundary is unusually strong: evidence-grounded investigation, no financial authority.
- Action acknowledgement is correctly separated from economic verification.
- Reversals, duplicate delivery, out-of-order events, ambiguous execution, and abstention are first-class.
- The five-minute demo proves retained value, prevented harm, remediation, and refusal to guess.
- The Buildathon/production distinction and modular-monolith preference are correct.
- Hidden labels, deterministic reset, evidence contracts, typed actions, default deny, and audit replay form a credible evaluation story.

### 2.2 Ambiguities and underspecification that must be resolved

| Area | Problem | Binding decision |
|---|---|---|
| Source authority | The PRD asks which source is authoritative but does not answer it for the demo. | Use the authority matrix in section 2.7. Authority is field- and contract-specific, never global. |
| State | Case state, financial-outcome state, action state, approval state, and agent-claim state are mixed in prose. | Persist five independent state machines. No enum substitutes for another. |
| Approval | Section 14's object omits the evidence-set hash and verification-contract version even though later text depends on them. | Approval binds to `decision_basis_hash`, containing plan, evidence, policy, case, action, amount, target, and verification-contract versions. |
| Event envelope | The PRD envelope hides amount, currency, entity references, and raw reference in `data`. | Promote all identity, money, provenance, and ordering fields into the canonical envelope. |
| Webhook identity | Razorpay's public duplicate key is the `x-razorpay-event-id` header, not a guessed payload field. | Persist the header as `source_event_id`; preserve the raw body and verified signature status. |
| Event ordering | Event time alone does not define a total business order. | Use source entity version/status precedence when available; late evidence cannot regress current state, but remains in history and triggers reevaluation. |
| Settlement proof | A processed settlement can be mistaken for bank receipt. | `settlement.processed` is settlement evidence, not bank-credit evidence. Final bank verification requires a separate bank observation. |
| Route settlement scope | Merchant settlement and Route linked-account settlement can use the same public event name. | Store `settlement_scope`, source account, recipient, and adapter context. Never join by event name alone. |
| Arithmetic | “Platform retention, fees, taxes” can be double-counted. | Seller allocation and merchant settlement are different ledgers/contracts. Each equation names its buckets exactly once. |
| Rounding | Minor units are required but rate allocation and residual handling are absent. | Use versioned rational rates, round half-even to the currency minor unit, and post residual to an explicit residual bucket. |
| Reconciliation uniqueness | “Unique allocation” lacks a database rule and partial-allocation policy. | Buildathon uses strict one-bank-line-to-one-expectation allocation. Production partial allocation requires locked aggregate checks. |
| Verification sequence | Bank verification, reconciliation, and receivable closure can become circular. | First verify action effect, then allocate uniquely, then close the synthetic ERP receivable, then observe closure, then mark the financial outcome `VERIFIED`. |
| Agent claims | The example lacks claim identity, tenant, currency, schema, and observation window. | Add those fields; treat the claim as untrusted input and evaluate it independently. |
| Demo metrics | Fixed counts and rupee totals may drift from generated data. | Generate metrics from seeded records and assert the narrated totals in a manifest test. |
| Storage | Object storage and a graph database are presented as optional without a Buildathon choice. | Store raw JSON/CSV row payloads as immutable PostgreSQL JSONB/text for the prototype; use relational edges; do not add object or graph infrastructure. |

### 2.3 Over-engineered elements to cut from the Buildathon

- Separate BFF, case service, graph service, investigation service, policy service, and audit service deployments.
- A general graph explorer or graph database.
- A generic rule compiler or natural-language query engine.
- Redis, Kafka, Kubernetes, Temporal, Elasticsearch, and object storage.
- Multi-currency settlement, partial settlement allocation, or real connector frameworks beyond the adapter interfaces.
- Streaming UI infrastructure; short polling is sufficient for the demo.

### 2.4 Requirement conflicts

- “One queue or durable job mechanism” and a source-code-only demo conflict unless the database is available. Resolution: PostgreSQL is the one required runtime dependency; `pg-boss` provides durable jobs in it.
- “Optional object store” conflicts with durable raw evidence in a small prototype. Resolution: immutable rows in PostgreSQL now; external immutable blob storage is a production evolution.
- “Agent participates in ACT” conflicts with “policy, execution, verification remain deterministic.” Resolution: the AI stops after proposing a registered plan; the orchestrator, not the model, performs later stages.
- The case can become `reconciled`, while outcome can later be `REVERSED`. Resolution: reversal opens a new case lifecycle epoch and appends a case transition; historical reconciliation is not erased.
- Test mode simulates Route transfers, but real bank settlement never occurs. Resolution: use Razorpay Test Mode only for supported payment/Route evidence and a clearly labeled synthetic bank connector for bank proof.

### 2.5 Implementation clarifications

- Demo currency is INR only. Cross-currency is rejected at ingestion or expectation creation.
- Demo seller allocation is contractual: `₹5,00,000 customer collection = ₹4,55,000 seller obligation + ₹45,000 platform allocation`. Payment gateway fees/taxes belong to a separate merchant-settlement contract and are not subtracted again.
- All times are UTC instants. Display in the user's zone only at the UI boundary.
- `payload_hash` is SHA-256 over the exact accepted raw bytes. Canonical JSON hashes are separately named.
- A replay runs projectors and controls only. It cannot enqueue external or simulated side effects.
- “Immutable” means application roles have no update/delete path for evidence and audit rows. The prototype must not claim cryptographic tamper-proofing.
- The synthetic event generator is trusted as a demo source only after HMAC verification with a dedicated secret. It is never labeled Razorpay evidence.

### 2.6 Requirements that must never be weakened

- Integer minor-unit arithmetic and currency equality.
- Raw evidence preservation, provenance, and conflicting-duplicate quarantine.
- Deterministic financial invariants and state transitions.
- AI cannot originate authoritative amounts, links, evidence, policy, or verification.
- Default-deny policy before every effect.
- Approval is immutable, scoped, expiring, version-bound, and rechecked at execution.
- Stable idempotency reservation before dispatch and no blind retry after unknown outcome.
- Settlement processing is not bank-credit proof.
- One observed value cannot close two obligations.
- `VERIFIED` requires contract-complete authoritative evidence and zero blocking contradictions.
- Later refunds/reversals reopen the obligation; history is superseded, never rewritten.
- Tenant isolation is enforced in keys, queries, jobs, and tests.
- Conflicting evidence produces abstention, not a confident guess.

### 2.7 Buildathon source-authority matrix

| Fact | Demo authority | Notes |
|---|---|---|
| Order/payment ID and payment captured status | Razorpay Test Mode fetch/webhook, when configured; otherwise signed Razorpay-shaped fixture | Webhook snapshot and current fetch are distinct evidence. |
| Commercial intent and seller allocation rule | Synthetic OMS contract record | Razorpay is not the source of merchant contractual allocation. |
| Seller obligation due time | Versioned MoneyTrace expectation derived from OMS rule | Derived evidence includes rule and input hashes. |
| Transfer API acceptance/status | Razorpay Route Test Mode when account capability exists; otherwise synthetic Route adapter | An HTTP/API result is not settlement or bank proof. |
| Recipient settlement record | Route Test Mode event/fetch when demonstrably available; otherwise synthetic Route settlement source | Preserve `settlement_scope=RECIPIENT`. |
| Bank credit, UTR, value date | Signed synthetic bank feed | Required for the Prove-It terminal verification. |
| Seller receivable open/closed | Synthetic ERP | MoneyTrace may request closure only after unique reconciliation. |
| Recovery action scheduled/suppressed | Synthetic recovery connector | Customer messaging or collection is never real. |
| Agent recovery claim | Synthetic agent connector | Always an untrusted claim, never truth. |
| Policy/approval/action/audit | MoneyTrace | Derived or control artifacts, never source financial evidence. |

## 3. Final recommended architecture

```text
  Razorpay Test Mode       Synthetic OMS/ERP       Synthetic Bank/Agent
          |                       |                        |
          +-----------------------+------------------------+
                                  v
                    authenticated ingestion adapters
                                  v
              append-only evidence journal + quarantine
                                  v
                 idempotent canonical event projectors
                                  v
          entities + relational provenance + expectations
                                  v
            deterministic invariants + financial outcomes
                                  v
                     deduplicated financial cases
                                  v
               bounded evidence-set builder and retriever
                                  v
                model gateway -> schema/citation validator
                                  v
                      registered typed plan proposal
                                  v
              deterministic policy -> approval if required
                                  v
         decision-basis recheck -> idempotency reservation/outbox
                                  v
                  simulated/Razorpay-test adapter execution
                                  v
              effect verification -> unique reconciliation
                                  v
             synthetic ERP closure -> terminal verification
                                  v
                      append-only audit + UI replay
```

The system is an event-informed modular monolith, not pure event sourcing. Raw accepted evidence is append-only; current projections are rebuildable; operational commands and approvals are ordinary relational records with complete audit history.

### Runtime components

1. React web application.
2. Fastify TypeScript API and worker process built from the same codebase.
3. PostgreSQL for durable evidence, domain state, outbox, jobs, and audit.
4. One model provider behind a provider-neutral `ModelGateway`.
5. Optional Razorpay Test Mode credentials, always server-side.

## 4. Buildathon architecture and technology decisions

| Decision | Choice | Why | Alternative and trade-off | Production evolution |
|---|---|---|---|---|
| Language | TypeScript, one package | Strong contracts across UI/API/worker; fastest small-team path | Python/FastAPI is strong for data/AI but duplicates frontend contracts | Split packages/services only when ownership or scaling requires it |
| Web UI | React + Vite + public `@razorpay/blade` | Blade is public, React-compatible, accessible, and aligned to the brief | Next.js adds full-stack conventions but is unnecessary for an internal SPA | CDN/static frontend and independently scaled API |
| API | Fastify + Zod/OpenAPI | Raw-body hooks, validation, typed handlers, low ceremony | NestJS provides stronger conventions with more boilerplate | Separate ingest and query deployments behind the same contracts |
| Persistence | PostgreSQL | Transactions, unique constraints, row locks, JSONB, relational graph | SQLite simplifies local setup but weakens concurrent financial semantics | Partition large journals and use replicas/read projections |
| ORM/query | Drizzle plus explicit SQL migrations | Typed schema without hiding SQL constraints | Prisma is productive but less direct for specialized constraints | Keep migration ownership per future service |
| Durable jobs | `pg-boss` in PostgreSQL | Durable queue without Redis; transactional operational model | In-process jobs are not crash-safe; Redis adds infrastructure | Managed queue/Kafka only after measured throughput need |
| AI | Provider-neutral gateway with schema output | Evaluation and degraded mode are possible | Direct SDK coupling is faster initially but creates unsafe spread | Model routing, per-tenant controls, offline evaluation |
| Graph | Indexed `entity_links` table | Enough for bounded case traversal | Neo4j is unnecessary for the wedge | Dedicated graph/read store only if traversal workload proves it |
| Raw evidence | Append-only PostgreSQL JSONB/text | One dependency and transactional acceptance | Object storage is better for very large payloads but adds setup | Immutable blob storage with DB metadata and retention controls |
| Observability | Pino JSON logs, Prometheus-style metrics endpoint, audit records | Sufficient and inspectable | Full tracing stack costs demo time | OpenTelemetry collector and financial SLO dashboards |

Deployment is two processes from one repository (`api` and `worker`) plus PostgreSQL. They may run in one container/process for the demo, but the worker entry point remains explicit.

## 5. Production evolution architecture

Do not prebuild the following. Evolve at measured boundaries:

1. **Ingestion scale:** partition canonical events by `(tenant_id, economic_subject_key)`; horizontally scale signature validation and adapters; retain at-least-once delivery.
2. **Projection scale:** separate projector workers by module and version; batch writes; use journal partitions and checkpoints.
3. **Query scale:** dedicated case read projections and read replicas; cursor pagination; tenant/time/amount indexes.
4. **AI scale:** deterministic controls stay synchronous; enqueue only material or ambiguous cases; quotas and model routing prevent ingestion backpressure.
5. **Effect isolation:** action dispatch becomes a separately privileged service with egress allowlists and HSM/secret-manager access.
6. **Evidence scale:** raw payloads move to immutable object storage, referenced by content hash; metadata stays relational.
7. **Service decomposition:** first candidates are ingestion, investigation, and action execution because they have distinct scaling/security profiles. Financial kernel and policy contracts remain shared versioned specifications, not a network of tiny services.
8. **100k events/min concept:** hash partitioning, batched journal inserts, asynchronous projections, deferred AI, partition-local ordering, and horizontally scaled workers. This is an architecture path, not a measured claim.

## 6. Domain boundaries

| Domain | Responsibility and owned data | Inbound | Outbound/API | Hard invariant and principal failure mode |
|---|---|---|---|---|
| Identity/Tenant | Tenants, users, memberships, roles, source connections | Auth identity, admin config | Auth context, `/me` | Every record/job/query has tenant; fail closed on missing scope |
| Event Ingestion | Authenticate, preserve raw bytes, validate, dedupe, quarantine | Webhook/batch/synthetic event | `EvidenceAccepted`, `DuplicateDetected` | Durable journal insert precedes 202; conflict is never overwritten |
| Evidence | Immutable evidence metadata/payload and authority labels | Accepted raw source, derived artifact | Evidence references/sets | Content hash and source identity cannot change |
| Entity Projection | Current and historical source entity revisions | Canonical events | `EntityProjected` | Late events cannot silently regress current state |
| Expected Outcome | Versioned obligations from explicit rules | OMS/rule evidence | `ExpectationCreated/Superseded` | Inputs/rule/currency/amount are reproducible |
| Financial Invariant Engine | Pure arithmetic and lifecycle controls | Projections + expectations + clock | `InvariantEvaluated/Violated` | No model or float participates in authoritative calculation |
| Financial Case | Deterministic case identity, workflow, ownership, SLA | Violations, reversals, evidence changes | Case API/events | One active case epoch per deterministic key |
| Provenance Graph | Typed, evidence-backed entity links and candidate links | Projected entities, resolvers, human review | Money-path/retrieval | Candidate is never promoted without deterministic/manual authority |
| AI Investigation | Bounded evidence retrieval, model call, validation | Case/evidence-set snapshot | Validated finding and plan-template selection | Citation outside evidence set invalidates the result |
| Agent Result Claim | Untrusted external claim and deterministic evaluation | `POST /agent-results`, later refund/reversal | Claim status/API | Claim never changes source financial facts |
| Policy | Versioned, deterministic default-deny decisions | Plan, actor, case, evidence facts | `PolicyEvaluated` | Missing input/action rule is DENY |
| Approval | Immutable review target and decision | Current decision basis | Approval API/events | Approver cannot authorize a changed/stale basis |
| Action | Reservation, outbox, typed tool execution, outcome uncertainty | Approved plan + policy recheck | Action API/events | Unique idempotency key before any effect |
| Verification | Contract-based effect and outcome checks | Action result + authoritative evidence | Verification status/events | Acknowledgement never equals verified effect |
| Reconciliation | Unique evidence-to-obligation allocation and difference | Verified effect, expectation, bank line | Allocation/result | Observed value cannot be consumed twice |
| Audit | Ordered immutable facts, decisions, actors, hashes | All domain events/artifacts | `/audit`, export | No action can proceed if its audit write fails |
| Razorpay Integration | Map public API/webhook shapes to canonical events | Raw Razorpay responses/webhooks | Canonical event, fetch status | Preserve upstream strings and account/scope; no domain coupling |
| Synthetic Connectors | Deterministic OMS/ERP/bank/recovery/Route/agent fixtures | Demo commands/seed | Signed synthetic events | Every record is labeled synthetic; hidden truth is separate |
| Demo Orchestration | Reset, seed, inject moments, assert manifest | Authorized demo control | `/demo/*` in demo env | Disabled outside demo environment and never uses live keys |

Domain modules communicate through application commands and persisted domain events. They may call each other in-process, but they cannot write each other's tables directly.

## 7. Data model

### 7.1 Core tables and constraints

| Table | Key fields | Required constraints/indexes |
|---|---|---|
| `tenants` | `id`, environment, default currency | PK `id`; environment enum |
| `users`, `memberships` | identities and tenant roles | Unique `(tenant_id,user_id)`; role enum |
| `source_connections` | source type, account scope, secret reference | Unique `(tenant_id,source_type,external_account_id)` |
| `ingest_events` | raw bytes/JSON, hash, source event ID, signature, times | Unique `(tenant_id,source_system,source_event_id)` when ID present; index tenant/event time; update/delete denied |
| `event_conflicts` | existing/new hashes and quarantine reason | FK both evidence attempts; no projection until reviewed |
| `projector_runs` | projector/version/event/status | Unique `(tenant_id,projector_name,projector_version,event_id)` |
| `entity_revisions` | entity key, source version/status, evidence ID | Unique `(tenant_id,source_system,entity_type,source_entity_id,revision_key)` |
| `entity_current` | current revision pointer | PK `(tenant_id,entity_key)`; FK revision |
| `economic_subjects` | subject type/key, amount/currency | Unique `(tenant_id,subject_type,subject_key)` |
| `expectations` | subject, version, rule, amount, due, state version | Unique `(tenant_id,subject_id,version)`; one current partial unique index |
| `expectation_inputs` | expectation/evidence/rule role | Unique `(expectation_id,evidence_id,input_role)` |
| `invariant_evaluations` | control/version/subject/window/result | Unique deterministic evaluation key |
| `financial_outcomes` | expectation, status, version, observed amount | Unique current per expectation; optimistic `version` |
| `cases` | dedupe key, epoch, state, exposure | Unique active `(tenant_id,case_dedupe_key,epoch)`; indexes state/exposure/due |
| `case_transitions` | from/to/reason/evidence/actor | Append-only; index case/time |
| `entity_links` | typed edge, nodes, confidence, evidence set | Unique resolver result; indexes `(tenant,source_node,type)` and target |
| `evidence_sets`, `evidence_set_items` | immutable snapshot/hash and ordered evidence | Unique hash per tenant; item FK; no mutation after seal |
| `investigations` | case, evidence hash, prompt/model/schema, result | Unique `(case_id,evidence_set_hash,prompt_version,model_config_hash)` |
| `agent_result_claims` | claim ID, tenant, subject, amount/currency, correlation | Unique `(tenant_id,external_agent_id,external_claim_id)` |
| `claim_evaluations` | claim/version/status/verified amount | Append-only version; current pointer |
| `plans` | template/version/parameters/hash/status | Unique plan hash; only one current selected plan per case |
| `policy_bundles`, `policy_decisions` | immutable version and evaluated inputs/hash | Unique bundle version; decision input hash |
| `approvals` | decision-basis hash, actor/role, expiry, decision | Only one effective approval per basis/required role; immutable decision |
| `actions` | idempotency key, request hash, status, external ref | Unique `(tenant_id,idempotency_key)`; body conflict rejected |
| `action_attempts` | action/attempt/request/response/error | Append-only; attempt number unique per action |
| `outbox`/job tables | topic/key/payload/status | Unique domain event ID; claimed with skip-locked semantics |
| `verification_contracts` | versioned required facts/equation/window | Unique `(contract_key,version)`; immutable |
| `verification_runs` | contract, subject/action, status, evidence hash | Unique evaluation key; optimistic version |
| `reconciliation_allocations` | expectation, bank line, amount | Buildathon unique bank line and expectation; amount positive and exact |
| `audit_entries` | sequence, artifact type/id/hash, actor/time | Append-only; unique `(tenant_id,audit_sequence)` |

All tenant-owned FKs include or validate `tenant_id`. Repositories require an explicit `TenantContext`; no unscoped repository method exists.

### 7.2 Monetary representation

- `BIGINT` minor units in PostgreSQL; TypeScript domain values use `bigint`, serialized as decimal strings at API boundaries.
- ISO-4217 uppercase currency code stored beside every amount. Buildathon allowlist is only `INR` with exponent 2.
- No JavaScript `number`, SQL floating type, or model-generated arithmetic in the financial kernel.
- Signed adjustments use `(direction, absolute_amount_minor, reason_code)` at input and a signed `bigint` only inside the equation. Unclassified negative amounts are rejected.
- Allocation rates are rational `(numerator, denominator)` with a versioned rounding policy. Use round-half-even; explicit residual goes to `PLATFORM_ROUNDING_RESIDUAL`.
- A bucket cannot become negative unless the rule explicitly permits it and policy validates the reason.

### 7.3 Demo equations

Seller obligation contract:

```text
50000000 paise customer capture
= 45500000 paise seller allocation
 + 4500000 paise platform allocation
```

Recovery claim retained-value contract over its observation window:

```text
verified_incremental_recovery
= max(0, eligible_recovery_captures
       - linked_refunds
       - linked_reversals
       - linked_disputes
       - independently_satisfied_baseline_amount)
```

For the opening demo, `12000000 - 12000000 = 0` paise retained value. The model may narrate this result but cannot calculate or persist it.

### 7.4 Reconciliation uniqueness

The Buildathon uses strict one-to-one reconciliation: one authoritative synthetic bank line may match one active seller expectation and one expectation may consume one bank line. The transaction locks both rows, checks tenant/currency/recipient/UTR/date/amount, inserts the allocation, and then closes the receivable. Equal-amount candidate records remain unresolved unless the authoritative identifiers make exactly one match.

Production may support partial/many-to-one allocations only with row-locked aggregate checks ensuring allocated sums never exceed either side, plus a stable allocation idempotency key.

## 8. Event model

### 8.1 Canonical event envelope

```yaml
event_id: evt_01H...
tenant_id: ten_demo
source_system: RAZORPAY_TEST
source_account_id: acc_...
source_event_id: x-razorpay-event-id-value
source_event_type: payment.captured
event_type: PaymentCaptured
schema_version: '1.0'
event_time: 2026-08-25T05:20:00Z
ingested_at: 2026-08-25T05:20:02Z
source_entity_version: null
entity_references:
  payment_id: pay_...
  order_id: order_...
economic_subject_hint: order:merchant-order-718:seller-42
amount_minor: '50000000'
currency: INR
correlation_id: corr_order_718
causation_id: null
payload_hash: sha256:...
raw_payload_ref: db:ingest_events/evt_01H...
metadata:
  environment: test
data: {}
```

`source_event_type` always preserves the upstream string. `event_type` is a MoneyTrace canonical enum. A missing optional amount is `null`; it is never inferred by the adapter.

### 8.2 Canonical mapping

| Canonical event | Upstream basis | Classification |
|---|---|---|
| `OrderCreated` | Successful Orders API response/fetch or synthetic OMS event | Test API available; not claimed as a webhook |
| `OrderPaid` | Public `order.paid` webhook/fetch projection | Definitely available in payment Test Mode |
| `PaymentAuthorized` | Public `payment.authorized` webhook/fetch | Definitely available in payment Test Mode |
| `PaymentCaptured` | Public `payment.captured` webhook/fetch | Definitely available in payment Test Mode |
| `PaymentFailed` | Public `payment.failed` webhook/fetch | Definitely available in payment Test Mode |
| `RefundCreated/Processed/Failed` | Public refund API/webhook/fetch | Test API available; reversal proof still contract-dependent |
| `TransferCreated` | Route transfer API response/fetch | Available with Route/account limitations; synthetic fallback |
| `TransferProcessed` | Public `transfer.processed` Route webhook/fetch | Available with Route/account limitations |
| `SettlementCreated` | Settlement fetch/adapter observation | Canonical observation, not a claimed Razorpay webhook |
| `SettlementProcessed` | Public `settlement.processed` webhook/fetch with explicit scope | Available with limitations; not bank proof |
| `SettlementObserved` | MoneyTrace normalization of a fetched or synthetic settlement record | Internal canonical event, never presented as an upstream Razorpay event |
| `BankCreditObserved` | Signed synthetic bank connector | Synthetic required |
| `SellerReceivableOpened/Closed` | Signed synthetic ERP connector | Synthetic required |
| `RecoveryScheduled/Suppressed` | Signed synthetic recovery connector | Synthetic required |
| `AgentResultClaimed` | Agent Results API | MoneyTrace internal event |

Do not implement undocumented Razorpay webhook strings. Route documentation has historically shown inconsistent failure-event wording; preserve raw values and add a mapping only after validating the actual public fixture/account behavior. Failure testing can use `SyntheticTransferFailed` from the synthetic adapter.

### 8.3 Delivery, dedupe, replay, and evolution

- Exact duplicate key: `(tenant_id, source_system, source_event_id)` where a source ID exists. Same ID/same raw hash returns duplicate success; same ID/different hash is quarantined with `409` for direct ingestion.
- Fallback key: `(tenant, source, entity_type, entity_id, source_event_type, event_time, raw_hash)`. It prevents exact row repeats but does not collapse distinct equal-value business events.
- Store both event time and ingestion time. Current entity reducers use source version when available, otherwise explicit state precedence plus timestamps. Every accepted late event triggers affected expectation/case reevaluation.
- Replay reads sealed journal records into a named/versioned projector and never publishes action-dispatch jobs. Replay results are compared with a projection manifest before swap.
- Source schemas are adapter-versioned; canonical schemas are independently versioned. Adapters perform explicit translation. Old raw evidence and old canonical versions remain readable.
- Unknown critical enum values are quarantined or projected as `UNKNOWN_SOURCE_STATE`; they are never coerced to success.

## 9. State machines

### 9.1 Financial outcome

```text
EXPECTED
  -> OBSERVED_UNVERIFIED | DIVERGED | UNRESOLVED
OBSERVED_UNVERIFIED
  -> VERIFIED | DIVERGED | UNRESOLVED
DIVERGED
  -> ACTION_PENDING | OBSERVED_UNVERIFIED | VERIFIED | UNRESOLVED
ACTION_PENDING
  -> OBSERVED_UNVERIFIED | DIVERGED | UNRESOLVED
VERIFIED
  -> REVERSED
REVERSED
  -> ACTION_PENDING | OBSERVED_UNVERIFIED | UNRESOLVED
UNRESOLVED
  -> OBSERVED_UNVERIFIED | DIVERGED
```

`DIVERGED -> VERIFIED` is allowed only when authoritative late evidence proves the original obligation without remediation. `VERIFIED` requires required-evidence coverage 100%, sufficient field authority, zero blocking contradictions, amount/currency/identity/time checks, effect verification where applicable, unique reconciliation, and observed receivable closure. `REVERSED` is reached only through authoritative refund/reversal/dispute evidence. It cannot go directly back to `VERIFIED`.

Every transition uses optimistic versioning in one transaction with its evidence/contract/reason. Forbidden transitions return `409 OUTCOME_TRANSITION_FORBIDDEN`.

### 9.2 Agent result claim

```text
PENDING -> VERIFIED | PARTIALLY_VERIFIED | REJECTED | UNRESOLVED
VERIFIED | PARTIALLY_VERIFIED -> REVERSED
UNRESOLVED -> VERIFIED | PARTIALLY_VERIFIED | REJECTED
```

Claim evaluation never changes the financial outcome by itself. The opening claim becomes `VERIFIED` only inside its observation window if the retained-value contract passes; the later full refund moves it to `REVERSED` and verified incremental amount to zero.

### 9.3 Plan, approval, action, and verification

```text
PLAN: DRAFT -> PROPOSED -> POLICY_DENIED | APPROVAL_REQUIRED | AUTHORIZED
APPROVAL: REQUESTED -> APPROVED | REJECTED | EXPIRED | INVALIDATED
ACTION: AUTHORIZED -> RESERVED -> DISPATCHING
        -> ACKNOWLEDGED | OUTCOME_UNKNOWN | FAILED
ACKNOWLEDGED | OUTCOME_UNKNOWN -> VERIFICATION_PENDING
VERIFICATION_PENDING -> EFFECT_VERIFIED | EFFECT_FAILED | TIMED_OUT | EFFECT_REVERSED
```

An unknown outcome is not a failed action and is never retried with a new idempotency key. It is fetched/reconciled until the contract decides success, failure, or timeout.

### 9.4 Approval decision basis and invalidation

```text
decision_basis_hash = SHA256(canonical_json({
  tenant_id, case_id, case_version,
  plan_id, plan_version, plan_hash,
  evidence_set_hash,
  policy_bundle_version, policy_decision_id,
  action_type, target, amount_impact_minor, currency,
  verification_contract_key, verification_contract_version,
  required_role, expires_at
}))
```

Approval is invalid if any hashed field changes, blocking evidence arrives, the case enters conflict/reversal, the approver loses tenant/role authority, separation of duties is violated, or it expires. The executor rebuilds and compares the hash inside the same transaction that reserves idempotency.

## 10. MoneyTrace API contracts

All routes are proposed MoneyTrace APIs. JSON money fields are decimal strings. Every response includes `request_id`; mutations return the new resource version.

| Endpoint | Request/response and validation | Authorization/idempotency | Errors and emitted event |
|---|---|---|---|
| `POST /v1/events` | Canonical/signed adapter event; `202 {event_id,status}` | Connector role; source key/header | `400/401/403/409`; `EvidenceAccepted` or conflict |
| `POST /v1/webhooks/razorpay` | Raw body; adapter derives tenant/account/event | HMAC-SHA256 signature on raw body; Razorpay event ID dedupe | `400/401/409`; canonical mapped event |
| `POST /v1/imports` | Dataset manifest/file; async import ID | Demo operator; manifest idempotency | `400/413/422`; `ImportAccepted` |
| `GET /v1/cases` | Cursor pagination and allowlisted filters/sort | Viewer in tenant | `400/403`; none |
| `GET /v1/cases/:id` | Case, outcome, projections, plan/policy summary | Viewer in same tenant | `403/404`; none |
| `GET /v1/cases/:id/money-path` | Expected/observed nodes, typed edges, linear alternative | Viewer; candidate visibility role-filtered | `403/404`; none |
| `POST /v1/cases/:id/investigations` | Optional `expected_case_version`; `202 investigation` | Investigator; key=`case:evidence:prompt` | `409/422/503`; `InvestigationRequested` |
| `POST /v1/cases/:id/evaluate-policy` | Current plan ID/version | Case manager; decision input hash | `409/422`; `PolicyEvaluated` |
| `POST /v1/cases/:id/request-approval` | Plan ID and expected versions | Case manager; one open request per basis | `409/422`; `ApprovalRequested` |
| `POST /v1/cases/:id/approve` | Approval ID, decision-basis hash, reason | Finance approver; no preparer self-approval | `403/409/422`; `ApprovalDecided` |
| `POST /v1/cases/:id/reject` | Approval ID/hash/reason | Finance approver | `403/409/422`; `ApprovalDecided` |
| `POST /v1/cases/:id/execute` | Plan ID + basis hash | Executor role; stable action idempotency key | `403/409/422`; `ActionReserved` |
| `GET /v1/cases/:id/verification` | Current verification contract/run/evidence | Viewer | `403/404`; none |
| `POST /v1/actions/:id/verification-checks` | Expected verification version | Worker/operator; evaluation-key dedupe | `409/422`; `VerificationEvaluated` |
| `GET /v1/cases/:id/audit` | Cursor/filter/redaction profile | Auditor/viewer as policy allows | `403/404`; none |
| `POST /v1/agent-results` | Claim ID, tenant subject, agent, amount, currency, type, correlation, claim/evidence times, evidence refs, schema | Agent connector; unique external claim ID | `400/409/422`; `AgentResultClaimed` |
| `GET /v1/agent-results/:id` | Claim plus evaluations and verified amount | Viewer in tenant | `403/404`; none |
| `POST /v1/demo/reset` | Seed ID and confirmation | Demo operator; demo env only | `403/409`; `DemoReset` |
| `POST /v1/demo/scenarios/:id/advance` | Expected scenario step/version | Demo operator; step key | `403/409`; scenario events |

Standard error codes include `TENANT_SCOPE_REQUIRED`, `SCHEMA_INVALID`, `EVIDENCE_CONFLICT`, `VERSION_CONFLICT`, `POLICY_DENIED`, `APPROVAL_STALE`, `IDEMPOTENCY_BODY_CONFLICT`, `OUTCOME_UNKNOWN`, `CURRENCY_MISMATCH`, `RECONCILIATION_AMBIGUOUS`, and `VERIFICATION_INCOMPLETE`. Retriability is explicit.

## 11. Razorpay Test Mode integration plan

The classifications below are based only on current public documentation as of this document date.

| Capability | Classification | Buildathon use |
|---|---|---|
| Orders create/fetch/update and payments-for-order | Definitely available with Test API keys | Create/fetch a payment anchor or import captured fixtures |
| Payments capture/fetch and payment webhooks | Definitely available in Test Mode | Primary real test integration; never collect via Payments API itself |
| Test webhooks, signature validation, duplicate event header, out-of-order delivery | Definitely documented | Validate raw body, use `x-razorpay-event-id`, do not assume order |
| Refund API/webhooks | Definitely available with Test API keys | Optional opening-moment source; synthetic fallback keeps demo deterministic |
| Route linked accounts and transfers | Available with account/product activation and Test Mode limitations | Adapter capability check at startup; use synthetic Route adapter if unavailable |
| Route transfers from orders/payments | Test simulation is publicly described; order transfers are API-only | Stretch integration, not a demo dependency |
| Direct Route transfer | On-demand feature; idempotency documented only for Direct Transfers | Not required; never use for real-money Buildathon execution |
| Route transfer/settlement webhook | Publicly documented, but account and scenario dependent | Consume if received; preserve account and recipient scope |
| Merchant settlements API/webhook | Publicly documented | Read-only compatibility test; not bank-credit proof |
| Combined settlement recon endpoint | Publicly documented and includes payments/refunds/transfers/adjustments | Contract test/read-only enrichment; do not depend on meaningful Test data |
| Real bank credit/UTR confirmation | Not possible in Test Mode because no real money settles | Signed synthetic bank adapter required |
| Real ERP/recovery/receivable state | Outside Razorpay public payments API | Synthetic adapters required |

Adapter rules:

1. `RazorpayAdapter` depends on generated/validated DTOs, not domain entities.
2. It stores raw payload first, then maps allowlisted event types.
3. API fetch results and webhook snapshots are different evidence records.
4. Credentials are server-only secret references; `rzp_live_` keys cause startup failure in demo mode.
5. Webhook acknowledgement occurs after durable evidence acceptance and before heavy processing.
6. Direct Transfer idempotency support must not be generalized to all Route transfer endpoints.
7. Any unavailable capability is reported in Data Health and switches to the explicit synthetic adapter; it is never silently faked as Razorpay.

Public references:

- https://razorpay.com/docs/api/orders/
- https://razorpay.com/docs/api/payments/
- https://razorpay.com/docs/webhooks/validate-test/
- https://razorpay.com/docs/payments/route/integration-guide/
- https://razorpay.com/docs/api/payments/route/
- https://razorpay.com/docs/api/payments/route/direct-transfers-idempotent-request/
- https://razorpay.com/docs/webhooks/route/
- https://razorpay.com/docs/webhooks/settlements/
- https://razorpay.com/docs/api/settlements/fetch-recon/
- https://razorpay.com/docs/payments/dashboard/test-live-modes/

## 12. AI architecture

### Responsibilities

The model may classify ambiguous cases, summarize evidence, identify contradictions/missing evidence, select a registered plan template, fill non-authoritative text/parameters, and explain deterministic results.

The model may not calculate authoritative money, create links, generate SQL, retrieve outside a typed evidence set, invent evidence, choose unregistered tools, set policy, approve, execute, verify, reconcile, close a receivable, or alter any state machine directly.

### Investigation pipeline

```text
case + version
-> deterministic traversal policy
-> sealed evidence set + authority labels + deterministic amounts
-> prompt template with untrusted-data delimiters
-> provider-neutral ModelGateway timeout
-> JSON schema validation
-> evidence-ID/citation validation
-> allowed finding/plan enum validation
-> persist valid finding or abstention
```

Input text is untrusted evidence, never instruction. The model receives no credentials, raw card/bank secrets, hidden labels, arbitrary database access, or tool executor.

Output includes `finding_code`, summary, supporting/contradicting evidence IDs, missing evidence types, confidence band, evidence coverage, safe-to-act recommendation, plan template ID, and explanation. `exposure_amount_minor` and currency are inserted by deterministic application code after output validation.

Timeout: one normal attempt and at most one retry for retryable provider/format failure when no side effect exists. Persist the failure class. Degraded mode continues ingestion, projection, invariants, case creation, policy, and manual evidence review with a rules-only explanation.

## 13. Financial safety model

Every action follows this unskippable sequence:

```text
validated registered plan
-> deterministic policy (default DENY)
-> approval when required
-> rebuild decision basis
-> validate approval/role/expiry/separation of duties
-> reserve stable idempotency key
-> write outbox in the same transaction
-> typed adapter call
-> ACKNOWLEDGED / FAILED / OUTCOME_UNKNOWN
-> authoritative effect verification
-> unique reconciliation
-> receivable closure observation
-> financial outcome transition
```

The Buildathon tool allowlist contains only `SUPPRESS_SIMULATED_RECOVERY`, `SIMULATE_TRANSFER_REMEDIATION`, `REQUEST_MORE_EVIDENCE`, and `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION`. No generic HTTP tool exists.

Policy inputs are exact: tenant, environment, actor/role, action type, authority level, amount/currency, target, merchant tier, customer impact, evidence coverage, contradiction count, case/outcome versions, approval status, and policy version. Missing values deny.

## 14. Security model

- Authentication: production-ready interface for OIDC/session auth; seeded demo users only in demo mode.
- Authorization: tenant + resource + role + action + amount + environment checks in service methods, not just routes.
- Tenant isolation: composite keys/scoped repositories/jobs; cross-tenant fixtures and negative tests.
- Razorpay secrets: environment/secret manager only, server-side, redacted logs, never model/UI/source. Demo rejects live-key prefixes.
- Webhooks: preserve raw bytes, validate HMAC-SHA256 with the configured webhook secret, then parse; rotate secrets with bounded previous-key support.
- Input: schema validation, request limits, enum allowlists, CSV formula neutralization on export, no arbitrary URLs/SQL.
- Prompt injection: untrusted source delimiters, minimal fields, no executor, schema/citation/plan validation.
- Egress: allowlist Razorpay/model endpoints in production; synthetic adapters are in-process or local.
- Audit: append-only entries for evidence, findings, policy, approval, action, verification, reconciliation, manual links, and admin changes.
- Rate limits: source/tenant route limits plus global protection; webhook limit policy must still allow legitimate Razorpay retries.
- Privacy: synthetic PII only; role-redacted raw payloads; retention policy fields; avoid sensitive identifiers in trace keys.
- Least privilege: the API can reserve actions; only the worker has adapter credentials; the model has neither.

## 15. Testing strategy

### Unit priority P0

- `bigint` equations, signed adjustments, rational allocation, rounding residual, currency rejection.
- All financial-outcome, claim, approval, action, and case transition guards.
- Case/evidence/action/reconciliation idempotency key generation.
- Default-deny policy and approval invalidation.
- Exact/ambiguous/contradictory UTR-recipient-date-amount matching.

### Integration priority P0/P1

- Raw webhook HMAC, Razorpay event-header dedupe, conflicting duplicate quarantine.
- Journal transaction, projector checkpoints/replay, out-of-order non-regression.
- Outbox crash between reservation/dispatch/acknowledgement.
- Razorpay adapter contract fixtures for orders, payments, refunds, Route, settlement.
- AI schema/citation validator and rules-only degradation.
- Reconciliation locks/uniqueness and receivable closure sequencing.

### End-to-end P0

1. ₹1,20,000 claim -> observed recovery -> full refund -> `REVERSED`, verified incremental ₹0.
2. ₹5,00,000 capture -> ₹4,55,000 missing transfer -> duplicate recovery blocked -> approval -> one simulated action -> settlement + bank -> receivable close -> `VERIFIED`.
3. Same amount with conflicting UTR/date/seller -> abstain and retain ₹4,55,000 exposure.
4. Replay duplicate and restart worker after dispatch -> one action and one allocation only.

### Adversarial P0/P1

- Prompt injection in merchant note; nonexistent citation; hidden-label access attempt.
- Same source ID/different amount; currency mismatch; same amount for two sellers.
- Stale plan/evidence/policy/case approval; self-approval; expired role.
- Timeout after remote acceptance; new-key retry attempt; late reversal after closure.
- Cross-tenant case, event, job, evidence, action, and audit access.
- CSV injection, oversized payload, malformed timestamp, unknown source status.

### Performance and demo reliability

- Deterministically import 500+ lifecycle records and assert scenario distribution.
- Measure, do not claim: import duration, projection lag, case query p95, investigation latency, verification latency.
- Reset repeatedly and compare database manifest hash.
- Run the timed demo offline with synthetic/model-stub fallback and preserve a backup recording.

## 16. Repository structure

Use one TypeScript package; avoid workspace/monorepo machinery until a real need exists.

```text
MoneyTrace PRD.md
package.json
tsconfig.json
vite.config.ts
src/
  contracts/              # API, event, model, tool schemas
  domain/                 # money values, equations, state machines
  modules/
    identity/
    ingestion/
    evidence/
    projection/
    expectations/
    invariants/
    cases/
    provenance/
    investigation/
    agent-claims/
    policy/
    approvals/
    actions/
    verification/
    reconciliation/
    audit/
    demo/
  integrations/
    razorpay/
    synthetic-bank/
    synthetic-erp/
    synthetic-oms/
    synthetic-agent/
    synthetic-recovery/
  api/
    routes/
    middleware/
    server.ts
  worker/
    jobs/
    worker.ts
  web/
    app/
    features/
    components/
    routes/
  config/
db/
  migrations/
  seeds/
fixtures/
  public-shaped/          # sanitized Razorpay public/test fixtures
  synthetic/
  hidden-ground-truth/    # test/evaluation only; never runtime/model imports
tests/
  unit/
  integration/
  e2e/
  adversarial/
docs/
  MONEYTRACE_ARCHITECTURE_HANDOFF.md
  CLAUDE_CODE_TASKS.md
  CODEX_REVIEW_CHECKLIST.md
  adr/
```

Enforce import boundaries: `domain` imports no API, DB, model, or integration code; integrations depend on contracts, not module internals; web imports browser-safe contracts only; hidden ground truth is blocked from production builds.

## 17. Strictly ordered implementation roadmap

Each phase is review-gated. Do not start a later phase until the acceptance criteria and rollback checkpoint pass.

### Phase 0 - contracts and repository skeleton

- **Objective:** establish one TypeScript package, architectural boundaries, schemas, tooling, and ADRs.
- **Files/modules:** root config, `src/contracts`, empty module interfaces, `docs/adr`.
- **Dependencies:** none.
- **APIs/DB/events:** OpenAPI/event/model/tool schema definitions only; no DB.
- **Tests:** schema compile tests and forbidden-import checks.
- **Acceptance:** clean build/test/lint; money fields are strings in APIs; live Razorpay key guard specified.
- **Risk:** premature framework spread. **Rollback:** revert skeleton before persisted data exists.

### Phase 1 - deterministic financial kernel

- **Objective:** implement money values, allocation equation, invariant outputs, and independent state machines.
- **Files/modules:** `src/domain`.
- **Dependencies:** phase 0.
- **APIs/DB/events:** none.
- **Tests:** exhaustive transition tables, money/rounding/currency/property tests.
- **Acceptance:** no floating arithmetic; demo equations and reversal behavior pass.
- **Risk:** ambiguous semantics. **Rollback:** pure module has no migration/effect.

### Phase 2 - PostgreSQL evidence journal and durable jobs

- **Objective:** migrations, tenant-scoped repositories, raw evidence acceptance, dedupe/conflict, projector/outbox primitives.
- **Files/modules:** `db`, identity/ingestion/evidence/audit base, worker base.
- **Dependencies:** phases 0-1, PostgreSQL.
- **APIs/DB/events:** `POST /v1/events`; core tables; `EvidenceAccepted/Duplicate/Conflict`.
- **Tests:** transactional ingest, HMAC fixture, concurrent duplicate, replay guard.
- **Acceptance:** accepted event survives restart; conflict never projects; no unscoped repository.
- **Risk:** migration mistakes. **Rollback:** down migration only on disposable demo DB; otherwise forward fix.

### Phase 3 - projections, expectations, outcomes, and cases

- **Objective:** deterministic ingest-to-case vertical slice without AI.
- **Files/modules:** projection, expectations, invariants, cases.
- **Dependencies:** phases 1-2.
- **APIs/DB/events:** case list/detail; projection/expectation/outcome/case tables and events.
- **Tests:** missing transfer, duplicate recovery, out-of-order, case dedupe, reversal reopen.
- **Acceptance:** seeded evidence creates one correct ₹4,55,000 case; replay is identical.
- **Risk:** status regression. **Rollback:** rebuild versioned projections from journal.

### Phase 4 - relational provenance and evidence contracts

- **Objective:** typed links, candidate isolation, sealed evidence sets, expected/observed money path.
- **Files/modules:** provenance/evidence retrieval/case query.
- **Dependencies:** phase 3.
- **APIs/DB/events:** money-path endpoint; edge/evidence-set tables/events.
- **Tests:** traversal tenant/depth/cardinality limits, candidate conflict, evidence hash stability.
- **Acceptance:** case path and linear alternative cite every edge; false match remains candidate.
- **Risk:** graph scope growth. **Rollback:** drop/rebuild derived edges, never evidence.

### Phase 5 - deterministic synthetic dataset and demo reset

- **Objective:** 500+ subjects/records, hidden truth separation, reset/advance manifest.
- **Files/modules:** fixtures, seeds, demo module.
- **Dependencies:** phases 2-4.
- **APIs/DB/events:** demo reset/advance, synthetic source events.
- **Tests:** distribution/totals/manifest determinism, hidden-import check.
- **Acceptance:** repeated reset yields identical manifest and all three moments.
- **Risk:** fixture drift. **Rollback:** select prior immutable seed version.

### Phase 6 - Razorpay Test Mode adapter

- **Objective:** public webhook/API mapping behind capability checks, never a demo dependency.
- **Files/modules:** integrations/razorpay, webhook route, fixtures.
- **Dependencies:** phases 2-4; optional test credentials.
- **APIs/DB/events:** Razorpay webhook endpoint and mapped canonical events.
- **Tests:** official-shaped contract fixtures, raw signature, duplicates, out-of-order, settlement scope.
- **Acceptance:** test payment event maps correctly; absent Route capability visibly falls back synthetic.
- **Risk:** account-specific availability. **Rollback:** disable adapter flag; preserve synthetic path.

### Phase 7 - AI investigation

- **Objective:** bounded evidence-to-validated-finding flow and rules-only degradation.
- **Files/modules:** investigation/model gateway.
- **Dependencies:** phases 4-5.
- **APIs/DB/events:** investigation endpoint/tables/events.
- **Tests:** schema, citation, plan enum, injection, timeout, abstention.
- **Acceptance:** unsupported claim/action rates zero on held-out set; provider outage does not block cases.
- **Risk:** flaky model. **Rollback:** model-stub/rules-only mode; retain deterministic cases.

### Phase 8 - policy, approval, action ledger, and simulator

- **Objective:** default-deny plan flow through immutable approval to one simulated effect.
- **Files/modules:** policy, approvals, actions, synthetic recovery/Route.
- **Dependencies:** phases 1-5; AI is optional.
- **APIs/DB/events:** policy/approval/execute endpoints; plan/policy/approval/action/outbox tables/events.
- **Tests:** every invalidation input, self-approval, concurrent execute, unknown outcome.
- **Acceptance:** one reservation/effect under retries; no tool bypass; live money impossible.
- **Risk:** approval/action race. **Rollback:** disable action worker feature flag; reservations remain auditable.

### Phase 9 - verification, reconciliation, agent claims, and reversals

- **Objective:** close both Prove-It economic loops with authoritative contracts.
- **Files/modules:** verification, reconciliation, agent claims, synthetic bank/ERP.
- **Dependencies:** phases 3-5 and 8.
- **APIs/DB/events:** verification/agent-result endpoints; contracts/runs/allocations/claims.
- **Tests:** unique match, conflicting UTR, refund reversal, partial claim, late evidence.
- **Acceptance:** main case verifies only after bank+allocation+ERP close; ₹1.2L claim reverses to zero; conflict abstains.
- **Risk:** circular close logic. **Rollback:** leave cases verification-pending; never force verified.

### Phase 10 - frontend operational experience

- **Objective:** overview, queue, case path/evidence, policy/approval, verification, audit, Data Health.
- **Files/modules:** `src/web`, public Blade integration.
- **Dependencies:** phases 3-9 APIs.
- **APIs/DB/events:** no new domain behavior.
- **Tests:** accessibility, keyboard, money formatting, degraded/unknown outcome, visual smoke.
- **Acceptance:** facts/AI/policy/action/verification are visually distinct; no fake thinking; conflict is explicit.
- **Risk:** UI fakes backend state. **Rollback:** hide incomplete feature route, not substitute mocked success.

### Phase 11 - Prove-It orchestration, adversarial suite, and observability

- **Objective:** one-command demo, timed story, metrics, runbook, final hardening.
- **Files/modules:** demo, tests, metrics/logging, docs.
- **Dependencies:** all prior phases.
- **APIs/DB/events:** scenario controller and read-only metrics; no new financial semantics.
- **Tests:** complete E2E, worker crash, duplicates, stale approval, injection, cross-tenant, deterministic reset.
- **Acceptance:** three moments run in under five minutes, duplicate replay is visible, offline fallback works, all P0 tests pass.
- **Risk:** last-minute semantic changes. **Rollback:** pin seed/schema/model-stub versions and use recorded backup.

The executable task cards for these phases are in `docs/CLAUDE_CODE_TASKS.md`.

## 18. Observability contract

Every structured log includes tenant-safe request/trace/correlation/event/case/action IDs, module, operation, result, latency, and retry class. It excludes raw payloads, secrets, PII, and bank/card data.

Required technical metrics: event accept rate/lag, duplicates/conflicts, projector lag/failures, queue depth, API latency/errors, model latency/errors, action unknown outcomes, verification backlog.

Required money metrics include currency labels: unresolved exposure, divergent value by control/age, action-pending value, verification-timeout value, restored amount, reversed recovery amount, prevented duplicate collection, reconciliation difference, false-match value. Never sum currencies without explicit conversion policy.

## 19. Top technical risks

| Risk | Likelihood/impact | Mitigation and tripwire |
|---|---|---|
| Route/Test Mode differs by account capability | High/medium | Capability check; synthetic adapter is primary deterministic path |
| Settlement mistaken for bank credit | Medium/critical | Separate event types/authority; contract requires bank line |
| Duplicate/unknown action creates double effect | Medium/critical | reservation+outbox+stable key+no blind retry+reconciliation |
| False entity/UTR match closes wrong receivable | Medium/critical | direct IDs first; strict one-to-one; conflict abstention |
| Approval goes stale after evidence/policy change | Medium/critical | decision-basis hash rebuilt atomically at reservation |
| Arithmetic double counts platform/fees/taxes | Medium/high | separate contracts and named buckets; conservation tests |
| Out-of-order event regresses state | High/high | status precedence/revision reducers; historical append; reevaluate |
| Model invents evidence/action | Medium/high | bounded sealed set; citation/schema/enum validation; no executor |
| Tenant leak through joins/jobs/cache | Low/critical | explicit tenant context/composite checks/adversarial tests |
| Demo depends on external availability/model | High/high | deterministic seed, synthetic adapters, model stub, offline path |
| Hidden labels leak into model/runtime | Medium/high | separate directory/build imports/static and runtime tests |
| Audit/evidence “immutability” is overstated | Medium/medium | application append-only; accurately document prototype limits |

## 20. Codex review checklist

The permanent review checklist is `docs/CODEX_REVIEW_CHECKLIST.md`. A phase cannot be merged with an applicable unchecked P0 item.

## 21. Final rules Claude Code must not violate

1. Do not add a real-money transfer, payout, refund, or customer collection path.
2. Do not let an AI output write authoritative amounts, links, states, policy, approval, verification, or reconciliation.
3. Do not use floating point for money or omit currency from an amount.
4. Do not parse a Razorpay webhook before validating the signature over raw bytes.
5. Do not assume webhook order or exactly-once delivery.
6. Do not overwrite raw evidence or a conflicting duplicate.
7. Do not mark `settlement.processed` as bank credit.
8. Do not promote a candidate relationship to verified merely because amount/date look similar.
9. Do not execute an unregistered action or a plan without a current default-deny policy decision.
10. Do not approve a mutable target; bind and recheck the complete decision basis.
11. Do not retry an unknown financial effect with a new idempotency key.
12. Do not let one bank line or economic value close more than one obligation.
13. Do not mark an outcome verified without every required authoritative item and zero blockers.
14. Do not erase history after a refund/reversal; append reversal and reopen.
15. Do not query or process tenant-owned data without an explicit tenant context.
16. Do not expose secrets to the frontend, logs, model, fixtures, or source control.
17. Do not allow replay to dispatch actions.
18. Do not expose hidden ground truth to runtime or the model.
19. Do not fake backend progress, AI thinking, verification, or financial metrics in the UI.
20. Do not add infrastructure or service boundaries without a measured need and an ADR.

