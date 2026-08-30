# MoneyTrace permanent Codex review checklist

Use this checklist for every Claude Code phase and later pull request. Mark non-applicable items with a reason. Any applicable unchecked **P0** item blocks merge/demo release.

## 1. Scope and architecture

- [ ] **P0** The change belongs to the current reviewed task/phase.
- [ ] **P0** The modular-monolith/domain boundary is preserved; no module writes another module's tables directly.
- [ ] New infrastructure, service, framework, or abstraction has a measured reason and ADR.
- [ ] No application-source behavior weakens the PRD or architecture safety contract.
- [ ] No public statement claims knowledge of Razorpay private systems.

## 2. Financial correctness

- [ ] **P0** All authoritative money uses `bigint`/PostgreSQL `BIGINT` minor units.
- [ ] **P0** Currency is stored, validated, and compared with every material amount.
- [ ] **P0** No JavaScript/SQL floating-point arithmetic participates in money decisions.
- [ ] **P0** Every equation names buckets once; platform allocation, fees, taxes, refunds, reversals, and adjustments are not double-counted.
- [ ] Allocation rate, rounding mode, and residual bucket are explicit and versioned.
- [ ] Negative adjustments are typed, reasoned, bounded, and tested.
- [ ] Amount conservation/property tests cover zero, maximum, refund, reversal, and rounding cases.
- [ ] Gross recovery, retained value, incremental value, restored amount, and prevented loss remain distinct metrics.
- [ ] Cross-currency input is rejected unless an explicit versioned conversion contract exists.

## 3. Financial outcomes and reconciliation

- [ ] **P0** Financial-outcome, case, agent-claim, approval/action, and verification states are independent.
- [ ] **P0** `VERIFIED` is reached only through a deterministic verification contract.
- [ ] **P0** Required evidence coverage is complete, authority is sufficient, blockers are zero, and amount/currency/identity/time checks pass.
- [ ] **P0** `settlement.processed` is not treated as bank-credit proof.
- [ ] **P0** One bank line/value cannot close two obligations; concurrent allocation is tested.
- [ ] Ambiguous same-amount/date/seller candidates abstain rather than match.
- [ ] Receivable closure occurs only after unique reconciliation and must itself be observed.
- [ ] Later refund/reversal/dispute appends history, marks reversal, and reopens the obligation.
- [ ] Historical verification/reconciliation remains replayable and is never overwritten.

## 4. Evidence and provenance

- [ ] **P0** Accepted raw evidence is durable and application-immutable.
- [ ] **P0** Raw hash, source, source event ID/type, account/scope, event time, ingestion time, schema version, and tenant are preserved.
- [ ] **P0** Same source ID/different hash is quarantined and never projected automatically.
- [ ] Exact duplicates do not create another projection, case, action, allocation, or audit effect beyond duplicate handling.
- [ ] Direct/derived/asserted/candidate/contradicted relationships remain distinguishable.
- [ ] Candidate links never silently become authoritative.
- [ ] Every material edge/finding/action/verification cites existing evidence.
- [ ] Evidence sets are sealed and content-hashed; approval-sensitive changes invalidate the basis.
- [ ] Replay can rebuild derived projections but cannot dispatch actions.

## 5. Distributed-systems safety

- [ ] **P0** No code assumes exactly-once delivery or webhook order.
- [ ] **P0** Accepted evidence commits before a success acknowledgement.
- [ ] Projectors are idempotent by projector name/version/event and safe under retry/crash.
- [ ] Late/out-of-order evidence cannot silently regress current state and triggers reevaluation.
- [ ] Deterministic keys exist for cases, investigations, actions, and reconciliation.
- [ ] **P0** Action reservation and outbox write occur in one transaction.
- [ ] **P0** Stable idempotency key is reserved before effect; same key/different body is rejected.
- [ ] **P0** `OUTCOME_UNKNOWN` is distinct from failure and is not retried with a new key.
- [ ] Optimistic version/row locks protect case, approval, action, verification, and allocation races.
- [ ] Retry classes and dead-letter/quarantine behavior are explicit and observable.

## 6. AI boundary and quality

- [ ] **P0** The model receives only a typed, bounded, tenant-scoped sealed evidence set.
- [ ] **P0** Model output is schema validated and every evidence ID is checked against that set.
- [ ] **P0** The model cannot originate authoritative money, evidence, entity links, policy, approval, state transitions, verification, reconciliation, or receivable closure.
- [ ] **P0** The model cannot call an arbitrary API, SQL query, URL, or unregistered tool.
- [ ] Deterministic values are inserted by application code, not copied from model arithmetic.
- [ ] Untrusted source text is delimited and cannot change system/tool policy.
- [ ] Contradictions and missing evidence are preserved; abstention is available and tested.
- [ ] Provider timeout/retry is bounded and rules-only degraded mode remains functional.
- [ ] Prompt/model/config/evidence/output-schema versions and hashes are audited.
- [ ] Hidden ground-truth labels are inaccessible to runtime/model builds.
- [ ] UI does not expose hidden chain-of-thought or fake thinking states.

## 7. Policy, approval, and actions

- [ ] **P0** Policy is deterministic and default-deny for missing input or unregistered action.
- [ ] **P0** The Buildathon contains no real-money transfer, payout, refund, recovery collection, or arbitrary ledger write.
- [ ] Only registered, versioned, typed tools and plans can execute.
- [ ] Policy inputs include action, amount/currency, target, evidence coverage, contradictions, impact, actor/role, tenant/environment, and versions.
- [ ] **P0** Approval binds to case/version, plan/version/hash, evidence-set hash, policy version/decision, action, target, amount/currency, verification contract, role, and expiry.
- [ ] **P0** Complete decision basis is rebuilt and compared inside action reservation.
- [ ] Plan/evidence/policy/amount/target/contract/case/role/expiry changes invalidate approval.
- [ ] Separation of duties and concurrent approval behavior are tested.
- [ ] Action acknowledgement remains distinct from effect verification.
- [ ] Audit failure blocks action rather than allowing an unaudited effect.

## 8. Razorpay integration

- [ ] **P0** Only public documented APIs/events are named as Razorpay facts.
- [ ] **P0** Webhook HMAC-SHA256 uses exact raw request bytes before parsing.
- [ ] Razorpay duplicate identity uses the `x-razorpay-event-id` header where present.
- [ ] Upstream event string and entity snapshot are preserved separately from canonical mapping/current fetch.
- [ ] Payment/Order/Refund/Route/Settlement DTOs do not leak into core domain types.
- [ ] Route/account capability absence degrades visibly to an explicitly synthetic adapter.
- [ ] Merchant settlement and recipient Route settlement scopes cannot be conflated.
- [ ] Direct Transfer idempotency behavior is not generalized to other endpoints.
- [ ] Test and synthetic events are visibly labeled; no test-mode claim implies real bank movement.
- [ ] `rzp_live_` key prefix is rejected in demo; secrets never reach browser/model/log/source.

## 9. Security and tenant isolation

- [ ] **P0** Authentication and authorization are enforced server-side at service and route boundaries.
- [ ] **P0** Every tenant-owned query, join, job, cache key, unique key, and export is tenant-scoped.
- [ ] Cross-tenant negative tests cover cases, evidence, graph traversal, actions, jobs, audit, and agent claims.
- [ ] Role, action, resource, amount, and environment are considered where material.
- [ ] Client-provided actor, approver, tenant, role, or authority is not trusted.
- [ ] Secrets use environment/secret references, are redacted, and pass repository scanning.
- [ ] Request size/rate/schema limits and safe error responses are present.
- [ ] Raw evidence/PII visibility is role-redacted and never logged by default.
- [ ] CSV/export formula injection and unsafe content rendering are mitigated.
- [ ] Demo reset/advance endpoints are environment- and role-gated and absent/disabled in production.

## 10. API and database contract quality

- [ ] Mutation request/response/error schemas and resource versions are documented/tested.
- [ ] JSON `bigint` money serializes as decimal strings without precision loss.
- [ ] Unknown critical enums reject/quarantine instead of coercing to success.
- [ ] Unique constraints, FKs, checks, indexes, and optimistic versions match architecture.
- [ ] Public list routes use cursor pagination and allowlisted filters/sorts.
- [ ] Errors distinguish validation, conflict/stale state, policy denial, unknown outcome, retryable failure, and incomplete verification.
- [ ] Schema migration is forward-safe for accepted evidence; destructive rollback is limited to disposable demo databases.
- [ ] Browser-safe contracts cannot import server config, DB, integration, or secret code.

## 11. UX and accessibility

- [ ] **P0** UI renders real backend state; no hard-coded success, fake AI progress, or invented metric.
- [ ] **P0** Expected, observed, divergence, evidence, AI interpretation, policy, approval, action, verification, and audit are visually distinct.
- [ ] **P0** Uncertainty/conflict/unknown outcome remains explicit and does not offer unsafe retry.
- [ ] Money formatting is precise, currency-explicit, Indian-numbered for demo, and never converted through unsafe `Number`.
- [ ] Color is not the only status cue; semantics, icons, and text exist.
- [ ] Keyboard operation, focus restoration, semantic headings, labels, reduced motion, and screen-reader path are tested.
- [ ] Money path has an accessible linear alternative.
- [ ] Empty, no exposure, no data, loading, degraded source, error, and unknown-action states are different.
- [ ] Approval displays exact action/target/amount/basis/expiry/policy and uses explicit approve/reject/request-evidence labels.
- [ ] Public Blade/current documentation is used; private or invented Razorpay screens/tokens are not claimed.

## 12. Testing, evaluation, and demo

- [ ] **P0** Financial kernel/state/policy/idempotency/reconciliation unit tests pass.
- [ ] **P0** Full missing-transfer lifecycle verifies only after bank evidence, unique allocation, and ERP closure.
- [ ] **P0** ₹1,20,000 recovery claim plus full refund becomes `REVERSED` and ₹0 incremental.
- [ ] **P0** Conflicting UTR/date/seller case abstains and preserves exposure.
- [ ] **P0** Duplicate replay and worker-crash tests create one effect/allocation only.
- [ ] Prompt injection, nonexistent citation, modified duplicate, currency mismatch, stale approval, timeout-after-acceptance, and cross-tenant adversarial cases pass.
- [ ] Retrieval and reasoning metrics are evaluated separately with hidden labels.
- [ ] Unsupported material claim and unsafe action recommendation counts are zero for release fixtures.
- [ ] Seed/reset is deterministic and narrative metrics are computed/asserted from the manifest.
- [ ] Performance/accuracy statements are measured and labeled synthetic; no 100k/min claim is presented as tested.
- [ ] Offline/model-stub/synthetic fallback and backup demo assets are rehearsed.

## 13. Observability and operations

- [ ] Logs carry request/trace/correlation/event/case/action IDs and exclude secrets/raw financial payloads.
- [ ] Metrics cover duplicates/conflicts, lag/backlog, model validation/failure, policy denials, approval expiry, unknown actions, verification latency, and unresolved exposure.
- [ ] Financial metrics carry currency and are never summed across currencies without explicit policy.
- [ ] Duplicate action attempt, unauthorized action, unsupported citation, verification backlog, and high-value exposure have alerts/runbook entries.
- [ ] Audit replay reconstructs facts, model artifact, policy, human decision, tool attempt, verification, reconciliation, and reversal.
- [ ] Failure/degraded mode tells operators which conclusions remain safe.

## 14. Phase review record

For each reviewed task, record:

```text
TASK ID:
COMMIT/DIFF:
REVIEW DATE:
P0 FAILURES:
NON-P0 FINDINGS:
TEST COMMANDS AND RESULTS:
MIGRATION REVIEW:
SECURITY REVIEW:
MEASURED DEMO IMPACT:
APPROVED / CHANGES REQUIRED:
```

