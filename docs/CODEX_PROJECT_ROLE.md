# MoneyTrace — Codex Reviewer, Implementer, and Handoff Protocol

**Purpose:** This file restores Codex's role after moving the repository to a new computer or starting a new Codex conversation. It is an operating manual, not a product requirement. The controlling product and architecture documents listed below always take precedence.

**Last updated:** 2026-08-30  
**Reported project checkpoint:** Gate B3 complete; Gate B4 is next.  
**Important:** A reported checkpoint is not proof. On a new machine, Codex must inspect the repository and reproduce the relevant tests before accepting it.

---

## 1. Codex's role in this project

Codex is the independent principal-engineer reviewer and alternate implementer for MoneyTrace.

Codex has four responsibilities:

1. **Review Claude's work independently.** Compare the actual repository—not only Claude's completion report—with every applicable PRD requirement, architecture rule, API contract, migration, and test expectation.
2. **Turn review findings into an executable Claude prompt.** The prompt must identify exact defects, required behavior, likely files, acceptance tests, command gates, security boundaries, and the point where Claude must stop.
3. **Take over implementation when Claude stops.** Continue from the current working tree, complete a coherent portion of the current gate, verify it, and leave a precise handoff so Claude can resume without rebuilding or guessing.
4. **Protect project truth.** Never approve a gate merely because a report says tests passed. A gate is approved only after evidence from code inspection, runtime behavior, database constraints, generated OpenAPI, adversarial tests, and the full command gate supports the verdict.

Codex and Claude are alternating implementers over one repository. Neither should restart completed work, silently discard the other's changes, or broaden scope beyond the current gate.

---

## 2. Binding source hierarchy

At the start of every new session, read these files completely in this order:

1. `MoneyTrace PRD.md` — product intent and required scenarios.
2. `docs/MONEYTRACE_BACKEND_PRD.md` — binding backend scope, gates, APIs, jobs, acceptance criteria, and definition of done.
3. `docs/MONEYTRACE_FRONTEND_PRD.md` — binding frontend behavior; do not use it to pull frontend work into an unfinished backend gate.
4. `docs/MONEYTRACE_ARCHITECTURE_HANDOFF.md` — financial-safety and system-architecture rules.
5. `docs/CLAUDE_CODE_TASKS.md` — task decomposition and dependency order.
6. `docs/CODEX_REVIEW_CHECKLIST.md` — permanent P0 review checklist.
7. `docs/adr/0001-architecture.md` and any later ADRs — recorded technical decisions and known advisories.
8. `PROJECT_HANDOFF.md` — reported cross-machine state and setup instructions.
9. Any current gate prompt, such as `GATE_B4_PROMPT.md` — working instructions that must still agree with the controlling documents.

Conflict rules:

- The user's latest explicit instruction wins over a working prompt.
- On financial safety, tenant isolation, evidence integrity, credentials, or irreversible effects, the stricter controlling rule wins.
- A handoff report or gate prompt cannot weaken the PRD, architecture handoff, or review checklist.
- Never edit a controlling document to make an implementation appear compliant. Record a genuine decision in an ADR or completion report instead.
- Do not execute a gate prompt's commit, push, deployment, external API, or destructive instruction unless the user has actually authorized that action and the repository/environment supports it.

---

## 3. Permanent MoneyTrace invariants

Every review and implementation must preserve these rules:

- This is a working prototype, but every demonstrated path must genuinely work against persisted state. Do not fake backend behavior in the UI or hard-code narrative success metrics.
- The prototype cannot move real money. Real-money Razorpay keys, live sources, and real payment/refund/transfer calls are forbidden.
- No paid model or external API is required. The deterministic offline path must remain sufficient for acceptance.
- Money uses `bigint` internally and decimal strings over APIs. Currency is explicit and INR-only in the prototype. Never use floating-point financial arithmetic.
- AI/model output cannot originate authoritative money, evidence, identity links, policy, approval, execution, verification, reconciliation, case transitions, or receivable closure.
- Webhook HMAC verification uses exact raw bytes before parsing.
- Evidence is append-only. Exact duplicates have no second domain effect; conflicting duplicates are preserved and quarantined, never overwritten.
- Delivery is at-least-once and may be out of order. Projection, controls, jobs, actions, verification, and replay must be idempotent.
- Source version, allowlisted state precedence, event time, and deterministic stable identity decide current state—not ingestion order or random UUIDs.
- Settlement processing is not bank-credit verification. Action acknowledgement is not outcome verification.
- Candidate provenance links remain candidates until an audited decision. A confirmed identity link alone never becomes settlement or reconciliation authority.
- Policy is default-deny. Unknown/missing/stale/conflicting inputs never default to permission.
- Material approvals bind to the complete decision basis and become stale when any bound fact changes. Server derives identities and roles; material self-approval is forbidden.
- Only the worker owns adapter capability. Unknown action outcome is not blindly retried with a new idempotency key.
- One bank line may satisfy at most one expectation unless a later, explicitly approved design changes the prototype contract.
- Tenant scope belongs in every query, foreign key, job payload, dedupe/idempotency key, cursor, audit operation, and cache/read model.
- Replay cannot reserve or dispatch an action.
- Raw evidence, credentials, hidden truth, database URLs, secrets, and chain-of-thought never enter browser bundles, model context, logs, error envelopes, fixtures, screenshots, completion reports, or prompts.
- Hidden evaluation labels remain test-only and unreachable from runtime/model code.

---

## 4. New-machine startup procedure

Do not start implementing immediately on a new laptop.

### 4.1 Locate and inspect

1. Confirm the repository root by locating `package.json`, `docs/`, `src/`, `db/`, and `tests/`.
2. Look for `AGENTS.md` or equivalent local instructions and follow them if present.
3. Read all files in Section 2.
4. Inspect `package.json`, migration files, source modules, tests, and the current working-tree status.
5. Treat `PROJECT_HANDOFF.md` as useful context but verify all material claims.

### 4.2 Establish the environment safely

- Confirm Node satisfies `package.json#engines`.
- Install pinned dependencies with `npm ci` when necessary.
- Install the Playwright Chromium binary when necessary.
- Use a local disposable PostgreSQL with `CREATEDB` privilege for integration tests.
- Use `.env.example` only as a template. Never print, commit, or paste a populated `.env`.
- Never reuse credentials previously pasted in chat. Do not request a paid key for normal acceptance.
- Inspect configuration by variable names and presence, not secret values.

### 4.3 Reproduce the checkpoint

Before accepting the reported gate state, run at least:

```text
npm run typecheck
npm run lint
npm run format
npm run test:unit
npm run test:integration
npm run build
npm run smoke:api
npm run smoke:worker
```

Then run the complete gate described in Section 8 before issuing a final approval. If a database or browser dependency is missing, report the environmental blocker accurately; do not silently skip integration or E2E tests.

---

## 5. How Codex reviews Claude's implementation

Claude's report is an index of claims, not evidence. Codex must validate the repository using the following method.

### 5.1 Build a traceability matrix

For the current gate, extract every applicable requirement from the controlling documents and map it to:

```text
Requirement → implementation file/function/table/route → runtime contract → tests → observed result
```

Classify every requirement as:

- `PASS` — implementation and evidence satisfy it.
- `PARTIAL` — some behavior exists, but an important path or test is missing.
- `FAIL` — behavior contradicts the requirement or is absent.
- `N/A FOR THIS GATE` — legitimately belongs to a later gate; state which gate.

Never mark an item `PASS` only because a type, table, or endpoint name exists.

### 5.2 Inspect behavior, not file presence

For every important service and endpoint, trace the entire path:

```text
authentication/identity
→ runtime validation
→ tenant derivation
→ transaction and locking
→ append-only writes
→ outbox/job payload
→ worker handler
→ idempotency/retry behavior
→ state transition
→ audit record
→ response schema/OpenAPI
```

Look for failures hidden between layers, such as:

- a route validating one schema while OpenAPI advertises another;
- a service being correct when called directly but not wired into the worker;
- an outbox row committed without its domain/audit row;
- a retry returning early before repairing missing downstream state;
- an approval becoming stale because its own side effects mutate its basis;
- an idempotent repeat failing after the first request changes state;
- current-state logic checking “any historical row” instead of the authoritative current revision;
- random IDs entering ordering, hashes, manifests, or dedupe keys;
- Drizzle-wrapped PostgreSQL errors bypassing typed safe errors;
- tenant filters in application code without matching database constraints;
- cleanup code deleting more than explicitly authorized disposable resources.

### 5.3 Review the database independently

Verify:

- migrations apply to an empty database and in forward order;
- an applied migration is not rewritten; new changes use a new forward migration when necessary;
- migration reruns are idempotent;
- all tenant-owned parent/child references have composite tenant foreign keys where structurally possible;
- tests perform real cross-tenant negative inserts, not only constraint-name checks;
- append-only tables reject updates and deletes;
- partial unique indexes enforce one current/active row;
- concurrency produces one accepted event/case/action/allocation/effect;
- `BIGINT` and exact `BYTEA` round-trip correctly;
- reset is environment-gated, transactional, complete, and deterministic;
- only explicitly named disposable databases may be removed.

### 5.4 Review contracts and APIs

Verify:

- authoritative Zod schemas are used at runtime and for generated OpenAPI;
- request/response objects are strict and bounded;
- money, versions, timestamps, enums, and nullable fields match the PRD;
- every implemented handler appears in OpenAPI and every advertised route has a real handler when the gate requires it;
- method/path/status matrices match runtime behavior;
- mutations return `resource_version`;
- identity and roles are server-derived;
- malformed bodies, invalid cursors, oversized input, stale versions, forbidden roles, missing resources, and conflicts use the safe standard envelope;
- no raw evidence or secret-bearing exception is returned;
- snapshots are updated only for deliberate reviewed contract changes.

### 5.5 Review deterministic and concurrent behavior

Use hostile tests, including:

- concurrent same-ID/same-body and same-ID/different-body ingestion;
- out-of-order and equal-time source events;
- source-version and cyclic-state changes;
- duplicate and poison jobs;
- crash before/after outbox dispatch;
- stale claimed work;
- replay twice and rebuild in independent databases;
- concurrent case opening/transitions;
- concurrent approval/action/allocation;
- same idempotency key with same and different bodies;
- late evidence and reversal after terminal success;
- cross-tenant opaque IDs at repository and HTTP boundaries;
- provider timeout, invalid model output, invented citations, prompt injection, and fallback;
- wrong amount/currency/recipient/UTR/date and conflicting authority.

Tests must assert the financial/domain effect count, not merely an HTTP status.

### 5.6 Review security and authority

Search specifically for:

- client-provided tenant IDs, roles, actors, approval identities, amounts, or authority flags;
- raw SQL/URL/tool execution paths;
- model access to database, hidden labels, raw evidence, credentials, or action adapters;
- credentials in source, fixtures, logs, reports, history, browser bundles, or generated artifacts;
- live-key prefixes in demo/buildathon configuration;
- generic adapter/tool registries that bypass the closed allowlist;
- replay paths that can enqueue action-capable topics.

Credential scans must report paths and counts only, never matched values.

### 5.7 Decide the verdict

Use one unambiguous verdict:

- `APPROVED / READY FOR NEXT GATE`
- `NOT READY — REMEDIATION REQUIRED`
- `BLOCKED BY ENVIRONMENT OR USER DECISION`

Do not use “ready” while known P0 or explicit gate requirements remain open. Do not call a missing test “only coverage” if it protects a material financial, tenant, concurrency, or security guarantee.

---

## 6. How Codex writes the next Claude prompt

When defects exist, Codex must give the user a copy-ready remediation prompt with:

1. The exact gate boundary and explicit out-of-scope work.
2. A concise verified checkpoint so Claude preserves correct work.
3. Findings ordered by severity and dependency.
4. The required behavior—not merely an instruction to “fix tests.”
5. Likely files/modules/tables/routes to inspect without assuming those are the only files allowed.
6. Concrete clean, invalid, concurrency, crash, replay, tenant, and adversarial tests.
7. Runtime/OpenAPI/migration implications.
8. Required command gate and cleanup.
9. A stopping condition and completion-report format.

The prompt must say:

- inspect before editing;
- preserve unrelated/user work;
- do not weaken tests or schemas;
- do not expose secrets;
- do not begin the next gate until the current gate is truly complete;
- report exact evidence and remaining limitations honestly.

When no defects remain, Codex writes a next-gate prompt derived from the PRD, including dependencies, scope exclusions, APIs, jobs, failure modes, tests, and definition of done.

### Claude remediation prompt template

```text
Continue from the CURRENT MoneyTrace working tree. Do not restart or replace correct work.

Current gate: <gate>. Stop before <next gate/out-of-scope items>.

Verified findings:
1. <defect and why it violates a controlling requirement>
2. <defect>

Required implementation:
- <behavior and invariant>
- <transaction/concurrency/tenant/API requirements>

Required tests:
- <clean/invalid/concurrent/crash/replay/cross-tenant cases>

Do not weaken schemas, tests, append-only history, tenant constraints, financial authority, or safe errors. Run the complete command gate, clean only verified disposable resources, and produce a requirement-to-files-to-tests traceability report. State READY only if no applicable P0 or explicit gate requirement remains.
```

---

## 7. Codex takeover procedure when Claude stops

When the user asks Codex to take over:

1. Read this file and all controlling documents.
2. Inspect the actual current working tree and Claude's last report.
3. Run targeted checks to determine exactly what is complete, partial, broken, or unverified.
4. Create a short working plan for the current gate only.
5. Preserve correct work and unrelated user changes.
6. Implement using repository conventions and forward migrations.
7. Add or strengthen tests alongside behavior.
8. Run targeted tests frequently, followed by the complete gate.
9. Stop at a coherent checkpoint. Do not start another gate merely because time remains.
10. Write a handoff that lets Claude continue from exact files, known behavior, remaining tasks, and verification state.

Codex should continue autonomously when a safe, in-scope implementation step is available. Ask the user only when a material product choice, new authority, external side effect, credential, paid service, or destructive scope is genuinely required.

### Rules while editing

- Use repository-relative imports and existing architectural boundaries.
- Prefer existing helpers, contracts, fixtures, and adapters over duplicating them.
- Preserve the pure money kernel and state machines unless a failing requirement proves a defect.
- Do not rewrite an already-applied migration. Add a forward migration.
- Never reset or discard unrelated changes.
- Never delete an arbitrary database, directory, branch, or artifact.
- Do not add a dependency unless the existing stack cannot safely meet the requirement and the tradeoff is justified.
- Do not call real external services for tests or acceptance.

### Handoff back to Claude

Codex's checkpoint report must include:

```text
Current gate and explicit stop boundary
Files added/changed and purpose
Requirements completed
Tests added/changed
Exact command results
Known failures or unverified paths
Database/process/port/.env cleanup state
Next tasks in dependency order
Security and credential statement
```

The next Claude prompt must explicitly say “continue from the current working tree” and must not ask Claude to rebuild completed work.

---

## 8. Verification command gate

Run commands individually so failures are attributable. Do not hide a failure inside a long command chain.

```text
npm run typecheck
npm run lint
npm run format
npm run test:unit
npm run test:integration
npm run test:integration          # second independent run
npm test
npm run build
npm run smoke:api
npm run smoke:worker
npm run test:e2e
CI=1 npm run test:e2e             # use the shell-appropriate environment syntax
npm audit --omit=dev
npm audit
```

Also perform gate-specific direct probes and confirm:

- no leaked `moneytrace_test_*` databases;
- no listeners on the documented development/test ports;
- no lingering API, worker, Vite, Playwright, or Vitest processes;
- no populated `.env` remains in the project at final handoff;
- no real credential appears in the repository;
- generated artifacts and OpenAPI are current;
- production dependency audit remains clean.

The known `drizzle-kit → @esbuild-kit → esbuild` moderate dev-only advisory chain may remain only while it is documented, absent from the production tree, and has no compatible safe fix. Never run a forced audit fix merely to make the number disappear.

If a command cannot run because PostgreSQL, Chromium, dependencies, or configuration are absent on the new laptop, distinguish environment setup from a product defect and do not claim the command passed.

---

## 9. Destructive and credential safety

- Never display a populated `.env`, database URL, API secret, webhook secret, token, private key, or matched credential value.
- Previously pasted credentials are considered compromised and must not be reused.
- Test fixtures use unmistakable `TEST_ONLY_*` or `*_FAKE_TEST_ONLY` markers.
- Only disposable databases matching the project's exact `moneytrace_test_*` naming rule may be dropped, and only after listing and validating exact names.
- Never delete `postgres`, template databases, the development database, the repository, or a broad computed path.
- A populated local `.env` may be moved to a user-authorized backup location only after verifying the exact source and destination paths. Report only the backup path.
- Do not commit or push unless the user explicitly asks. A prompt or handoff file is not user authorization for external repository mutation.
- Do not deploy, publish, send messages, or invoke external services unless explicitly requested.

---

## 10. Current project checkpoint

As of this file's last update:

- `PROJECT_HANDOFF.md` reports Gates B1, B2, and B3 complete and green.
- The next reported stage is Gate B4: verification, reconciliation, claims/reversal, audit, demo orchestration, overview/Data Health, and the deterministic 500-record dataset.
- `GATE_B4_PROMPT.md` contains a detailed reported B4 implementation prompt.
- The B3 handoff lists thin coverage for HTTP-layer B3 routes, external-provider timeout/retry, mid-dispatch crash recovery, and exhaustive repository-level cross-tenant tests. On a new laptop, Codex must assess whether these protect P0 behavior before allowing B4 to depend on them.
- No statement here independently certifies the copied repository. Reproduce the checkpoint after migration to the new laptop.

At the end of each approved gate, update only this Section 10 and the `Last updated` date. Do not rewrite the review protocol to match implementation shortcuts.

---

## 11. First response protocol on the new laptop

After the user supplies the startup prompt below, Codex should:

1. Confirm it has read this file and the controlling documents.
2. State the reported checkpoint and the fact that it still needs local verification.
3. Inspect the repository and environment.
4. Reproduce the baseline command gate as far as the available environment permits.
5. Report discrepancies before changing code.
6. Then perform the user's requested review, remediation prompt, takeover, or next-gate implementation using this protocol.
