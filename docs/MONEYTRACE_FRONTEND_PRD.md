# MoneyTrace Frontend PRD — Five-Day Working Prototype

**Version:** 1.0  
**Date:** 29 August 2026  
**Status:** Implementation contract  
**Audience:** Claude Code, frontend implementers, and Codex reviewers  
**Dependency:** Start only after every backend definition-of-done item in `MONEYTRACE_BACKEND_PRD.md` is green.

## 1. Document authority and frontend gate

This PRD defines the entire required frontend for the working prototype. It preserves the original product's case-first, evidence-led experience while excluding production-scale settings and decorative scope that cannot be completed safely in five days.

The frontend must consume real backend APIs and generated contracts. It may use mocked responses only inside isolated tests or Storybook-like development fixtures if such tooling already exists; production/demo code may never fall back to hard-coded success, metrics, financial state, AI output, or verification.

Before editing `src/web`, Claude must verify and record:

- backend completion report says `BACKEND READY FOR FRONTEND: YES`;
- database reset and all four backend scenarios pass;
- `/openapi.json` is available;
- example fixtures exist for every frontend endpoint;
- demo users, roles, error codes, scenario IDs, and polling behavior are documented.

If any gate is false, return to backend work. Do not hide a missing backend capability behind a frontend mock.

## 2. Frontend product outcome

The UI must let a judge or finance operator answer, without reading source code:

1. What amount is at risk or was restored/prevented/reversed?
2. What should have happened to the money?
3. What evidence shows what actually happened?
4. Where is the first divergence?
5. What did the investigation conclude or refuse to conclude?
6. Why did policy allow, deny, or require approval?
7. What exactly was approved, by whom, and until when?
8. Was the action merely acknowledged, or was its financial effect independently verified?
9. Did unique reconciliation and ERP closure occur?
10. Can the full run be replayed and audited?

The primary experience is a financial case, not chat. Facts, derived facts, investigation, policy, human approval, action, verification, reconciliation, and audit must be visibly distinct.

## 3. Required routes and navigation

Use a client-side router with URL-addressable pages and browser back/forward support. Add `react-router-dom` if not already available; do not build a custom routing framework.

| Route            | Screen                                          | Required role                      |
| ---------------- | ----------------------------------------------- | ---------------------------------- |
| `/`              | redirect to `/overview`                         | any authenticated demo user        |
| `/overview`      | Revenue Integrity Overview + prioritized cases  | viewer                             |
| `/cases`         | full case queue                                 | viewer                             |
| `/cases/:caseId` | Case Investigation workspace                    | viewer; mutations role-gated       |
| `/approvals`     | pending and historical Approval Review queue    | viewer; decisions require approver |
| `/audit`         | Audit Replay, optionally selected by case query | viewer/auditor with redaction      |
| `/data-health`   | source, pipeline, model, and dataset health     | viewer/platform operator detail    |
| `*`              | accessible not-found state                      | any authenticated user             |

Minimum global navigation order: Overview, Cases, Approvals, Audit, Data Health. Do not add unfinished Controls, Reconciliation, Money Paths, Settings, or chat routes.

## 4. Users and demo identity

Use the seeded backend identities, never free-form roles. In demo/buildathon mode the shell contains a clearly labeled **Demo role switcher** with these fixed choices:

- Viewer (`user_viewer`)
- Investigator/Case Manager (`user_investigator`)
- Finance Approver (`user_approver`)
- Demo Operator/Auditor (`user_operator`)

The client sends only `x-demo-user-id`; the backend derives tenant and roles. Switching identity clears role-sensitive cached data, announces the change to assistive technology, and refetches the current route. The UI may hide/disable unavailable actions for clarity, but server authorization remains authoritative and `403` is handled explicitly.

## 5. Frontend architecture

### 5.1 Required structure

```text
src/web/
  app/                 # router, shell, providers, route boundaries
  api/                 # fetch client, endpoint functions, errors, polling
  components/          # reusable accessible product components
  features/
    overview/
    cases/
    investigation/
    approvals/
    verification/
    audit/
    data-health/
    demo/
  formatting/          # money/date/status formatters
  styles/              # semantic layout and fallback tokens only
  testing/             # browser-safe fixtures/helpers used by tests only
```

Browser code may import only browser-safe contracts. It must not import server config, database, Node built-ins, modules, integrations, hidden labels, secrets, or raw environment access.

### 5.2 Design system decision

Use the current public `@razorpay/blade` package/documentation if it installs and builds cleanly during the first implementation checkpoint. Map UI needs to public components and semantic tokens; do not copy/invent private Razorpay dashboard patterns or token values.

If Blade cannot be installed or is incompatible after a maximum 60-minute documented attempt, use accessible local React primitives with semantic CSS custom properties. Record the fallback and reason. The fallback must remain visually professional, must not claim to be Blade, and must pass the same accessibility tests. Working behavior takes priority over design-system dependency troubleshooting.

### 5.3 Data layer

- One typed `apiClient` wraps `fetch`, injects demo user ID and request ID, parses safe error envelopes, and validates successful JSON with shared Zod schemas.
- Endpoint functions are organized by resource; React components do not construct URLs or parse raw envelopes directly.
- Use request cancellation on unmount/route change.
- No optimistic financial success. Mutations show pending only while the request is genuinely in flight, then refetch authoritative state.
- Cache only within the running SPA. Reset/identity change invalidates all cached data.
- Use short polling, not WebSockets: default 2 seconds only while an investigation/action/verification/scenario is non-terminal and the tab is visible; stop on terminal state, error, route change, or hidden tab. Data Health may poll every 5 seconds.
- The URL stores shareable case ID, filters, sort, cursor where practical, audit case, and selected audit artifact.

### 5.4 Error boundary and request states

Provide route-level error boundaries and per-panel loading/errors. Preserve the page shell and last safe context. Every retry button must be classified:

- Safe reads: `Retry`.
- Idempotent command with unchanged stable request: `Try again` only if backend marks retryable.
- `OUTCOME_UNKNOWN`: never show retry; show `Check status`.
- `APPROVAL_STALE`/`VERSION_CONFLICT`: close the decision modal, refetch, announce that the target changed, and require a fresh review.
- `RECONCILIATION_AMBIGUOUS`/`VERIFICATION_INCOMPLETE`: show unresolved evidence requirements and keep exposure visible.

## 6. Shared interaction and visual language

### 6.1 Information hierarchy

1. **Financial impact:** amount, currency, outcome, exposure/restored/prevented/reversed, age/due.
2. **Expected versus observed:** lifecycle path, first divergence, evidence coverage.
3. **Decision support:** finding/abstention, contradictions, policy, next safe command.
4. **Forensics:** event/ingestion times, sources, hashes, schema/model/policy/tool/contract versions.

### 6.2 Artifact separation

Use labeled sections/badges with text and icon—not color alone:

- `SOURCE FACT`
- `DERIVED CONTROL`
- `INVESTIGATION` or `OFFLINE DEMO INVESTIGATION`
- `POLICY DECISION`
- `HUMAN APPROVAL`
- `SIMULATED ACTION`
- `VERIFICATION EVIDENCE`
- `RECONCILIATION`
- `AUDIT`

AI confidence is never displayed as financial truth. Show confidence band with evidence coverage, contradiction count, and safe-to-act state.

### 6.3 Money

- Accept only decimal string minor units from APIs.
- Format with `BigInt`; never call `Number()`/`parseFloat()` on money.
- Required demo format is Indian grouping and explicit INR symbol/code, for example `₹4,55,000.00 INR` where paise are material.
- Negative/reversed/refund amounts include sign plus semantic label; never rely on red color.
- Full value is available to screen readers and tooltips; summary cards may shorten only when full value remains adjacent/accessible.
- Never sum different currencies. The prototype rejects non-INR, but the formatter still accepts an explicit currency argument.

### 6.4 Time

- API times are UTC instants.
- Display local date/time plus accessible UTC detail/tooltip.
- Evidence timeline always labels `Event time` and `Ingested time` separately.
- Relative age never replaces the exact timestamp.

### 6.5 Status language

Prefer explicit labels: `Awaiting bank evidence`, `Action acknowledged—not yet verified`, `Conflicting evidence—automatic closure blocked`, `Reversed after refund`, `No exposure`, `No data`, and `Source unavailable`. Avoid vague labels such as “Done,” “Success,” or “AI verified.”

## 7. Application shell

### 7.1 Header

- Product name: MoneyTrace.
- Environment badge: `Synthetic Demo`; `Razorpay Test connected` may appear only from Data Health capability state.
- Last dataset evaluation time and manifest hash short form.
- Demo role switcher.
- Refresh current page.
- Demo scenario control button visible only to demo operator.

Never show a live-mode badge or real-money implication.

### 7.2 Navigation and layout

- Persistent left navigation on desktop; compact top/drawer navigation on tablet/mobile.
- Main content has one `h1`, breadcrumb/back link where needed, skip-to-content link, and stable landmarks.
- Global degraded banner lists unavailable sources/model mode and states which conclusions remain safe.
- A reset-in-progress banner is based on real demo status and disables conflicting mutations.

### 7.3 Demo scenario controller

Operator-only drawer/modal using `GET /v1/demo/status`, reset, and advance endpoints:

- choose one of the four named scenarios;
- show current/next step and fixed demo clock;
- reset requires explicit typed/checkbox confirmation matching backend contract;
- advance sends expected step and is disabled while in flight;
- stale step refetches rather than blindly retrying;
- after reset/advance, invalidate all queries and navigate to the scenario's relevant screen;
- announce completion/error and restore focus.

This is a control for real backend state, not an animation sequencer.

## 8. Screen A — Revenue Integrity Overview

### 8.1 Purpose and API

Use `GET /v1/overview`; no KPI is calculated from hard-coded constants in the browser. Show dataset time, synthetic label, 500-record count, and current scenario stage.

### 8.2 Opening category reveal

At the top, show the agent-claim truth comparison when present:

| Row                           | Value/state              |
| ----------------------------- | ------------------------ |
| Agent-reported recovery       | ₹1,20,000                |
| Recovery payment observed     | Yes/No from evidence     |
| Refund detected later         | ₹1,20,000                |
| Final retained value          | ₹0                       |
| Verified incremental recovery | ₹0                       |
| Outcome                       | `REVERSED, NOT VERIFIED` |

Clearly label the agent claim untrusted and the retained value deterministic. Link to claim evidence/audit if provided.

### 8.3 KPI cards

Required cards:

- unresolved exposure;
- verified restored amount;
- duplicate collection prevented;
- matched records / total records;
- unresolved material cases;
- unsafe candidate matches blocked.

Each card includes full currency/value, definition tooltip, dataset stage/time, and link/filter where relevant. Distinguish zero/no exposure from unavailable/no data.

### 8.4 Operational summaries

Use compact, accessible charts or structured bar/list representations for:

- exposure by lifecycle state;
- case resolution distribution;
- opened versus closed exposure trend.

Charts must have data-table/text alternatives and must not add a chart dependency if a simple semantic implementation is clearer. Values come from API response.

### 8.5 Prioritized queue preview

Show the top material cases with columns: case ID, exposure, control/divergence, lifecycle state, evidence coverage, contradiction count, owner, age, and next action. Default exposure descending. Row activation navigates to the case; include an explicit accessible link and `View all cases`.

## 9. Screen B — Case Queue

### 9.1 API/query behavior

Use `GET /v1/cases` with cursor pagination and backend allowlisted query values. Required filters:

- lifecycle state;
- control ID;
- evidence coverage;
- owner;
- policy status;
- minimum/maximum exposure;
- sort by exposure or opened time.

Filters and sort persist in URL. Search is limited to case ID/known identifiers supported by the backend; do not implement client-side full-dataset search.

### 9.2 Table

Columns: selection indicator (if needed for navigation only), case ID, exposure, expected outcome, first divergence/control, lifecycle state, financial outcome, evidence coverage, contradictions, policy, owner, opened/age, next safe action.

- Keyboard-operable headers, filter controls, rows/links, and pagination.
- Loading skeleton matches table geometry.
- Pagination announces result range and cursor movement.
- Empty states distinguish no dataset, no exposure, and no filter matches.
- Mobile switches to labeled cards; it does not create an editable graph/table experience.

## 10. Screen C — Case Investigation Workspace

### 10.1 Data sources

Fetch in parallel:

- `GET /v1/cases/:id`
- `GET /v1/cases/:id/money-path`
- `GET /v1/cases/:id/evidence`
- `GET /v1/cases/:id/notes`
- `GET /v1/cases/:id/control-loop`
- `GET /v1/cases/:id/verification`

One panel failure must not erase other safe panels. Display a scoped error/degraded label and preserve current financial state.

### 10.2 Header

- case ID and control;
- exposure amount/currency and materiality;
- case lifecycle and separate financial outcome;
- owner and assignment control for permitted role;
- opened time/age/due;
- evidence coverage and contradiction badge;
- back to queue preserving filters.

Assignment uses expected case version and handles conflicts by refetching.

### 10.3 Expected-versus-observed money path

The default is a deterministic directed lifecycle path with two labeled lanes:

- **Expected:** capture → seller obligation → transfer → recipient settlement → bank credit → ERP closure.
- **Observed:** only persisted observed nodes, with a visible break at the first divergence.

Each node shows type, status, amount, time/due, source badge, and evidence count. Each edge shows relationship type, confidence class, expected/observed, and evidence link. Candidate/contradicted edges are rendered separately and never visually merge into a verified path.

Provide an always-available linear alternative from the API. Screen readers must be able to understand the path without SVG position. The UI never computes authority or promotes edges.

### 10.4 Investigation panel

Show exactly four sections:

1. Finding or abstention.
2. Supporting evidence used.
3. Contradicting and missing evidence.
4. Recommended registered next step.

Show investigation mode (`Offline deterministic demo`, optional external provider, or rules-only degraded), prompt/output schema version, evidence-set hash short form, created time, confidence band, coverage, and safe-to-act. Do not expose chain-of-thought or fake thinking. While genuinely queued/running, show the real backend stage and timestamps; otherwise no animation.

### 10.5 Evidence timeline

Chronological list/table with source icon/text, canonical and raw source event type, event time, ingestion time, amount/currency, authority class, signature/dedupe/quarantine status, and evidence link/reference. Raw payload detail is role-redacted and collapsed. Duplicate/conflict rows explain their safe handling. Contradictions and missing evidence are visually/textually explicit.

Candidate relationships appear in a separate review section. Investigators may `Confirm candidate relationship` or `Reject candidate relationship` only after reviewing cited evidence; both require a reason and current versions. The UI states that confirmation is a reviewed assertion, not terminal financial authority. Stale/conflicting decisions refetch and require a new review.

Provide an operator notes section backed by the case note API. Notes render as plain text with author/time, use bounded input and expected case version, and are visibly distinct from evidence or investigation findings. Notes cannot alter financial state.

### 10.6 Control-loop rail

Separate cards for:

- registered plan and immutable parameters/hash;
- policy decision, bundle, matched rule/reasons;
- approval state/role/requester/approver/expiry/basis hash;
- action status/idempotency/attempt/external reference;
- verification contract/run/blockers/evidence;
- reconciliation allocation/difference/ERP closure.

The backend `allowed_next_commands` controls which contextual action is offered, but every mutation still handles server rejection. Never offer a new-key retry for unknown action outcome.

### 10.7 Contextual commands

Depending on real state/role:

- `Run investigation`
- `Evaluate policy`
- `Request approval`
- `Review approval`
- `Execute simulated remediation`
- `Check status`
- `Request more evidence`
- `Add operator note`
- `Review candidate relationship`
- `View audit replay`

Each command names its actual effect; no generic `Confirm`. Mutations display the exact plan/version/hash or expected resource version before submission.

## 11. Screen D — Approval Review

### 11.1 Queue

Use `GET /v1/approvals` with tabs/filters for Requested, Approved, Rejected, Expired, Invalidated. Default shows Requested sorted by expiry then amount. A viewer may read; only the finance approver gets decision controls.

### 11.2 Review page/drawer content

Display all immutable decision-basis fields in human-readable groups:

- case and current case version;
- plan ID/version/template/hash;
- exact simulated action and target;
- maximum amount impact and currency;
- sealed evidence-set hash and contradiction/blocker summary;
- policy bundle/decision/reasons;
- verification contract key/version;
- requester/preparer identity;
- required approver role;
- expiry with exact UTC/local time;
- decision-basis hash and stable action idempotency key (read-only).

Warnings include synthetic-only effect, no real money, stale/changed basis, role/separation-of-duties, conflict, and expiry.

### 11.3 Decisions

Buttons are explicitly `Approve simulated remediation`, `Reject`, and `Request more evidence`.

- Approve shows a final summary, requires deliberate confirmation, and submits current approval ID/basis hash.
- Reject requires a bounded reason.
- Request more evidence requires a bounded reason and calls its dedicated endpoint.
- Disable double submission and restore focus after modal close.
- `APPROVAL_STALE`/`VERSION_CONFLICT` cannot be overridden; refetch and require rereview.
- After success show the server-derived approver and timestamp, then navigate/refetch the case.

## 12. Screen E — Verification Timeline

Embed on case page and allow an expanded section. Required ordered stages:

```text
Plan authorized
Action reserved
Action submitted
Downstream acknowledged / outcome unknown
Transfer observed
Recipient settlement observed
Independent bank evidence matched
Unique expectation allocation
ERP closure requested
ERP closure observed
Financial outcome verified / unresolved / reversed
```

Every stage shows state (`waiting`, `complete`, `blocked`, `failed`, `unknown`, `reversed`), timestamp, source, evidence link, and explanation. `Downstream acknowledged` must visibly say it is not financial verification. Missing bank, identity/currency/time mismatch, ambiguity, and timeout show blockers. Unknown outcome offers only `Check status`. Reversal remains visible after prior completion.

## 13. Screen F — Audit Replay

### 13.1 Layout and data

Use `GET /v1/cases/:id/audit` with cursor/filter and optional export. Desktop layout:

- left: ordered artifact timeline;
- center: selected artifact summary/detail;
- right: identity, schema/resource versions, hashes, request/correlation IDs, and timestamps.

On smaller screens these become ordered sections/drawers without losing focus order.

### 13.2 Filters

- source facts/evidence;
- derived controls/cases;
- investigation;
- policy;
- human approval;
- simulated action;
- verification/reconciliation;
- reversal/admin/demo.

Timeline order is from backend audit sequence, not client timestamp sorting. Detail shows redacted references, not raw secrets. Export downloads the backend-generated redacted JSON bundle and shows its hash; the client does not reconstruct an authoritative bundle.

## 14. Screen G — Data Health

Use `GET /v1/data-health` and show:

- source capabilities: Razorpay Test configured/unavailable, synthetic OMS/Route/bank/ERP/recovery/agent status;
- investigation mode: offline deterministic demo, optional external, or degraded;
- database/worker/projector readiness and lag;
- events received, exact duplicates, modified conflicts/quarantine, schema failures;
- unlinked records, candidate links, contradictions, stale projections;
- queue/backlog/verification pending counts;
- dataset seed/version/time/record count/manifest hash.

Unavailable optional Razorpay/model connections are warnings, not failed demo readiness, because synthetic/offline adapters are authoritative for prototype availability. Clearly distinguish test/synthetic sources and state what conclusions remain safe.

## 15. Empty, loading, degraded, conflict, and error states

Every screen/panel must intentionally cover:

| State                     | Required message/action                                             |
| ------------------------- | ------------------------------------------------------------------- |
| No dataset                | explain reset/import requirement; operator may open demo controller |
| No exposure               | positive, distinct from no data; no invented metrics                |
| No filter match           | preserve filters and offer clear filters                            |
| Loading                   | layout-matched skeleton; no fake AI stages                          |
| Source degraded           | name source and safe remaining conclusions                          |
| Investigation unavailable | keep deterministic controls/evidence and show rules-only state      |
| Conflicting evidence      | list conflict/blocker, keep exposure, request more evidence         |
| Outcome unknown           | explain ambiguity; `Check status`, never `Retry`                    |
| Stale version/approval    | refetch, discard stale modal state, require fresh review            |
| Permission denied         | explain required role without leaking resource existence/details    |
| Not found                 | safe return link                                                    |
| Network/server error      | preserve safe cached context, retry reads only                      |

## 16. Accessibility requirements

- WCAG-oriented semantic structure: skip link, landmarks, one `h1`, ordered headings, labels/descriptions, table semantics.
- Full keyboard operation for nav, filters, table rows/links, tabs, drawers, dialogs, scenario controller, and approvals.
- Visible focus; focus trap in dialogs/drawers; restore focus to trigger; initial focus on heading or first invalid field as appropriate.
- Live regions announce route/mutation/polling completion without excessive chatter.
- Color is never the only status cue; use text and icons with accessible names.
- Money/status/source/authority have screen-reader text.
- Money path has an equivalent linear list and meaningful node/edge names.
- Reduced-motion preference removes non-essential transitions; no motion communicates required information.
- Dense desktop screens reflow logically at 1024px/768px/mobile; no essential horizontal scrolling except the case table inside a labeled region.
- Error summary links to invalid fields; reasons are specific and safe.

## 17. Responsive behavior

- **Desktop ≥1200px:** persistent nav; case path + control-loop rail; evidence drawer; three-column audit.
- **Tablet 768–1199px:** collapsible nav; stacked path/rail; forensic details in drawers.
- **Mobile <768px:** read-mostly cards, linear path, stacked timeline, deliberate approval flow with full immutable details. No graph editing, bulk actions, or truncated approval basis.

Desktop is the demo target, but all routes must be usable without clipping or inaccessible controls at mobile widths.

## 18. Frontend security and integrity

- No secrets, API keys, database URLs, webhook signatures, auth tokens, raw bank/card data, or hidden labels in source, bundle, storage, logs, DOM, snapshots, or errors.
- Do not use `dangerouslySetInnerHTML` for evidence/model text. Render all untrusted text as plain text.
- Do not trust or derive tenant/role/authority from query parameters/local storage beyond the demo user ID selection.
- Do not compute policy, approval validity, authority, verification, reconciliation, financial outcome, or KPI truth in the browser.
- Do not expose chain-of-thought.
- Do not label synthetic/Test Mode effects as real movement.
- Clear in-memory/cache state on identity switch and demo reset.
- Mutations use the backend's expected version/hash fields; stale state cannot be confirmed.

## 19. Required frontend tests

### 19.1 Unit/component

- BigInt-safe INR formatting for zero, paise, Indian grouping, very large values, negative/reversed, and rejected invalid input.
- API envelope/schema parsing and safe errors.
- Status/artifact label mappings are exhaustive; unknown critical values render an explicit unsupported state, not success.
- Polling starts/stops under exact terminal/visibility/unmount conditions.
- Route/filter URL state.
- Permission-based controls without treating hiding as security.
- Every empty/degraded/conflict/unknown/stale state.

### 19.2 Accessibility/component

- Landmarks/headings/labels/table semantics.
- Keyboard navigation and focus restoration for dialogs/drawers.
- Approval action names and reason validation.
- Money path linear alternative.
- Live-region announcements and reduced motion.
- Color-independent status text/icons.

### 19.3 Integration with real backend contracts

- Validate every example fixture against runtime schemas.
- Overview metrics exactly match backend response.
- Case workspace combines all six endpoints without inventing state.
- Candidate review and notes use real audited APIs, reject stale versions, and never render notes as evidence.
- Stale approval/version, policy denial, unknown outcome, conflict, and incomplete verification errors produce required UI.
- Identity switch changes role-authorized controls after refetch.

### 19.4 Playwright E2E against running API/worker/PostgreSQL

1. Reset and opening claim reversal displays ₹1,20,000 claim, ₹0 verified incremental, and `REVERSED`.
2. Open ₹4,55,000 missing-transfer case, inspect path/evidence, run investigation/policy, switch to approver, approve, switch to operator, execute once, advance evidence, and observe verified closure.
3. Replay duplicate and prove action/allocation counts and audit timeline do not duplicate.
4. Open conflicting-bank case and prove abstention, blocked closure, request-more-evidence, and persistent exposure.
5. Keyboard-only critical path including approval and focus restoration.
6. Desktop/tablet/mobile smoke screenshots or layout assertions.
7. Optional-source/model outage shows Data Health/degraded state while deterministic workflow remains usable.

Tests must not pass by intercepting production APIs with fake success in the full E2E suite.

## 20. Frontend execution sequence

1. **Gate F1 — contracts and shell:** API client/schema parsing, router, identity, design-system decision, shell/nav/error boundaries, formatters.
2. **Gate F2 — read experience:** overview, queue, case header/path/evidence/investigation/control-loop, all non-happy states.
3. **Gate F3 — control interactions:** approval queue/review, contextual case mutations, demo controller, verification polling.
4. **Gate F4 — audit and health:** audit replay/export and Data Health.
5. **Gate F5 — accessibility/E2E/polish:** responsive states, keyboard/focus/reduced motion, real-backend E2E, build/smoke, completion traceability.

Do not defer correctness/accessibility until after visual polish. Keep typecheck, lint, formatting, unit tests, build, and existing E2E green at every gate.

## 21. Frontend definition of done

Frontend is complete only when:

- Every required route, panel, state, action, and responsive/accessibility behavior in this PRD exists.
- All values and statuses come from real backend APIs and pass shared schema validation.
- The complete missing-transfer, claim-reversal, conflict, and duplicate-replay stories work through the UI.
- Facts, investigation, policy, approval, action, verification, reconciliation, and audit are visibly distinct.
- Money never passes through unsafe numeric conversion.
- Unknown/conflict/stale/degraded states cannot trigger unsafe action.
- Full E2E uses a running backend/worker/PostgreSQL and passes twice from reset.
- Typecheck, lint, format, unit, integration, complete tests, production build, API/worker/web smoke, Playwright normal/CI, production dependency audit, secret scan, and port/process cleanup pass.
- No required feature is hidden behind a mock or marked TODO.

Claude's final report must contain:

```text
Frontend PRD section → components/routes/files → tests → result
Backend endpoint → frontend consumer mapping
All routes/screens/states inventory
Four scenario E2E results
Accessibility/keyboard/responsive results
Money-safety, secret, bundle-boundary, and dependency audit results
Known limitations and only the explicitly deferred scope
FULL PROTOTYPE READY FOR CODEX REVIEW: YES/NO
```

`YES` is forbidden if any required backend or frontend item is skipped, mocked, hard-coded, or unverified.

## 22. Final UI prohibitions

1. No fake backend progress, fake AI thinking, hard-coded financial metrics, or invented success.
2. No AI/chat-first home screen.
3. No confidence percentage presented as truth.
4. No acknowledgement presented as verification.
5. No settlement presented as bank evidence.
6. No conflict/candidate hidden to simplify the path.
7. No blind retry for unknown outcomes.
8. No generic confirm button for approval/action.
9. No client-derived financial state, authority, policy, or approval validity.
10. No `Number()`/floating conversion of money.
11. No inaccessible color-only state, keyboard trap, missing focus restoration, or graph without linear alternative.
12. No secret/raw sensitive evidence/hidden labels/chain-of-thought in the browser.
13. No claim that synthetic/Test Mode actions moved real money.

## 23. Source-requirement traceability

| Source requirement/task                                 | Implemented by this PRD                            |
| ------------------------------------------------------- | -------------------------------------------------- |
| Minimum lovable product capability 1: overview          | §§7–8                                              |
| Capability 2: prioritized case queue                    | §9                                                 |
| Capability 3: expected-versus-observed path             | §10.3 plus accessible linear alternative           |
| Capability 4: evidence-backed investigation             | §§10.4–10.5                                        |
| Capability 5: policy and approval                       | §§10.6–11                                          |
| Capability 6: outcome verification timeline             | §12                                                |
| Capability 7: audit replay                              | §13                                                |
| Original Screen F: Data Health                          | §14                                                |
| MT-019 operational shell/overview/queue                 | §§5–9                                              |
| MT-020 investigation/approval/verification/audit/health | §§10–14                                            |
| MT-021 frontend/demo hardening                          | §§7.3, 19–21                                       |
| UX safety/accessibility checklist                       | §§6, 15–19 and §22                                 |
| Four Prove-It scenarios                                 | §§8.2, 10–14, and Playwright requirements in §19.4 |

Full graph editing/exploration, conversational search, settings, policy editing, advanced charts, and mobile editing are explicitly outside the five-day scope rather than represented as unfinished navigation.
