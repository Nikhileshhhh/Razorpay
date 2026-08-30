# MoneyTrace ordered Claude Code task cards

Execute tasks strictly in order. Stop for review after each task. The controlling architecture is `docs/MONEYTRACE_ARCHITECTURE_HANDOFF.md`; the PRD remains the product source of truth. When they differ on financial safety, use the stricter rule and raise an ADR rather than guessing.

## TASK MT-001

**TASK ID:** MT-001  
**TITLE:** Scaffold the single-package TypeScript repository  
**OBJECTIVE:** Establish build, lint, test, API, worker, web, migration, and import-boundary foundations without business behavior.  
**CONTEXT:** The repository currently contains documentation only. Build a modular monolith, not microservices or an artificial workspace.  
**PRD REQUIREMENTS:** Sections 15, 26, 29; Buildathon modular monolith.  
**FILES TO TOUCH:** Root package/config files; empty `src/{contracts,domain,modules,integrations,api,worker,web,config}`; `db`, `fixtures`, `tests`; `docs/adr/0001-architecture.md`.  
**FILES NOT TO TOUCH:** `MoneyTrace PRD.md`; architecture/task/checklist documents.  
**DEPENDENCIES:** Supported Node LTS, PostgreSQL for later tasks.  
**IMPLEMENTATION STEPS:** Configure TypeScript strict mode, Fastify, React/Vite, Vitest, Playwright, Drizzle, Zod/OpenAPI, pg-boss, Pino; create explicit API/worker/web entry points; add import-boundary checks; add environment schema with demo/live-key guard.  
**TESTS:** Empty build/lint/unit command; forbidden imports (`domain` cannot import DB/API/model; web cannot import server code); invalid env tests.  
**ACCEPTANCE CRITERIA:** One documented setup command; all checks pass; no runtime business logic; no Docker/Kafka/Redis/graph DB.  
**FAILURE MODES:** Framework conflict, browser bundle includes server secrets, unchecked environment variables.  
**SECURITY REQUIREMENTS:** Reject `rzp_live_` credentials in demo environment; never print secret values.  
**DONE WHEN:** CI-equivalent local commands pass and ADR records every dependency rationale.

## TASK MT-002

**TASK ID:** MT-002  
**TITLE:** Define versioned contracts and canonical event schemas  
**OBJECTIVE:** Make API, canonical events, errors, model outputs, registered plans, and tools explicit before persistence.  
**CONTEXT:** Money amounts cross JSON boundaries as decimal strings and upstream Razorpay strings remain preserved.  
**PRD REQUIREMENTS:** FR-ING-001/003, FR-AI-002, sections 18-19.  
**FILES TO TOUCH:** `src/contracts/**`, contract fixtures/tests, generated OpenAPI setup.  
**FILES NOT TO TOUCH:** Domain calculations, DB migrations, UI.  
**DEPENDENCIES:** MT-001.  
**IMPLEMENTATION STEPS:** Implement Zod schemas for canonical envelope, entity refs, source authority, evidence, cases, findings, agent claims, plans, policy, approval, action, verification, reconciliation, audit, and error model; enumerate only registered events/actions; add schema versions.  
**TESTS:** Valid/invalid fixtures; unknown critical enums reject; money `number` rejects; missing tenant/currency rejects where material.  
**ACCEPTANCE CRITERIA:** Contract snapshots are stable; OpenAPI emits; no undocumented Razorpay webhook is represented as upstream fact.  
**FAILURE MODES:** Optional fields hide safety inputs; canonical/source event conflation; JSON precision loss.  
**SECURITY REQUIREMENTS:** Schemas exclude secrets and unnecessary PII; untrusted text is bounded.  
**DONE WHEN:** Every future route/event/tool/model response has a versioned schema and passing contract tests.

## TASK MT-003

**TASK ID:** MT-003  
**TITLE:** Implement the deterministic financial kernel  
**OBJECTIVE:** Provide pure `Money`, allocation, invariant result, and state-machine primitives.  
**CONTEXT:** The model and JavaScript floating-point arithmetic must never be financial authority.  
**PRD REQUIREMENTS:** Sections 8, 14, 18, 23, 29; financial outcome states.  
**FILES TO TOUCH:** `src/domain/money/**`, `src/domain/invariants/**`, `src/domain/state-machines/**`, unit tests.  
**FILES NOT TO TOUCH:** DB, routes, integrations, web, model gateway.  
**DEPENDENCIES:** MT-002.  
**IMPLEMENTATION STEPS:** Use `bigint`; INR currency registry; rational-rate half-even allocation with residual bucket; signed adjustment types; conservation equation; implement financial-outcome, case, claim, plan/approval/action/verification guards as separate machines.  
**TESTS:** Table-driven transitions; property tests for conservation/idempotent equations; ₹5L/₹4.55L and ₹1.2L/refund examples; overflow, negative, currency, rounding tests.  
**ACCEPTANCE CRITERIA:** No float/`number` money; forbidden transitions fail; exact demo equations pass.  
**FAILURE MODES:** Double-counted fees/taxes, implicit currency conversion, reversible history overwritten.  
**SECURITY REQUIREMENTS:** Pure code has no I/O or model dependency.  
**DONE WHEN:** Financial P0 unit suite passes independently of infrastructure.

## TASK MT-004

**TASK ID:** MT-004  
**TITLE:** Create tenant-scoped PostgreSQL schema and repositories  
**OBJECTIVE:** Persist all architectural aggregates with required keys, FKs, indexes, versions, and append-only controls.  
**CONTEXT:** PostgreSQL is the prototype's sole durable infrastructure dependency.  
**PRD REQUIREMENTS:** Sections 17, 20-21, FR-AUD-001.  
**FILES TO TOUCH:** `db/migrations/**`, `src/modules/identity/**`, shared DB repository/transaction layer, integration tests.  
**FILES NOT TO TOUCH:** UI, Razorpay/model/action implementations.  
**DEPENDENCIES:** MT-003.  
**IMPLEMENTATION STEPS:** Implement tables/constraints from architecture section 7; require `TenantContext`; add optimistic versions and append-only evidence/audit permissions or triggers; define forward migrations and disposable-demo reset.  
**TESTS:** Migrate up from empty; FK/unique/check tests; update/delete evidence denial; cross-tenant negative repository tests; bigint round trip.  
**ACCEPTANCE CRITERIA:** No tenant-owned repository call lacks tenant; migration review documents specialized SQL.  
**FAILURE MODES:** Global ID join leaks tenant, ORM silently coerces bigint, rollback deletes accepted evidence.  
**SECURITY REQUIREMENTS:** Least-privileged application DB role; no raw SQL built from input.  
**DONE WHEN:** Schema contract and isolation tests pass on a fresh PostgreSQL database.

## TASK MT-005

**TASK ID:** MT-005  
**TITLE:** Build append-only ingestion, dedupe, conflict quarantine, and audit acceptance  
**OBJECTIVE:** Durably accept source evidence before projection and handle exact/conflicting duplicates safely.  
**CONTEXT:** Razorpay webhooks are at-least-once and can be out of order.  
**PRD REQUIREMENTS:** FR-ING-001 through 007; FR-AUD-001; CTRL-06.  
**FILES TO TOUCH:** `src/modules/{ingestion,evidence,audit}/**`, `src/api/routes/events.ts`, migrations if necessary, tests.  
**FILES NOT TO TOUCH:** Projectors, actions, UI, AI.  
**DEPENDENCIES:** MT-002, MT-004.  
**IMPLEMENTATION STEPS:** Preserve raw bytes/row projection; SHA-256 hash; authenticate adapter/source; validate schema/tenant; insert journal+audit transactionally; exact duplicate response; conflict quarantine; enqueue projection job only for accepted non-conflict event.  
**TESTS:** Concurrent same ID/same body; same ID/different body; fallback dedupe; malformed/oversized input; restart after 202.  
**ACCEPTANCE CRITERIA:** Accepted evidence survives restart; conflict never reaches projector; duplicate metric/audit exists.  
**FAILURE MODES:** Acknowledge before commit, overwrite old payload, dedupe equal-value distinct events.  
**SECURITY REQUIREMENTS:** Source authentication before canonical projection; raw payload excluded from logs.  
**DONE WHEN:** Ingestion integration suite proves durable at-least-once safety.

## TASK MT-006

**TASK ID:** MT-006  
**TITLE:** Implement durable jobs, projector checkpoints, replay isolation, and current entity projections  
**OBJECTIVE:** Turn journal evidence into versioned entity history/current state without order regression or side effects.  
**CONTEXT:** Replay must rebuild projections but must never dispatch an action.  
**PRD REQUIREMENTS:** FR-ING-006/007, section 20.  
**FILES TO TOUCH:** `src/worker/**`, `src/modules/projection/**`, pg-boss/outbox setup, tests.  
**FILES NOT TO TOUCH:** Actions, AI, frontend.  
**DEPENDENCIES:** MT-005.  
**IMPLEMENTATION STEPS:** Add named/versioned idempotent projectors; source version/status precedence reducers; historical revisions/current pointer; checkpoint and late-event reevaluation hooks; replay mode with an action-topic denylist and manifest comparison.  
**TESTS:** Captured before authorized delivery; duplicate job; worker crash; replay twice; unknown source state; prove action topics cannot publish in replay.  
**ACCEPTANCE CRITERIA:** Current state never regresses; history contains both snapshots; projection is reproducible.  
**FAILURE MODES:** Ingestion order used as business order; old projector overwrites new; poison source blocks tenants.  
**SECURITY REQUIREMENTS:** Jobs carry explicit tenant and validate it on load.  
**DONE WHEN:** Projection/replay manifests are deterministic under duplicates and reordering.

## TASK MT-007

**TASK ID:** MT-007  
**TITLE:** Generate expectations and deterministic invariant evaluations  
**OBJECTIVE:** Create versioned seller obligations and run the six Buildathon controls without AI.  
**CONTEXT:** Expected outcome precedes anomaly detection.  
**PRD REQUIREMENTS:** FR-EXP-001-003, CTRL-01 through CTRL-06.  
**FILES TO TOUCH:** `src/modules/{expectations,invariants}/**`, rule fixtures, tests.  
**FILES NOT TO TOUCH:** Model, policy, action, web.  
**DEPENDENCIES:** MT-003, MT-006.  
**IMPLEMENTATION STEPS:** Implement versioned demo allocation rule; due/grace clock abstraction; invariant evaluator records; deterministic input/evaluation hashes; emit violations and reevaluate on late/reversal evidence.  
**TESTS:** Clean, missing transfer, settlement timeout, open receivable, duplicate recovery, conflicting UTR, duplicate replay.  
**ACCEPTANCE CRITERIA:** ₹5L input creates ₹4.55L seller expectation; clean cases do not open divergence; no model call.  
**FAILURE MODES:** Fee double count, wall-clock nondeterminism, old rule rewrites history.  
**SECURITY REQUIREMENTS:** Rule config is validated/versioned and cannot be edited by source evidence.  
**DONE WHEN:** All six control fixtures produce exact deterministic outcomes.

## TASK MT-008

**TASK ID:** MT-008  
**TITLE:** Implement financial-case identity and lifecycle  
**OBJECTIVE:** Convert violations/reversals into deduplicated, versioned case epochs with exposure and transitions.  
**CONTEXT:** Case workflow is independent from financial-outcome state.  
**PRD REQUIREMENTS:** FR-CASE-001-005, section 18.4.  
**FILES TO TOUCH:** `src/modules/cases/**`, case migrations/routes/tests.  
**FILES NOT TO TOUCH:** AI, actions, web feature screens.  
**DEPENDENCIES:** MT-007.  
**IMPLEMENTATION STEPS:** Deterministic key `(tenant,control,subject,expectation_version,window)`; active epoch; optimistic transitions; merge/suppress metadata; list/detail APIs with cursor pagination and allowlisted sorting.  
**TESTS:** Concurrent open, replay, merge, forbidden transition, reversal after reconciled, tenant pagination.  
**ACCEPTANCE CRITERIA:** One active case for the missing transfer; late reversal appends/reopens without erasing prior history.  
**FAILURE MODES:** Amount-only dedupe, cross-control merge, last-write-wins state race.  
**SECURITY REQUIREMENTS:** Case queries and IDs never bypass tenant authorization.  
**DONE WHEN:** Case lifecycle integration suite passes under concurrency and replay.

## TASK MT-009

**TASK ID:** MT-009  
**TITLE:** Build relational provenance, candidate links, evidence sets, and money paths  
**OBJECTIVE:** Provide evidence-backed expected-versus-observed traversal without a graph database.  
**CONTEXT:** Direct IDs are authoritative; fuzzy links remain candidate/contradicted.  
**PRD REQUIREMENTS:** FR-LINK-001-004, sections 16 and 19.5.  
**FILES TO TOUCH:** `src/modules/{provenance,evidence}/**`, money-path route, tables/indexes/tests.  
**FILES NOT TO TOUCH:** AI reasoning or action execution.  
**DEPENDENCIES:** MT-006, MT-008.  
**IMPLEMENTATION STEPS:** Typed edge registry; resolver provenance; candidate/review states; traversal allowlist/depth/cardinality/time/tenant bounds; sealed evidence set canonical hash; accessible linear path response.  
**TESTS:** Direct link, competing candidates, reject/confirm audit, traversal limit, candidate exclusion from authoritative closure, hash stability.  
**ACCEPTANCE CRITERIA:** Every displayed edge cites evidence; conflicts stay visible; no force-directed graph dependency.  
**FAILURE MODES:** Candidate silently promoted, traversal crosses tenant, mutable evidence set invalidates approval invisibly.  
**SECURITY REQUIREMENTS:** Role-based raw evidence redaction; no arbitrary graph query API.  
**DONE WHEN:** Demo case produces deterministic expected/observed paths and sealed evidence sets.

## TASK MT-010

**TASK ID:** MT-010  
**TITLE:** Generate deterministic synthetic data, hidden truth, and reset manifests  
**OBJECTIVE:** Produce the complete 500+ scenario corpus and deterministic Prove-It seed.  
**CONTEXT:** Hidden labels must be test-only and impossible to import in runtime/model code.  
**PRD REQUIREMENTS:** Section 24 and Buildathon goals.  
**FILES TO TOUCH:** `fixtures/synthetic/**`, `fixtures/hidden-ground-truth/**`, `db/seeds/**`, `src/modules/demo/**`, tests.  
**FILES NOT TO TOUCH:** Razorpay public fixtures; product semantics.  
**DEPENDENCIES:** MT-005 through MT-009.  
**IMPLEMENTATION STEPS:** Seed stable IDs/times/random source; create required scenario distribution, false candidates, duplicates/reordering; sign synthetic sources; build reset and step manifests; block hidden imports from production graph.  
**TESTS:** Distribution/totals, deterministic DB hash, no PII, no runtime hidden import, repeated reset, scenario-step idempotency.  
**ACCEPTANCE CRITERIA:** All three demo moments and 500+ data requirement are reproduced exactly.  
**FAILURE MODES:** Narrative totals hard-coded independently, hidden truth leaks, reset races worker.  
**SECURITY REQUIREMENTS:** Demo controls require demo environment/operator and cannot use live credentials.  
**DONE WHEN:** Reset twice produces identical manifest and P0 scenario assertions.

## TASK MT-011

**TASK ID:** MT-011  
**TITLE:** Implement the public Razorpay Test Mode adapter  
**OBJECTIVE:** Safely consume supported public payment/Route/settlement evidence without coupling core state to Razorpay shapes.  
**CONTEXT:** Account capabilities vary; synthetic adapters remain deterministic fallback.  
**PRD REQUIREMENTS:** Sections 2, 7, 19, 21; public-only evidence.  
**FILES TO TOUCH:** `src/integrations/razorpay/**`, webhook route, sanitized public-shaped fixtures/tests, Data Health capability projection.  
**FILES NOT TO TOUCH:** Financial kernel; hidden truth; action policy.  
**DEPENDENCIES:** MT-002, MT-005, MT-006.  
**IMPLEMENTATION STEPS:** Raw HMAC verification; store `x-razorpay-event-id`; map allowlisted orders/payments/refunds/transfer/settlement records; preserve upstream type/account/scope; implement read-only fetch adapter and startup capability checks; reject live-key prefix in demo.  
**TESTS:** Official-shaped payload contracts, duplicate/out-of-order, secret rotation, merchant vs recipient settlement scope, unavailable Route fallback.  
**ACCEPTANCE CRITERIA:** Test event maps to canonical contract; `settlement.processed` never emits bank credit; unavailable features are visible.  
**FAILURE MODES:** Parsed-body signature, guessed event ID, undocumented event mapping, live credential use.  
**SECURITY REQUIREMENTS:** Secrets server/worker only and redacted; webhook heavy work asynchronous.  
**DONE WHEN:** Adapter contract tests pass with no external account dependency and optional live Test Mode smoke is documented.

## TASK MT-012

**TASK ID:** MT-012  
**TITLE:** Implement bounded AI investigation and validation  
**OBJECTIVE:** Turn a sealed evidence set into a schema-valid, evidence-cited finding or explicit abstention.  
**CONTEXT:** Deterministic code injects money values; model stops at plan-template proposal.  
**PRD REQUIREMENTS:** FR-AI-001-005, section 13, evaluation targets.  
**FILES TO TOUCH:** `src/modules/investigation/**`, provider gateway, prompts, evaluation fixtures/tests.  
**FILES NOT TO TOUCH:** Financial kernel, policy decisions, action executor, hidden truth runtime path.  
**DEPENDENCIES:** MT-009, MT-010.  
**IMPLEMENTATION STEPS:** Typed retriever; sealed evidence payload; untrusted-data delimiters; provider-neutral gateway; timeout/retry; JSON schema/citation/finding/plan enum validation; rules-only fallback; persist prompt/model/evidence/config hashes.  
**TESTS:** Injection, nonexistent evidence, invented plan, arithmetic tampering, contradiction/missing evidence, provider timeout, hidden-label access.  
**ACCEPTANCE CRITERIA:** Invalid output cannot become a finding; clean rules-only cases need no model; conflicts abstain.  
**FAILURE MODES:** Raw database/model tool access, chain-of-thought exposure, unsafe retry storm.  
**SECURITY REQUIREMENTS:** No secrets/PII/credentials/tools in context; provider retention config documented.  
**DONE WHEN:** Held-out evaluation meets stated targets or deviations are explicitly reported without weakening validators.

## TASK MT-013

**TASK ID:** MT-013  
**TITLE:** Implement registered plans and default-deny policy  
**OBJECTIVE:** Convert findings/manual selection into immutable typed plans and deterministic decisions.  
**CONTEXT:** Unregistered action or missing input always denies.  
**PRD REQUIREMENTS:** FR-POL-001-005, FR-ACT-001, section 14.  
**FILES TO TOUCH:** `src/modules/policy/**`, plan module/registry, policy fixtures/routes/tests.  
**FILES NOT TO TOUCH:** Adapter execution, UI approval screens.  
**DEPENDENCIES:** MT-003, MT-008, MT-009; MT-012 optional.  
**IMPLEMENTATION STEPS:** Implement four demo tool/plan schemas; canonical plan hash; versioned policy bundle; exact input projection; decisions ALLOW/REQUIRE_APPROVAL/ADVISE/DENY/REQUIRE_MORE_EVIDENCE; reevaluation endpoint.  
**TESTS:** Missing input/action, amount/currency/role/contradiction boundaries, bundle change, deterministic hash.  
**ACCEPTANCE CRITERIA:** Real money authority always denied; conflicting evidence requires more evidence; simulated transfer requires approval.  
**FAILURE MODES:** Free-form tool parameters, policy defaults allow, mutable bundle.  
**SECURITY REQUIREMENTS:** Policy administration separated from case approval; evaluated input persisted/redacted.  
**DONE WHEN:** Policy matrix is exhaustive and all deny/default paths are tested.

## TASK MT-014

**TASK ID:** MT-014  
**TITLE:** Implement immutable approval binding and invalidation  
**OBJECTIVE:** Request/approve/reject exactly one immutable decision basis with separation of duties.  
**CONTEXT:** Evidence, policy, case, target, amount, plan, contract, role, or time changes can stale approval.  
**PRD REQUIREMENTS:** FR-ACT-003, sections 14.3-14.4, approval safety.  
**FILES TO TOUCH:** `src/modules/approvals/**`, approval routes/tables/tests.  
**FILES NOT TO TOUCH:** Worker adapter dispatch, frontend beyond API contract.  
**DEPENDENCIES:** MT-013.  
**IMPLEMENTATION STEPS:** Build canonical `decision_basis_hash`; open request uniqueness; role/tenant/self-approval checks; immutable decisions; expiry/invalidation service; expected-version commands; audit every decision.  
**TESTS:** Change each hashed field individually; new blocking evidence; expired/removed role; concurrent approvals; preparer self-approval.  
**ACCEPTANCE CRITERIA:** Any material change invalidates; stale hash receives 409; history remains append-only.  
**FAILURE MODES:** Hash omits target/evidence, time-zone expiry error, later role revocation ignored.  
**SECURITY REQUIREMENTS:** Server derives actor/role; client cannot submit approver identity.  
**DONE WHEN:** Approval invalidation P0 matrix passes completely.

## TASK MT-015

**TASK ID:** MT-015  
**TITLE:** Implement action reservation, transactional outbox, and simulated adapters  
**OBJECTIVE:** Execute a registered simulated action effectively once under retries/crashes.  
**CONTEXT:** The executor must rebuild approval basis inside the reservation transaction.  
**PRD REQUIREMENTS:** FR-ACT-001-005, sections 15.6 and 20.  
**FILES TO TOUCH:** `src/modules/actions/**`, worker action jobs, synthetic Route/recovery connectors, execute route, tests.  
**FILES NOT TO TOUCH:** Real payment/refund/transfer calls; model code.  
**DEPENDENCIES:** MT-014, MT-006.  
**IMPLEMENTATION STEPS:** Stable idempotency key/body hash; policy/approval/basis recheck; unique reservation + outbox transaction; typed adapter registry; attempts; ACK/FAIL/OUTCOME_UNKNOWN; status checking; replay deny.  
**TESTS:** Concurrent execute, crash before/after dispatch, same key/different body, timeout after acceptance, replay, disabled worker.  
**ACCEPTANCE CRITERIA:** Exactly one simulated external reference/effect; unknown outcome is not blindly retried; no generic HTTP tool.  
**FAILURE MODES:** New key on retry, audit after effect, worker bypasses role/policy.  
**SECURITY REQUIREMENTS:** Only worker owns adapter capability; tool allowlist and environment guard.  
**DONE WHEN:** Fault-injection suite demonstrates effectively-once simulated effect.

## TASK MT-016

**TASK ID:** MT-016  
**TITLE:** Implement outcome verification contracts and effect monitoring  
**OBJECTIVE:** Evaluate required evidence, blockers, window, amount/currency/identity/time, and reversals independently of action acknowledgement.  
**CONTEXT:** Settlement processing is not bank-credit verification.  
**PRD REQUIREMENTS:** FR-VER-001-003, financial outcome status.  
**FILES TO TOUCH:** `src/modules/verification/**`, synthetic bank connector, verification routes/tables/tests.  
**FILES NOT TO TOUCH:** AI authority, UI success shortcuts.  
**DEPENDENCIES:** MT-007, MT-009, MT-015.  
**IMPLEMENTATION STEPS:** Versioned contracts; required/optional/blocker evidence; authority coverage; observation window; idempotent rechecks; action effect states; late reversal subscription; synthetic signed bank event.  
**TESTS:** Missing bank, processed settlement only, wrong currency/recipient/UTR/date, timeout, late bank, refund after success.  
**ACCEPTANCE CRITERIA:** `EFFECT_VERIFIED` needs separate bank evidence; contradictions block; late evidence can progress safely.  
**FAILURE MODES:** HTTP 2xx or AI confidence marks verified; optional evidence compensates required source.  
**SECURITY REQUIREMENTS:** Synthetic bank source authenticated/labeled; contract admin versioned and audited.  
**DONE WHEN:** Verification contract matrix passes with zero false terminal successes.

## TASK MT-017

**TASK ID:** MT-017  
**TITLE:** Implement unique reconciliation and synthetic receivable closure  
**OBJECTIVE:** Allocate verified value once, request ERP closure, observe it, and only then finish outcome verification.  
**CONTEXT:** Buildathon uses strict one-to-one bank-line/expectation matching.  
**PRD REQUIREMENTS:** FR-VER-002, CTRL-03/05, reconciliation uniqueness.  
**FILES TO TOUCH:** `src/modules/reconciliation/**`, synthetic ERP connector, tables/jobs/tests.  
**FILES NOT TO TOUCH:** General fuzzy matcher or partial allocation framework.  
**DEPENDENCIES:** MT-016.  
**IMPLEMENTATION STEPS:** Lock bank line+expectation; validate exact tenant/currency/recipient/amount/UTR/date; reject ambiguity; insert unique allocation; enqueue typed ERP close; ingest closure evidence; transition outcome/case.  
**TESTS:** Concurrent allocation, same line/two cases, equal amount/two sellers, closure timeout, duplicate ERP event, reversal after close.  
**ACCEPTANCE CRITERIA:** One value closes one obligation; ambiguity abstains; case verifies only after closure evidence.  
**FAILURE MODES:** Amount-only match, circular verification, forced close on adapter acknowledgement.  
**SECURITY REQUIREMENTS:** ERP close tool only accepts reconciled expectation ID and no arbitrary ledger parameters.  
**DONE WHEN:** Main and conflict reconciliation E2E tests pass under concurrency.

## TASK MT-018

**TASK ID:** MT-018  
**TITLE:** Implement Agent Result Claims and reversal-aware retained value  
**OBJECTIVE:** Persist external agent claims and evaluate their verified/partial/rejected/unresolved/reversed status.  
**CONTEXT:** Agent completion is an untrusted claim; the opening refund must reduce retained verified value to zero.  
**PRD REQUIREMENTS:** Agent Result Claim and Outcome Verification Contract sections.  
**FILES TO TOUCH:** `src/modules/agent-claims/**`, agent-result routes, synthetic agent connector, tests.  
**FILES NOT TO TOUCH:** AI investigation authority; source financial evidence.  
**DEPENDENCIES:** MT-003, MT-009, MT-016.  
**IMPLEMENTATION STEPS:** Full claim schema/unique external ID; link supplied evidence as references only; deterministic retained-value contract and observation window; versioned evaluations; late refund/reversal reevaluation.  
**TESTS:** Full retain, partial refund, full refund, baseline already paid, duplicate claim, missing evidence, wrong currency, late reversal.  
**ACCEPTANCE CRITERIA:** ₹1.2L claim + ₹1.2L refund displays `REVERSED` and verified incremental ₹0 without model arithmetic.  
**FAILURE MODES:** Gross capture counted as incremental, claim evidence trusted without validation, old evaluation overwritten.  
**SECURITY REQUIREMENTS:** Agent connector scoped to tenant and cannot reference cross-tenant evidence.  
**DONE WHEN:** Claim lifecycle E2E and audit replay pass.

## TASK MT-019

**TASK ID:** MT-019  
**TITLE:** Build the operational shell, overview, and case queue  
**OBJECTIVE:** Present amount-weighted financial state using public Blade components and real backend projections.  
**CONTEXT:** Desktop is primary; the app is case-first, not chat-first.  
**PRD REQUIREMENTS:** Sections 11-12, frontend architecture, accessibility.  
**FILES TO TOUCH:** `src/web/app/**`, overview/cases features, browser-safe contracts, UI tests.  
**FILES NOT TO TOUCH:** Domain behavior, private/invented Razorpay tokens, mock success state.  
**DEPENDENCIES:** MT-001, MT-008, MT-010; public Blade docs/package.  
**IMPLEMENTATION STEPS:** Shell/nav/environment badge; KPI cards from API; cursor case table; filters/sorting; empty/loading/degraded/error; INR formatting from string/bigint-safe formatter; accessible responsive layout.  
**TESTS:** Keyboard/table semantics, screen-reader landmarks, amount/status formatting, no-data vs no-exposure, API degraded state.  
**ACCEPTANCE CRITERIA:** 500+ data is usable; exposure default sort works; no fake AI animation/metric.  
**FAILURE MODES:** Browser `Number()` precision conversion, hard-coded demo totals, inaccessible color-only status.  
**SECURITY REQUIREMENTS:** Raw evidence/secrets never sent; tenant scope server-derived.  
**DONE WHEN:** Overview/queue UI tests and accessibility smoke pass.

## TASK MT-020

**TASK ID:** MT-020  
**TITLE:** Build case investigation, approval, verification, audit, and Data Health UI  
**OBJECTIVE:** Make the complete control loop and uncertainty legible in one operator experience.  
**CONTEXT:** Facts, model interpretation, policy, human approval, action, and verification must be visually separate.  
**PRD REQUIREMENTS:** Screens B-F, meaningful AI states, approval safety.  
**FILES TO TOUCH:** `src/web/features/{case-investigation,approvals,verification,audit,data-health}/**`, UI/E2E tests.  
**FILES NOT TO TOUCH:** Backend semantics; hidden chain-of-thought; generic confirm action.  
**DEPENDENCIES:** MT-009, MT-012 through MT-018, MT-019.  
**IMPLEMENTATION STEPS:** Expected/observed path plus linear alternative; evidence timeline with event/ingest time; finding/contradiction/missing panels; exact approval basis; unknown outcome “Check status”; verification stages; audit filters; duplicate/conflict/lag health.  
**TESTS:** Keyboard/focus restore, approval stale conflict, abstention wording, reduced motion, responsive drawers, evidence navigation.  
**ACCEPTANCE CRITERIA:** Operator can prove why action is allowed/blocked and why terminal outcome is or is not verified.  
**FAILURE MODES:** UI enables stale approval, treats settlement as bank proof, shows model confidence as truth.  
**SECURITY REQUIREMENTS:** Role-controlled approval/raw evidence/audit; CSRF/session protections for mutations.  
**DONE WHEN:** Full operator path works using only real API state and accessibility checks pass.

## TASK MT-021

**TASK ID:** MT-021  
**TITLE:** Finalize Prove-It orchestration, adversarial suite, observability, and runbook  
**OBJECTIVE:** Deliver a repeatable five-minute demo and production-credible evidence of safety.  
**CONTEXT:** No performance or accuracy claim may exceed measured seeded results.  
**PRD REQUIREMENTS:** Sections 22-25, 29, demo moments, definition of done.  
**FILES TO TOUCH:** Demo controller/scripts, `tests/{e2e,adversarial}/**`, observability, runbook/demo docs, CI config.  
**FILES NOT TO TOUCH:** Financial semantics except reviewed defect fixes; no new scope.  
**DEPENDENCIES:** MT-001 through MT-020.  
**IMPLEMENTATION STEPS:** One-command reset/start; timed scenario step controls; model-stub/offline mode; structured logs/technical+money+AI metrics; fault injection; backup recording checklist; final security/secret scan; pin seed/schema/prompt/policy/contract versions.  
**TESTS:** Three full moments, duplicate replay, worker crash/unknown outcome, out-of-order, stale approval, conflict, injection, cross-tenant, deterministic manifest, accessibility and smoke performance.  
**ACCEPTANCE CRITERIA:** P0 suite green; zero duplicate actions/unsupported claims/cross-tenant access/closure without evidence; five-minute rehearsal passes twice from clean reset.  
**FAILURE MODES:** External/model outage, narrative drift, last-minute fake metric, live key present, demo route enabled outside demo.  
**SECURITY REQUIREMENTS:** Secret scan clean; only synthetic/test credentials; demo controls environment/role gated; logs redacted.  
**DONE WHEN:** Definition of done and permanent review checklist are signed off, with measured results and known limitations recorded.

