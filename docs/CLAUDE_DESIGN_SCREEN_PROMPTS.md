# MoneyTrace — Claude Design Screen Prompts

**Purpose:** Standalone, copy-ready prompts for producing the complete MoneyTrace prototype UI in Claude Design.

**Source of truth:** `docs/MONEYTRACE_FRONTEND_PRD.md`, with financial-safety constraints inherited from the product PRD, backend PRD, and architecture handoff.

**Output type:** High-fidelity product design only. These prompts do not authorize frontend implementation, mocked production data, or changes to financial semantics.

## How to use this document

1. Paste one complete prompt block into Claude Design at a time.
2. Keep the same MoneyTrace design library, shell proportions, typography, semantic colors, spacing, icons, and component naming across every generated screen.
3. Ask Claude Design to preserve previously generated shared components when moving to the next prompt.
4. Treat monetary values and record content below as representative states from the deterministic demo. In the eventual application, every value must come from a validated backend response and must never be hard-coded.
5. Generate the requested desktop, tablet, and mobile frames. Desktop is the primary jury-demo experience, but reduced-width frames must remain fully usable.
6. Do not ask Claude Design to write application code. React architecture, API integration, testing, and implementation will be specified separately.

## Screen inventory

| Prompt | Experience                         | Route/context                       |
| ------ | ---------------------------------- | ----------------------------------- |
| 01     | Application shell and navigation   | All routes                          |
| 02     | Revenue Integrity Overview         | `/overview`                         |
| 03     | Case Queue                         | `/cases`                            |
| 04     | Case Investigation Workspace       | `/cases/:caseId`                    |
| 05     | Approval Review                    | `/approvals`                        |
| 06     | Expanded Verification Timeline     | Embedded in case workspace          |
| 07     | Audit Replay                       | `/audit?case=…&artifact=…`          |
| 08     | Data Health                        | `/data-health`                      |
| 09     | Demo Scenario Controller           | Operator-only global drawer/modal   |
| 10     | Not-found and system-state library | `*` and reusable route/panel states |

## Prompt 01 — Application Shell and Navigation

```text
Act as a principal product designer creating a high-fidelity enterprise finance application in Claude Design. Design the shared application shell for “MoneyTrace,” a synthetic revenue-integrity and financial-control prototype for Razorpay. This is a design task only: produce polished frames, reusable component specifications, responsive behavior, accessibility annotations, and interaction notes. Do not generate React code.

VISUAL DIRECTION
- Follow the public Razorpay Blade design language: a disciplined enterprise dashboard, crisp hierarchy, neutral canvas, white or subtly elevated surfaces, restrained borders, compact data density, strong blue primary actions, semantic status colors, modern sans-serif typography, and purposeful spacing.
- Use public/semantic design-system concepts rather than copying a private Razorpay screen, logo, illustration, exact token value, or proprietary asset.
- The product brand is MoneyTrace. Use a simple text wordmark and a restrained trace/path motif if a mark is needed. Never present the product as an official Razorpay application.
- The overall feeling should be trustworthy, operational, evidence-led, calm, and suitable for senior finance and engineering reviewers—not playful, consumer-oriented, or AI/chat-first.
- Use semantic tokens rather than hard-coded private color values. Maintain at least WCAG AA contrast. Use status text and an icon in addition to color.

LOCKED PRODUCT RULES
- MoneyTrace is a case-first financial-control interface, not a chatbot.
- Show a persistent “Synthetic Demo” environment badge. Never show “Live,” real-money movement, or a production connection.
- Global navigation order is exactly: Overview, Cases, Approvals, Audit, Data Health.
- Do not add Controls, Reconciliation, Money Paths, Settings, chat, assistant, or unfinished navigation items.
- Keep these artifact classes visibly distinct through label, icon, border/tint, and heading treatment: SOURCE FACT, DERIVED CONTROL, OFFLINE DEMO INVESTIGATION, POLICY DECISION, HUMAN APPROVAL, SIMULATED ACTION, VERIFICATION EVIDENCE, RECONCILIATION, AUDIT.
- Never depict downstream acknowledgement as financial verification, recipient settlement as independent bank evidence, a candidate/conflict as a verified link, or synthetic action as real money movement.
- Use explicit status language such as “Awaiting bank evidence,” “Action acknowledged—not yet verified,” “Conflicting evidence—automatic closure blocked,” “Reversed after refund,” “No exposure,” “No data,” and “Source unavailable.” Avoid vague “Done,” “Success,” and “AI verified.”
- Add a design annotation that API money arrives as decimal-string minor units and must be formatted with BigInt only—never Number(), parseFloat(), or floating-point arithmetic.

DESIGN THREE RESPONSIVE FRAMES
1. Desktop: 1440 × 1024, persistent left navigation and full header.
2. Tablet: 1024 × 1366, collapsible navigation and a compact but complete header.
3. Mobile: 390 × 844, top app bar plus accessible navigation drawer; no clipped identity or environment information.

DESKTOP SHELL
- Add a visible “Skip to main content” link that appears on keyboard focus.
- Persistent left navigation approximately 232–256px wide. At the top show the MoneyTrace wordmark and a small “Revenue integrity control plane” descriptor.
- Navigation items use a simple icon plus text. Give the active item a strong but restrained blue indicator, clear text weight, and accessible focus ring. Include an approval count badge only when backed by data.
- The main header contains, in this order where space allows:
  1. Page-specific breadcrumb or back context.
  2. Dataset context: “Evaluated 25 Aug 2026, 10:50 IST” with accessible UTC detail.
  3. Manifest hash short form, for example “Manifest 7b42…91ef,” as read-only forensic metadata with a copy affordance.
  4. “Synthetic Demo” environment badge with a flask/test icon.
  5. Refresh-current-page icon button with label and tooltip.
  6. Clearly labeled “Demo role” switcher.
  7. “Demo scenarios” button visible only for the Demo Operator/Auditor identity.
- “Razorpay Test connected” may appear only when the Data Health capability response explicitly reports that state; never infer it from environment branding.
- The main content region must have one h1, stable landmarks, generous top spacing, and a max-width that supports dense financial tables without making paragraphs too wide.

DEMO ROLE SWITCHER
- Fixed identities only: Viewer, Investigator / Case Manager, Finance Approver, Demo Operator / Auditor.
- Show human-readable role first and a muted seeded identity beneath or in the menu: user_viewer, user_investigator, user_approver, user_operator.
- Label the control “Demo role”; do not imply the role selection is production authentication.
- Annotate that switching role clears role-sensitive state, refetches the current page, and announces “Demo role changed to [role]” through an assistive live region.
- Show four component variants: closed, open menu, role-change loading/refetching, and server-denied action despite hidden/disabled client controls.

GLOBAL BANNERS
- Design a non-blocking degraded banner below the header. Example: “Optional Razorpay Test source unavailable. Synthetic bank and Route evidence remain available; deterministic demo conclusions are safe.” Include “View Data Health.”
- Design a high-visibility reset-in-progress banner: “Demo reset in progress. Financial mutations are temporarily unavailable.” Disable conflicting commands without removing the rest of the page.
- Use a distinct safe warning treatment, not destructive red unless there is an actual failure.

RESPONSIVE BEHAVIOR
- Tablet: collapse the sidebar to icons or a controlled drawer; preserve labels in tooltips and the drawer. Move dataset metadata into a compact secondary row if necessary.
- Mobile: use a top bar with MoneyTrace, Synthetic Demo badge, navigation trigger, and role avatar/trigger. Put dataset time, manifest hash, refresh, and scenario control in a structured sheet, not an overflowing header.
- Navigation drawer must trap focus while open, close with Escape, restore focus to its trigger, and expose the same five items in the same order.
- Do not hide environment status, selected role, or degraded/reset banners at smaller sizes.

ACCESSIBILITY AND DELIVERABLE ANNOTATIONS
- Show visible keyboard focus for every nav item, icon button, role switcher, and drawer trigger.
- Use semantic landmarks: header, navigation, main, and optional status region.
- Mark icon-only controls with accessible names and tooltips.
- Demonstrate reduced-motion behavior: simple state changes, no decorative movement carrying information.
- Name reusable components in the design: AppShell, PrimaryNavigation, EnvironmentBadge, DatasetContext, DemoRoleSwitcher, GlobalStatusBanner, PageHeader, Breadcrumbs, MobileNavigationDrawer.
- Provide a short annotation panel explaining spacing rhythm, surface hierarchy, status treatment, and the rule that all visible state is API-derived.

Do not place financial KPIs in this shell prompt; use neutral placeholder page content so the output focuses on the reusable shell. Do not add a chat launcher, notification center, real-money badge, marketing illustration, or settings menu.
```

## Prompt 02 — Revenue Integrity Overview

```text
Act as a principal product designer creating a high-fidelity “Revenue Integrity Overview” for MoneyTrace in Claude Design. Produce design frames and annotations only—no React code. This page is URL-addressable at /overview and is the opening jury-demo screen for a synthetic financial-control prototype.

VISUAL SYSTEM AND SHELL
- Use a public Razorpay Blade-inspired enterprise dashboard: neutral page canvas, white/elevated cards, restrained borders and shadows, modern sans-serif type, blue primary actions, compact financial data density, and semantic status colors with text and icons.
- Retain MoneyTrace branding. Include the shared persistent navigation in exactly this order: Overview, Cases, Approvals, Audit, Data Health. Mark Overview active.
- Header: one h1 “Revenue Integrity Overview,” a short evidence-led subtitle, dataset evaluation time, short manifest hash, “Synthetic Demo” badge, refresh, fixed Demo role switcher, and operator-only Demo scenarios button.
- Do not copy private Razorpay assets or exact proprietary screens. Do not add Chat, Settings, Controls, Reconciliation, or Money Paths navigation.

FINANCIAL AND SAFETY RULES
- Money values are authoritative API strings formatted with Indian grouping and explicit currency, for example “₹4,55,000.00 INR.” Never suggest floating-point calculation or client-derived totals.
- Add a design annotation that the implementation must format decimal-string minor units with BigInt only, never Number() or parseFloat().
- Label every scenario stage and dataset timestamp so a judge understands when each number is true.
- Never present an untrusted agent claim as verified value. Never present an action acknowledgement as verification. Never label synthetic effects as real money movement.
- Differentiate zero, “No exposure,” “No data,” and “Unavailable.” Do not use a dash for all four.
- Data below is representative of persisted demo responses for design purposes only; annotate that implementation must bind to GET /v1/overview and related validated read models, not hard-code it.

CREATE FOUR FRAMES
1. Desktop 1440 × 1100: opening claim-reversal state.
2. Desktop 1440 × 1100: missing-transfer remediation verified state.
3. Tablet 1024 × 1366: responsive opening state.
4. Mobile 390 × 844: responsive opening state with cards and structured lists.

PAGE HIERARCHY
1. Dataset and scenario context.
2. Agent-claim truth comparison.
3. Six KPI cards.
4. Operational summaries.
5. Prioritized cases.

TOP CONTEXT ROW
- Show “500 synthetic lifecycle records” and a current scenario-stage chip such as “Claim reversal · step 3 of 3 completed.”
- Add exact evaluation time with local display and accessible UTC detail.
- Add a compact “How to read this page” info action explaining that restored, prevented, reversed, and unresolved are separate outcomes and are never netted together in the browser.

OPENING CATEGORY REVEAL
- Use a prominent but sober comparison panel titled “Agent claim versus retained financial value.”
- Place an “UNTRUSTED AGENT CLAIM” label on the input side and a “DETERMINISTIC RETAINED VALUE” label on the resolved side.
- Show these rows with explicit labels, not a celebratory metric:
  - Agent-reported recovery: ₹1,20,000.00 INR.
  - Recovery payment observed: Yes — linked captured payment evidence.
  - Refund detected later: −₹1,20,000.00 INR · authoritative refund.
  - Final retained value: ₹0.00 INR.
  - Verified incremental recovery: ₹0.00 INR.
  - Outcome: REVERSED — NOT VERIFIED.
- Add an understated equation line: “Eligible captured value − correlated refund = retained value,” explicitly labeled as deterministic.
- Provide “View claim evidence” and “Open audit replay” links when references are available.
- Make reversed status clear through icon, label, and explanatory sentence, not red color alone.

SIX REQUIRED KPI CARDS
Arrange in a balanced 3 × 2 desktop grid, 2 × 3 tablet grid, and one-column/mobile carousel-free stack:
1. Unresolved exposure — representative stable dataset value ₹12,80,000.00 INR; link to filtered Cases.
2. Verified restored — ₹0.00 INR in the opening state; ₹4,55,000.00 INR in the remediation-completed frame.
3. Duplicate collection prevented — representative completed worker state ₹5,00,000.00 INR.
4. Matched records — 468 of 500, with a semantic progress representation and exact text.
5. Unresolved material cases — 16.
6. Unsafe candidate matches blocked — 4, described as abstentions rather than failed matches.
- Every card includes: full value, concise definition tooltip, dataset stage/time, explicit currency where relevant, and a “View cases” or contextual link where supported.
- Do not use dramatic growth arrows, fabricated percentages, or comparison periods not returned by the API.

OPERATIONAL SUMMARIES
- Create three compact, accessible modules:
  1. Exposure by lifecycle state: horizontal structured bars with exact values and a visible text/table alternative.
  2. Case resolution distribution: simple segmented bar or ordered list with exact counts; no donut if labels become cramped.
  3. Opened versus closed cases by UTC day: restrained line/bar combination using persisted daily points, chronological ordering, exact date labels, and a toggle or disclosure for an accessible data table.
- Do not add a chart dependency aesthetic for decoration. Favor readable structured bars and lists.
- Tooltips must repeat exact values in Indian grouping and cannot be the only way to access data.

PRIORITIZED CASE PREVIEW
- Title: “Highest material unresolved cases.” Default order is exposure descending.
- Desktop columns: Case ID, Exposure, Control / first divergence, Lifecycle, Evidence coverage, Contradictions, Owner, Age, Next safe action.
- Use explicit linked Case ID and an accessible “Open case” action. Entire-row hover may reinforce navigation but must not be the only affordance.
- Show evidence coverage as text plus a three-step indicator: Insufficient, Partial, Complete.
- Example row language: “Transfer not observed,” “Awaiting bank evidence,” and “Conflicting evidence—automatic closure blocked.”
- Include “View all cases,” preserving a preselected unresolved/material filter where supported.

STATE VARIANTS
- Opening claim-reversal frame: show ₹0 verified restored, ₹1,20,000 reversed recovery in the truth panel, and label the scenario completed.
- Remediation-completed frame: show ₹4,55,000 verified restored only after bank evidence, unique allocation, and ERP closure; add a concise “Verified after independent evidence” note. Do not imply the Route acknowledgement caused verification.
- Design a no-dataset panel variant: explain that an operator must import/reset the synthetic dataset; viewers get only an explanation, operators get “Open demo controller.”
- Design a no-exposure variant distinct from no data: positive but restrained “No unresolved exposure in the current dataset.”
- Design a scoped loading skeleton matching final card/chart/table geometry, without fake AI progress.

RESPONSIVE AND ACCESSIBILITY REQUIREMENTS
- One h1 and logical h2 sections. Use main and status landmarks.
- Desktop must feel data-dense but not cramped. Keep critical financial values above the fold.
- Tablet stacks the truth panel above a 2-column KPI grid; charts become full-width.
- Mobile places full monetary values before secondary metadata, uses labeled case cards instead of a wide table, and never truncates outcome/status meaning.
- Provide visible focus, keyboard access to cards/links/table controls, non-color status cues, screen-reader full money text, and accessible UTC timestamp detail.
- Name reusable design components: FinancialMetricCard, ClaimTruthComparison, DatasetStage, LifecycleDistribution, OpenClosedTrend, PrioritizedCaseTable, EvidenceCoverageIndicator, ExplicitStatusBadge.

The final design must let a senior judge answer immediately: what is at risk, what was restored, what was prevented, what was reversed, and which claims are not verified.
```

## Prompt 03 — Case Queue

```text
Act as a principal product designer creating the MoneyTrace “Case Queue” at /cases in Claude Design. Produce high-fidelity design frames, component variants, responsive behavior, accessibility annotations, and interaction notes only. Do not generate application code.

VISUAL SYSTEM AND PRODUCT RULES
- Use the same public Razorpay Blade-inspired enterprise design as the MoneyTrace shell: neutral canvas, crisp white/elevated surfaces, restrained dividers, strong blue action/focus color, dense financial tables, modern sans-serif typography, and semantic status treatments with icon plus text.
- Preserve MoneyTrace branding and the “Synthetic Demo” badge. In the left navigation show exactly Overview, Cases, Approvals, Audit, Data Health; mark Cases active.
- Never add chat, Controls, Money Paths, Reconciliation, Settings, real-money indicators, or invented bulk financial actions.
- This is a financial case queue. Lifecycle state and financial outcome are separate columns and must never be collapsed into one generic status.
- Money uses Indian grouping with explicit INR. Status, evidence coverage, contradiction count, owner, and action availability come from backend read models; do not visually imply client-derived truth.
- Add a design annotation that monetary API strings are formatted with BigInt only—never Number(), parseFloat(), or floating-point arithmetic.

CREATE THREE PRIMARY FRAMES AND FOUR COMPONENT VARIANTS
1. Desktop 1440 × 1024 with full queue and filters.
2. Tablet 1024 × 1366 with collapsible filter panel and horizontally contained table region.
3. Mobile 390 × 844 with labeled case cards instead of a desktop table.
4. Variants: loading, no dataset, no filter matches, and server/degraded panel error.

PAGE HEADER
- One h1: “Cases.”
- Subtitle: “Prioritized financial divergences requiring evidence, review, or verified closure.”
- Show total result count, dataset evaluation time, current Demo role, and a safe Refresh action.
- Include no “Create case” button; cases are created by persisted control facts.

URL-BACKED FILTER TOOLBAR
- Required controls:
  - Lifecycle state multi-select.
  - Control ID select.
  - Evidence coverage select: Insufficient, Partial, Complete.
  - Owner select, including Unassigned.
  - Policy status select.
  - Minimum exposure and maximum exposure inputs, clearly labeled as INR.
  - Sort select: Exposure high to low, Exposure low to high, Newest opened, Oldest opened.
  - Search limited to Case ID or supported known identifier; placeholder must say exactly that, not “Search everything.”
- Default sort is Exposure high to low.
- Show active filters as removable chips and provide “Clear filters.”
- Annotate that filters, sort, cursor, and supported search persist in the URL for shareability/back-forward behavior.
- Do not add client-side full-dataset search, arbitrary column builder, saved views, bulk remediation, or export.

DESKTOP CASE TABLE
- Use sticky column headers where useful and a clearly labeled horizontally scrollable region only if unavoidable.
- Exact required columns, in a readable priority order:
  1. Case ID — explicit link.
  2. Exposure.
  3. Expected outcome.
  4. First divergence / control.
  5. Lifecycle state.
  6. Financial outcome.
  7. Evidence coverage.
  8. Contradictions.
  9. Policy.
  10. Owner.
  11. Opened / age.
  12. Next safe action.
- A navigation-only selection/chevron indicator is acceptable, but do not imply a bulk action workflow.
- Exposure is the strongest cell after Case ID. Format full values such as ₹4,55,000.00 INR and ₹80,000.00 INR.
- Keep lifecycle examples explicit: Open, Investigating, Approval required, Verification pending, Reconciled, Abstained.
- Keep financial outcomes explicit: DIVERGED, ACTION PENDING, VERIFIED, REVERSED, UNRESOLVED.
- Evidence coverage uses text plus a small three-segment indicator. Contradiction count uses text/icon and never disappears when zero.
- “Next safe action” is plain language derived from state, such as Run investigation, Review approval, Check status, or Request more evidence. It is not necessarily a button in the queue.
- Use example rows representing the four demo stories: missing transfer ₹4,55,000; claim reversed to ₹0; conflicting bank evidence; duplicate/replay-safe case. Label all content synthetic.

ROW INTERACTION
- Case ID is always an accessible link. The row may have hover/selected styling, but row click is not the only navigation method.
- Keyboard focus order moves logically through filter controls, headers, links, and pagination.
- Preserve current filters when navigating into a case so the case page can return to the same queue state.
- Add clear hover, focus, and current-row states without using color alone.

PAGINATION
- Use cursor-style Previous and Next controls plus visible text such as “Showing 1–25 of 21 current results” when a total is available; otherwise use a truthful “25 results on this page.”
- Announce page/result changes through a polite live region.
- Never show invented page numbers if the backend is cursor-based.

EMPTY, LOADING, AND ERROR STATES
- Loading: layout-matched row skeletons, preserving all column geometry; no fake investigation or AI animation.
- No dataset: explain that the synthetic dataset must be imported/reset. Viewer sees guidance; Demo Operator sees “Open demo controller.”
- No filter matches: preserve all filters, say “No cases match these filters,” and offer “Clear filters.”
- No exposure: distinguish from no data; explain that cases may still exist with verified/reversed outcomes.
- Permission denied: state the required viewer access without confirming whether a hidden tenant resource exists.
- Server/read error: preserve the shell and last safe filter context; offer Retry only for the safe read.

TABLET AND MOBILE
- Tablet uses a collapsible filter drawer or top panel and a labeled table-scroll region. Freeze Case ID and Exposure only if it remains accessible.
- Mobile replaces each row with a structured card: Case ID + exposure at top, then lifecycle and financial outcome, divergence/control, evidence/contradictions, owner/age, and explicit “Open case.”
- Mobile filters open in a focus-trapped bottom sheet/drawer with Apply and Clear; closing restores focus.
- Do not hide critical fields on mobile. Secondary forensic fields may move into a “More case details” disclosure.

ACCESSIBILITY AND COMPONENT OUTPUT
- Use semantic table markup in annotations, scope-aware headers, a caption or accessible table label, and screen-reader descriptions for money/status.
- Use visible focus, 44px minimum touch targets where practical, icon-plus-text statuses, and no color-only sorting indicator.
- Name reusable components: CaseFilterBar, ActiveFilterChips, CaseTable, CaseMobileCard, MoneyCell, LifecycleBadge, FinancialOutcomeBadge, EvidenceCoverageIndicator, CursorPagination, QueueEmptyState.
- Include a compact annotation that all requests use backend allowlisted query values and all visual states are validated API data.

The resulting queue should help a finance operator identify the highest material safe next step in seconds without implying that the UI itself calculated policy, verification, or outcome.
```

## Prompt 04 — Case Investigation Workspace

```text
Act as a principal product designer creating MoneyTrace’s core “Case Investigation Workspace” at /cases/:caseId in Claude Design. This is the most important screen in the prototype. Produce high-fidelity frames, reusable components, state variants, responsive layouts, accessibility annotations, and interaction notes only. Do not generate React code.

PRODUCT AND VISUAL DIRECTION
- Create a case-first, evidence-led financial operations workspace using the public Razorpay Blade-inspired design language: neutral canvas, compact enterprise density, layered white surfaces, restrained borders/shadows, modern sans-serif typography, blue actions, and semantic icon-plus-text statuses.
- Retain MoneyTrace branding and show “Synthetic Demo.” Use the shared navigation in exactly this order: Overview, Cases, Approvals, Audit, Data Health; mark Cases active.
- Do not copy private Razorpay assets or add chat, Settings, Controls, standalone Reconciliation, or standalone Money Paths navigation.
- The screen must let a senior finance or engineering reviewer distinguish source facts, deterministic controls, offline demo investigation, policy, human approval, simulated action, verification evidence, reconciliation, and audit without reading code.
- Never compute or promote financial truth in the design. Candidate edges remain candidate, conflicting evidence remains visible, acknowledgement is not verification, settlement is not bank evidence, and synthetic action is not real money movement.
- Add a design annotation that every monetary API value is a decimal-string minor-unit amount formatted with BigInt only, never Number() or parseFloat().

CREATE THESE FRAMES
1. Desktop 1440 × 1200 — ₹4,55,000 missing-transfer case at approval-required state.
2. Desktop state variant — action acknowledged but not financially verified.
3. Desktop state variant — unique reconciliation plus observed ERP closure, VERIFIED.
4. Desktop state variant — conflicting bank evidence, automatic closure blocked, exposure retained.
5. Desktop state variant — prior recovery reversed after authoritative refund; previous completion remains visible.
6. Tablet 1024 × 1366 — missing-transfer state with stacked path and control-loop rail.
7. Mobile 390 × 844 — read-mostly linear case workspace with deliberate contextual commands.

PAGE DATA SOURCES AND FAILURE ISOLATION
Annotate that the screen composes six independently validated backend panels in parallel:
- GET /v1/cases/:id — Case detail.
- GET /v1/cases/:id/money-path — Money path.
- GET /v1/cases/:id/evidence — Evidence timeline.
- GET /v1/cases/:id/notes — Operator notes.
- GET /v1/cases/:id/control-loop — Control-loop view.
- GET /v1/cases/:id/verification — Verification view.
One failed panel must show a scoped error and safe Retry for that read without erasing the other five panels or the last known financial context.

CASE HEADER
- Breadcrumb/back link: “Cases / [Case ID]” and “Back to cases,” preserving queue filters.
- One h1 using a readable Case ID, with control ID and epoch nearby.
- Make exposure the strongest value: representative “₹4,55,000.00 INR at risk.”
- Show materiality/priority, lifecycle state, and financial outcome as three separate concepts.
- Show owner with assignment control only for permitted roles; include Unassigned state.
- Show Opened, Age, Due, and exact timestamps; local time is primary and accessible UTC detail is available.
- Show Evidence coverage and Contradictions as separate badges.
- Show a short, explicit summary such as “Seller transfer not observed after captured payment.”
- Assignment must expose expected case version before submission and show a stale-version refetch state.

PRIMARY DESKTOP LAYOUT
- Use a wide main column and a 320–380px control-loop rail.
- Main column order: expected-versus-observed money path, investigation, evidence/candidate review/notes.
- Right rail order: registered plan, policy decision, human approval, simulated action, verification, reconciliation, then contextual commands.
- Keep the critical exposure, divergence, and current safe next step visible near the top.

EXPECTED-VERSUS-OBSERVED MONEY PATH
- Build a deterministic two-lane directed lifecycle visualization.
- Expected lane, always visible: Capture → Seller obligation → Transfer → Recipient settlement → Bank credit → ERP closure.
- Observed lane: only persisted nodes. Show a clear visible break at the first divergence.
- Every node displays type, explicit status, amount/currency if present, event/due time, source badge, and evidence count.
- Every edge displays relationship type, confidence class, expected/observed classification, and cited evidence affordance.
- Verified/asserted/derived edges may use solid or semantically differentiated lines. Candidate, rejected, and contradicted edges must be visually separate and must never merge into the verified path.
- For the missing-transfer frame, show Capture and Seller obligation observed, then a clear gap where Transfer is expected. Label it “First divergence · Transfer not observed.”
- For conflicting bank evidence, render competing candidate bank links in a separate ambiguity area with “Conflicting evidence—automatic closure blocked.” Never pick one visually.
- Include a visible “Linear view” control and an always-available ordered textual alternative that explains each node/edge without relying on SVG position.
- Screen readers must be able to understand the path in logical order. Do not create an editable graph.

INVESTIGATION PANEL
- Artifact header badge: “OFFLINE DEMO INVESTIGATION” with a clear deterministic/offline icon.
- Exactly four numbered sections:
  1. Finding or abstention.
  2. Supporting evidence used.
  3. Contradicting and missing evidence.
  4. Recommended registered next step.
- Metadata strip: mode, prompt version, output schema version, evidence-set hash short form, created time, confidence band, evidence coverage, contradiction count, and Safe to act / Not safe to act.
- Confidence is a band such as Low/Medium/High, not a percentage or financial truth. Pair it with evidence coverage and blockers.
- Never show chain-of-thought, typewriter “thinking,” fake stages, or anthropomorphic AI chat.
- Genuine queued/running state may show backend stage and timestamps only. Rules-only degradation must retain deterministic controls and clearly state what remains safe.

EVIDENCE TIMELINE
- Use an accessible chronological table/list. Include:
  - Source icon and text.
  - Canonical event type.
  - Raw source event type.
  - Event time.
  - Ingested time, separately labeled.
  - Amount/currency.
  - Authority class.
  - Signature status.
  - Duplicate status.
  - Quarantine/conflict status.
  - Evidence reference/link.
- Use explicit “SOURCE FACT” and “VERIFICATION EVIDENCE” labels where applicable.
- Raw payload details are collapsed, redacted, and visible only as safe references. Never show signatures, secrets, raw bank/card data, or hidden labels.
- Duplicate rows explain “Exact replay ignored; original evidence retained.” Conflict rows explain “Modified duplicate quarantined; authoritative state not overwritten.”
- Contradictions and missing evidence receive separate, explicit sections or callouts.

CANDIDATE RELATIONSHIP REVIEW
- Keep candidate links in a distinct review panel, never inside the verified path.
- Show cited source/target nodes, relationship, candidate confidence class, current link version, and supporting evidence.
- Investigator controls: “Confirm candidate relationship” and “Reject candidate relationship.” Each opens a reason dialog and displays expected current versions.
- State explicitly: “Confirmation records a reviewed assertion; it is not terminal financial authority.”
- Design stale/version-conflict feedback that closes the old dialog, refetches, announces the change, and requires fresh review.

OPERATOR NOTES
- Visibly separate notes from evidence and findings. Label “Operator notes · not financial evidence.”
- Notes show plain text, author, and exact time. No rich HTML or markdown rendering.
- Bounded text field, current case version, Add note action, character count, validation, submitted state, and stale-version recovery.
- Notes can document review context but cannot change financial state.

CONTROL-LOOP RAIL
Use six separate artifact cards with clear labels and no visual blending:
1. REGISTERED PLAN — template, immutable parameters, plan version, short hash, status.
2. POLICY DECISION — decision, bundle version, matched rule and reasons; missing/default-deny is explicit.
3. HUMAN APPROVAL — state, required role, requester, approver, expiry, basis hash, stale/invalidated warning.
4. SIMULATED ACTION — action type, status, stable idempotency reference, attempt, synthetic external reference; show “No real money movement.”
5. VERIFICATION EVIDENCE — contract/run status, coverage, blockers, cited evidence. ACK is separately labeled and never enough.
6. RECONCILIATION — allocation status, difference, bank evidence, ERP closure requested/observed, reversal if present.
- Collapsed cards show a trustworthy one-line summary; expanded cards reveal immutable IDs/versions/hashes without overwhelming the page.

CONTEXTUAL COMMANDS
Render only commands returned by the backend’s allowed-next-commands state and permitted for the current Demo role:
- Run investigation.
- Evaluate policy.
- Request approval.
- Review approval.
- Execute simulated remediation.
- Check status.
- Request more evidence.
- Add operator note.
- Review candidate relationship.
- View audit replay.
Use exact effect-oriented button labels. Never use generic “Confirm.” Before submission, dialogs show the exact plan/version/hash or expected resource version.
- No optimistic financial success. After mutation, show request-in-flight, then refetch authoritative state.
- OUTCOME_UNKNOWN offers only “Check status,” never Retry or a new idempotency key.
- APPROVAL_STALE / VERSION_CONFLICT closes the stale decision UI and requires a rereview.
- RECONCILIATION_AMBIGUOUS / VERIFICATION_INCOMPLETE keeps exposure visible and lists missing/blocking evidence.

STATE-SPECIFIC CONTENT
- Approval-required frame: lifecycle APPROVAL REQUIRED, outcome DIVERGED, plan and policy visible, approval requested, Finance Approver required. Primary safe action is Review approval for the approver or read-only status for others.
- Acknowledged frame: lifecycle VERIFICATION PENDING, outcome ACTION PENDING. Use a prominent message: “Action acknowledged—not yet financially verified.” Bank allocation and ERP closure remain waiting.
- Verified frame: lifecycle RECONCILED, outcome VERIFIED. Show transfer, recipient settlement, independent bank evidence, unique allocation, and ERP closure observed as separate completed facts. Explain that verification occurred only after all required evidence.
- Conflict frame: outcome UNRESOLVED, competing bank candidates visible, automatic closure blocked, exposure ₹4,55,000.00 INR remains visible. Offer Request more evidence, not execution.
- Reversal frame: outcome REVERSED with “Reversed after refund.” Keep the prior verified/completed timeline visible and append the authoritative reversal; never erase history or turn the state directly back to VERIFIED.

RESPONSIVE AND ACCESSIBILITY
- Tablet stacks the money path above the control-loop rail; rail cards become a full-width sequence. Forensic evidence details may use accessible drawers.
- Mobile defaults to the API-provided linear path, stacked artifact cards, and a sticky but non-obscuring “Current safe action” area. Do not truncate approval basis, blockers, or money.
- Full keyboard operation for path/list toggles, tabs/disclosures, candidate review, notes, dialogs, commands, and audit links.
- Focus traps in dialogs/drawers, focus restoration, visible focus, live announcements for mutation/polling completion, and an error summary linked to invalid fields.
- Use one h1, ordered headings, landmarks, semantic tables/lists, full money screen-reader text, exact timestamp detail, reduced-motion behavior, and icon-plus-text statuses.
- Name reusable components: CaseFinancialHeader, MoneyPathLanes, MoneyPathLinearAlternative, InvestigationSummary, EvidenceTimeline, CandidateRelationshipReview, OperatorNotes, ControlLoopRail, ArtifactCard, ContextualCommandBar, ScopedPanelError.

The resulting workspace must tell the complete story: what should have happened, what was observed, where the first divergence occurred, what evidence supports or contradicts it, what policy and approval allowed, what simulated action occurred, and whether its financial effect was independently verified, reconciled, closed, or reversed.
```

## Prompt 05 — Approval Review

```text
Act as a principal product designer creating MoneyTrace’s “Approval Review” experience at /approvals in Claude Design. Produce polished design frames, queue and drawer/modal variants, responsive behavior, accessibility notes, and interaction annotations only. Do not generate React code.

VISUAL AND PRODUCT FOUNDATION
- Follow the public Razorpay Blade-inspired enterprise dashboard language: neutral canvas, crisp elevated surfaces, compact but legible tables, restrained borders/shadows, blue primary actions, modern sans-serif typography, and explicit semantic statuses using icon plus text.
- Keep MoneyTrace branding and “Synthetic Demo” visible. Shared navigation order is exactly Overview, Cases, Approvals, Audit, Data Health; mark Approvals active.
- Do not copy private Razorpay assets or add chat, Settings, Controls, Reconciliation, or Money Paths navigation.
- This is deliberate financial authorization for a synthetic action. It must feel serious, reviewable, immutable, and safe—not like a one-click consumer confirmation.
- Viewer can read approval records. Only Finance Approver can decide. Client visibility is not security; annotate that server authorization remains authoritative.
- Add a design annotation that amount-impact strings are formatted with BigInt only, never Number(), parseFloat(), or client-side financial arithmetic.

CREATE THESE FRAMES
1. Desktop 1440 × 1100 — Requested queue with approval review drawer open for a ₹4,55,000 remediation.
2. Desktop — Viewer read-only state.
3. Desktop — stale/invalidated basis state after refetch.
4. Tablet 1024 × 1366 — queue plus full-height review drawer.
5. Mobile 390 × 844 — approval queue cards and a deliberate full-screen review flow with all immutable details.

QUEUE HEADER AND TABS
- One h1: “Approvals.”
- Subtitle: “Review immutable decision bases for synthetic financial remediation.”
- Add a non-dismissable compact notice: “Synthetic demo only · Approval cannot move real money.”
- Tabs/filters are exactly Requested, Approved, Rejected, Expired, Invalidated.
- Default tab Requested, sorted by expiry first and then material amount.
- Show tab counts only if backed by API response.
- Include filter/search controls only for supported case/approval identifiers and backend allowlisted values. Do not invent full-text search.

APPROVAL QUEUE
- Desktop columns: Approval ID, Case ID, Amount impact, Exact simulated action, Requester, Required role, Requested at, Expires, State, Review.
- Exposure/amount uses full Indian-grouped INR, for example ₹4,55,000.00 INR.
- Expiry shows local time, relative urgency, and accessible exact UTC time. Use warning treatment before expiry without relying on color.
- State labels are exact: REQUESTED, APPROVED, REJECTED, EXPIRED, INVALIDATED.
- Use explicit “Review approval” link/button. Do not call it “Approve” from the queue.
- Historical rows show server-derived approver/decision/time where applicable.

REVIEW DRAWER / DETAIL EXPERIENCE
- Desktop drawer approximately 520–640px wide or a split review panel. Mobile becomes a full-screen deliberate review route/sheet. Preserve queue context behind it.
- Start with case link, amount impact, approval state, expiry, and a “No real money movement” warning.
- Organize all immutable decision-basis fields into readable groups, without omitting or truncating critical data:

Group 1 — Case basis
- Case ID.
- Current bound case version.
- Control/divergence summary from related case context.

Group 2 — Registered plan
- Plan ID.
- Plan version.
- Template/action name.
- Plan hash.
- Exact immutable parameters and target.

Group 3 — Financial impact
- Exact simulated action.
- Target.
- Maximum amount impact in minor-unit-derived formatted value.
- Explicit INR currency.

Group 4 — Evidence and blockers
- Sealed evidence-set hash.
- Evidence coverage.
- Contradiction count and blocker summary.
- Link to inspect the case evidence without losing review context.

Group 5 — Policy and verification contract
- Policy bundle version.
- Policy decision ID and decision.
- Matched rules/reasons.
- Verification contract key and version.

Group 6 — Authorization
- Requester/preparer identity.
- Required approver role.
- Expiry in local and exact UTC time.
- Decision-basis hash.
- Stable action idempotency key, read-only.

- Long hashes use short visual form plus a copy/reveal affordance; accessible name exposes the full value. Never treat hashes as editable fields.
- Show artifact labels: REGISTERED PLAN, POLICY DECISION, HUMAN APPROVAL, and SIMULATED ACTION.

WARNINGS
- Synthetic-only effect / no real money.
- Stale or changed case/plan/evidence/policy basis.
- Blocking/conflicting evidence.
- Approval expiry.
- Required-role mismatch.
- Separation of duties: requester/preparer cannot self-approve.
- Use explicit text and icon. Warnings cannot be dismissed to override policy.

DECISION ACTIONS
- Exact buttons:
  1. “Approve simulated remediation.”
  2. “Reject.”
  3. “Request more evidence.”
- Never use a generic Confirm button.
- Approve opens a final deliberate confirmation dialog containing: action, target, maximum INR impact, case/plan versions, evidence hash, decision-basis hash, expiry, and “Synthetic action—no real money movement.” Final action remains “Approve simulated remediation.”
- Reject opens a bounded required-reason dialog. Final action “Reject remediation.”
- Request more evidence opens a bounded required-reason dialog. Final action “Request more evidence.”
- Disable double submission while in flight. Do not optimistically mark approved; close/refocus only after authoritative response and refetch.
- After success show server-derived approver identity and timestamp, announce the outcome, and provide “Open case.”

ROLE AND ERROR STATES
- Finance Approver: decision controls available only for current REQUESTED basis when role/separation/expiry rules permit.
- Viewer: all immutable details readable, controls replaced with “Finance Approver role required.”
- Requester/Investigator self-approval attempt: do not merely hide the button; show separation-of-duties explanation if the server denies.
- APPROVAL_STALE or VERSION_CONFLICT: close the stale confirmation dialog, preserve safe queue context, refetch, announce “Approval basis changed. Review the updated details,” and require fresh review.
- EXPIRED or INVALIDATED: show historical decision basis and termination reason, with no override control.
- Permission denied must not leak a cross-tenant approval’s existence.
- Annotate the real endpoints represented by the design: GET /v1/approvals and the case-scoped approve, reject, and request-more-evidence mutations. The design never constructs a substitute approval state locally.

RESPONSIVE AND ACCESSIBILITY
- Tablet uses a full-height drawer with queue still understandable behind it.
- Mobile uses labeled approval cards and a full-screen review with a sticky action area only after every immutable section remains reachable. Do not truncate decision basis or hide hashes behind inaccessible hover.
- Semantic tabs, table headers, headings, dialog labels/descriptions, reason validation, visible focus, Escape handling, focus trap, and focus restoration.
- Add an error summary linked to the reason field. Announce approval changes through a polite live region.
- Status cannot be color-only. Time cannot be relative-only. Full monetary values must be available to screen readers.
- Name reusable components: ApprovalTabs, ApprovalQueueTable, ApprovalMobileCard, ApprovalReviewDrawer, DecisionBasisGroup, ImmutableHashField, SyntheticActionWarning, ApprovalDecisionDialog, ApprovalStateBadge, ExpiryIndicator.

The design must make it impossible to confuse “reviewing a simulated action” with approving real money, and impossible to approve without seeing the exact immutable basis.
```

## Prompt 06 — Expanded Verification Timeline

```text
Act as a principal product designer creating MoneyTrace’s expanded “Verification Timeline,” embedded in the case workspace and optionally displayed as a full-width expanded section. Produce high-fidelity state variants, responsive layouts, component definitions, accessibility annotations, and interaction notes only. Do not generate code.

VISUAL AND SAFETY FOUNDATION
- Use the same public Razorpay Blade-inspired MoneyTrace system: neutral enterprise canvas, white/elevated surfaces, restrained borders, modern sans-serif typography, blue focus/actions, and semantic statuses using text, icon, shape, and color together.
- Always show “Synthetic Demo” context and the artifact label “VERIFICATION EVIDENCE.”
- This timeline proves financial effect. It must never collapse action submission, acknowledgement, recipient settlement, bank proof, allocation, ERP closure, and terminal outcome into one generic progress step.
- Never use “AI verified,” generic “Success,” or a celebratory completion animation.
- Acknowledgement is not financial verification. Recipient settlement is not independent bank evidence. ERP closure requested is not ERP closure observed. Unknown outcome cannot be retried blindly.
- Add a design annotation that verification amounts remain decimal-string minor units formatted with BigInt only, never Number() or parseFloat().

CREATE SIX DESKTOP STATE FRAMES PLUS RESPONSIVE FRAMES
1. Waiting for action submission.
2. Downstream acknowledged but not verified.
3. Blocked by missing bank evidence.
4. Blocked by ambiguous reconciliation.
5. Fully verified after observed ERP closure.
6. Reversed after authoritative refund/reversal, preserving the prior completion.
7. Tablet 1024px adaptation of the acknowledged state.
8. Mobile 390px stacked timeline of the verified state.

HEADER SUMMARY
- Title: “Financial effect verification.”
- Show financial outcome separately from action status.
- Show verification contract key/version, current run version, evidence coverage, blocker count, last evaluated time, and short evidence-set hash.
- Add a compact rule statement: “Verification requires authoritative evidence, unique reconciliation, and observed closure.”
- If action status is ACKNOWLEDGED or OUTCOME_UNKNOWN, display it in a separate callout from verification result.

ORDERED STAGES — USE EXACTLY THIS ORDER
1. Plan authorized.
2. Action reserved.
3. Action submitted.
4. Downstream acknowledged / outcome unknown.
5. Transfer observed.
6. Recipient settlement observed.
7. Independent bank evidence matched.
8. Unique expectation allocation.
9. ERP closure requested.
10. ERP closure observed.
11. Financial outcome verified / unresolved / reversed.

STAGE DESIGN
- Every stage shows:
  - Exact stage name.
  - State: Waiting, Complete, Blocked, Failed, Unknown, or Reversed.
  - Exact timestamp where present, with local display and UTC detail.
  - Source system and capability label, such as Synthetic Route, Synthetic Bank, or Synthetic ERP.
  - Evidence reference link where present.
  - One concise explanation of why the stage has that state.
- Use a vertical timeline for tablet/mobile and a spacious horizontal/vertical hybrid for desktop if readability is maintained.
- Completed connecting lines must stop at the last completed fact. Do not visually fill future stages.
- Blocked stages list concrete blockers such as Missing bank credit, Identity mismatch, Currency mismatch, Time-window mismatch, Multiple candidates, Closure not observed, or Verification timeout.
- Unknown uses a distinct question/uncertainty icon and text; it is not Failed.
- Reversal is appended after the prior verified path. Do not repaint or erase historical complete stages.

STATE CONTENT
- Acknowledged frame: stage 4 complete/acknowledged while stages 5–11 wait. Add a prominent explanatory banner: “Action acknowledged—not yet financially verified.” The only contextual action is “Check status.”
- Missing-bank frame: transfer and recipient settlement may be complete, bank evidence blocked/waiting, allocation and closure waiting. Explain: “Settlement confirms recipient processing; it is not bank proof.”
- Ambiguous frame: bank evidence present but unique allocation blocked. Show competing candidate count/reference and “Conflicting evidence—automatic closure blocked.” Keep exposure amount visible and terminal outcome UNRESOLVED.
- Verified frame: every required evidence stage complete, unique allocation complete, closure requested and separately observed, terminal outcome VERIFIED with exact verified amount ₹4,55,000.00 INR. Include “Verified after independent evidence,” not generic success.
- Reversed frame: preserve prior completed stages, append authoritative refund/reversal evidence, show −₹1,20,000.00 INR reversed and retained value ₹0.00 INR, outcome REVERSED — NOT VERIFIED.
- Failed frame is reserved for a genuine failed stage; do not use it for missing evidence or unknown outcome.

BLOCKER AND EVIDENCE DRAWER
- Provide an optional side drawer/detail panel opened from a stage.
- Show safe evidence metadata: event type, source, event and ingestion times, amount/currency, authority class, signature status, evidence ID, and redacted references.
- Do not show raw secrets, signature values, raw bank/card data, hidden labels, or untrusted HTML.
- Missing evidence detail should say what is required and what safe conclusion remains possible.

INTERACTIONS
- Bind the read experience to GET /v1/cases/:id/verification. “Check status” invokes POST /v1/actions/:id/verification-checks using the current persisted version; show in-flight state and refetch authoritative result.
- OUTCOME_UNKNOWN never shows Retry, Resubmit, or Execute again.
- VERIFICATION_INCOMPLETE keeps blockers and exposure visible.
- RECONCILIATION_AMBIGUOUS offers Request more evidence or View evidence, not automatic resolution.
- Stage evidence links open the case evidence section or audit artifact while preserving case context.

RESPONSIVE AND ACCESSIBILITY
- Desktop can use a two-column layout: timeline plus blocker/evidence detail.
- Tablet stacks the summary and timeline; evidence details use a focus-trapped drawer.
- Mobile uses one vertical ordered list with no horizontal scroll. Full stage names, amounts, blockers, and evidence links remain visible.
- Use an ordered list/timeline semantic annotation so screen readers receive the same order independent of visual position.
- Announce verification changes without excessive polling chatter. Visible focus, icon-plus-text state, exact timestamps, screen-reader money text, focus restoration, and reduced motion are required.
- Name reusable components: VerificationSummary, VerificationStageList, VerificationStage, VerificationBlockerList, EvidenceDetailDrawer, AcknowledgementNotVerificationBanner, ReversalAppendix, CheckStatusAction.

The design must make the evidence threshold legible: no user should infer VERIFIED until independent bank evidence, one-to-one allocation, and observed ERP closure are all explicitly complete.
```

## Prompt 07 — Audit Replay

```text
Act as a principal product designer creating MoneyTrace’s “Audit Replay” at /audit?case=[caseId]&artifact=[artifactId] in Claude Design. Produce high-fidelity desktop, tablet, and mobile frames, reusable components, accessibility notes, and interaction annotations only. Do not generate application code.

VISUAL AND PRODUCT FOUNDATION
- Use the shared public Razorpay Blade-inspired MoneyTrace design: neutral enterprise canvas, layered white surfaces, restrained dividers, modern sans-serif typography, blue actions/focus, compact forensic density, and semantic artifact/status labels using text plus icons.
- Keep MoneyTrace branding and “Synthetic Demo.” Navigation order is exactly Overview, Cases, Approvals, Audit, Data Health; mark Audit active.
- Do not add chat, Settings, Controls, Reconciliation, Money Paths, or unapproved administration screens.
- Audit is an ordered replay of persisted backend facts. Timeline order comes only from server audit_sequence, never client timestamp sorting.
- Show redacted references and safe metadata only. Never show secrets, credentials, webhook signatures, raw bank/card data, PII, hidden labels, model chain-of-thought, or raw provider/database errors.
- Add a design annotation that any monetary audit field is formatted from decimal-string minor units with BigInt only, never Number() or parseFloat().

CREATE THESE FRAMES
1. Desktop 1440 × 1100 — selected case and selected verification artifact in a three-column forensic layout.
2. Desktop — no case selected.
3. Desktop — role-redacted artifact detail.
4. Tablet 1024 × 1366 — timeline plus detail drawer.
5. Mobile 390 × 844 — ordered sections with artifact detail in a full-screen drawer.

PAGE HEADER
- One h1: “Audit Replay.”
- Subtitle: “Ordered, immutable facts and decisions for a financial case.”
- Case selector/search limited to supported Case ID or known identifier. If entered through a case, show breadcrumb back to that case.
- Show current Case ID, audit entry count where available, latest sequence, and redaction profile/role.
- Add “Export redacted audit” only when a case is selected and access is permitted.

DESKTOP THREE-COLUMN LAYOUT

LEFT — ORDERED ARTIFACT TIMELINE
- Approximately 300–340px wide.
- Each item shows audit sequence number, artifact category label/icon, concise event name, actor/system, and created time.
- Preserve server order strictly. Display time is informative but never the sort authority.
- Artifact groups/filters:
  1. Source facts / evidence.
  2. Derived controls / cases.
  3. Investigation.
  4. Policy.
  5. Human approval.
  6. Simulated action.
  7. Verification / reconciliation.
  8. Reversal / admin / demo.
- Map backend artifact types visibly: EVIDENCE, INVESTIGATION, FINDING, POLICY_DECISION, APPROVAL, ACTION, VERIFICATION, RECONCILIATION, CASE_TRANSITION, MANUAL_LINK, ADMIN_CHANGE, AGENT_CLAIM, CLAIM_EVALUATION, RECEIVABLE_CLOSURE, RECONCILIATION_REVERSAL, DATASET_IMPORT, DEMO_COMMAND.
- Selected item has strong focus/selection styling. Filters update the URL where practical and do not reorder the result.

CENTER — SELECTED ARTIFACT SUMMARY
- Approximately 480–600px wide.
- Artifact label, readable action/event title, sequence, immutable artifact ID, concise safe explanation, outcome/status, and links to related case/evidence where present.
- Render source facts, investigation, policy, approval, action, verification, reconciliation, reversal, and demo/admin artifacts with distinct card templates while preserving a common hierarchy.
- For approval: requester, approver, decision, expiry, and basis hash.
- For action: simulated action type, status, idempotency reference, synthetic external reference, and “No real money movement.”
- For verification: contract/run, evidence coverage, blockers, result, and amount.
- For reconciliation: allocation status, bank evidence reference, expectation, difference, closure, and reversal.
- Never render raw JSON as the default content. A safe structured metadata disclosure is acceptable.

RIGHT — FORENSIC METADATA
- Approximately 300–340px wide.
- Show identity/actor, actor role, schema version, resource/contract/policy/prompt/model versions when present, artifact hash, evidence-set hash, request/correlation IDs when available, created time, and local/UTC timestamp detail.
- Long identifiers/hashes use short display with accessible full-value copy/reveal.
- Clearly label unavailable fields as “Not recorded for this artifact,” not a dash that could mean zero.
- Redacted fields show “Redacted for current role” and a lock icon without leaking the hidden value or cross-tenant existence.

FILTERS AND URL STATE
- Filter control supports the eight required artifact categories.
- Provide All artifacts and active filter chips.
- Store selected case, filters/cursor, and selected artifact in the URL where practical so back/forward and shared links restore context.
- Cursor controls use Previous/Next and preserve selected filters. Announce new result ranges.

EXPORT FLOW
- Button: “Export redacted audit.”
- The client downloads the backend-generated JSON bundle; it must not reconstruct an authoritative export in the browser.
- Confirmation/detail sheet shows Case ID, generated time, entry count, and content SHA-256 returned by the backend and echoed in a safe response header.
- Include Copy hash and Download JSON. Never imply local recomputation of the authoritative hash.
- Show server error safely and preserve the audit page. Retry is allowed only as a safe idempotent read/download.
- Annotate that the timeline binds to GET /v1/cases/:id/audit and export binds to GET /v1/cases/:id/audit/export; the client never constructs an authoritative audit record or bundle.

EMPTY, ERROR, AND ROLE STATES
- No case selected: explanatory state with Case ID selection and “Open from a case” guidance; do not show fabricated timeline entries.
- No entries after filter: preserve case/filter context and offer Clear filters.
- Permission-redacted: maintain sequence/artifact existence only if policy permits; explain that details are redacted for the current role.
- Cross-tenant/not found: opaque safe message and return link, with no existence disclosure.
- Loading: skeleton matching the three-column structure.
- Panel failure: one column may show a scoped error while safe loaded columns remain.

RESPONSIVE AND ACCESSIBILITY
- Desktop uses three independently labeled regions with logical DOM order: timeline, selected detail, forensic metadata.
- Tablet shows timeline and summary; metadata opens in a focus-trapped drawer.
- Mobile shows case/filter controls, then ordered timeline; selecting an artifact opens a full-screen detail with summary followed by metadata. Preserve focus and URL state.
- Full keyboard timeline navigation, visible focus, semantic ordered list, labeled filters, accessible timestamps/hash copy controls, no color-only categories, and focus restoration from drawers.
- Use one h1, ordered headings, landmarks, polite result announcements, reduced motion, and safe error summaries.
- Name reusable components: AuditCaseSelector, AuditCategoryFilters, AuditSequenceTimeline, AuditArtifactItem, AuditArtifactDetail, ForensicMetadataPanel, RedactedField, HashField, AuditExportDialog, AuditEmptyState.

The design should let a reviewer reconstruct who or what produced each fact or decision, in what immutable order, under which versions and evidence hashes, without exposing sensitive data.
```

## Prompt 08 — Data Health

```text
Act as a principal product designer creating MoneyTrace’s “Data Health” page at /data-health in Claude Design. Produce high-fidelity healthy and degraded state frames, responsive layouts, reusable components, accessibility annotations, and interaction notes only. Do not generate code.

VISUAL AND PRODUCT FOUNDATION
- Use the same public Razorpay Blade-inspired enterprise system: neutral canvas, white/elevated operational cards, restrained borders, modern sans-serif typography, blue actions/focus, compact tables, and explicit status icon plus text.
- Retain MoneyTrace branding and “Synthetic Demo.” Navigation order is exactly Overview, Cases, Approvals, Audit, Data Health; mark Data Health active.
- Do not add chat, Settings, Controls, Reconciliation, Money Paths, secret/configuration editors, or unsupported observability products.
- This page must distinguish availability, capability, freshness, and data quality. A source being optional/absent is not the same as the deterministic demo being not ready.
- Never display credentials, connection strings, API keys, webhook signatures, raw database errors, hostnames, or internal secret references.
- Add a design annotation that manifest money values are formatted with BigInt only, never Number(), parseFloat(), or browser-side aggregation.

CREATE FIVE FRAMES
1. Desktop 1440 × 1100 — healthy synthetic/offline demo.
2. Desktop — optional Razorpay Test and external model absent, deterministic demo still safe.
3. Desktop — worker stale or database down, demo not ready.
4. Tablet 1024 × 1366 — healthy state.
5. Mobile 390 × 844 — source cards and stacked readiness detail.

PAGE HEADER
- One h1: “Data Health.”
- Subtitle: “Source capability, pipeline readiness, and persisted dataset quality.”
- Show generated time, automatic refresh indicator, and manual Refresh.
- Annotate polling every 5 seconds only while the tab is visible; stop on hidden/unmount/error as defined by the application data layer.
- Add a plain-language summary banner at top, for example:
  - Healthy: “Synthetic demo ready. Required local services and synthetic sources are available.”
  - Degraded but safe: “Optional Razorpay Test and external investigation provider unavailable. Deterministic synthetic workflows remain safe.”
  - Not ready: “Worker heartbeat is stale. New jobs may not advance; persisted read-only evidence remains available.”
- Annotate that all health values bind to GET /v1/data-health and are schema-validated before display.

READINESS SUMMARY
- Three primary status cards:
  1. Database — Up or Down.
  2. Worker — Up, Stale, or Down.
  3. Investigation mode — Offline deterministic demo, Optional external, or Rules-only degraded.
- Include projector/readiness context and lag fields where returned.
- Every card states what remains safe. Example: if worker stale, “Existing persisted facts can be reviewed; queued commands may not complete.”
- Do not show synthetic confetti/checkmarks or vague “All systems operational.”

SOURCE CAPABILITY GRID / TABLE
- Show one row/card per source system, including Razorpay Test when represented plus synthetic OMS, Route, bank, ERP, recovery, and agent sources.
- Required columns/fields:
  - Source system.
  - Capability: Available, Synthetic, or Absent.
  - Received.
  - Signed.
  - Unsigned.
  - Exact duplicates.
  - Modified conflicts.
  - Schema failures.
- Clearly label synthetic sources as Synthetic. “Razorpay Test connected” may appear only when capability state says it is configured/available.
- Optional absent Razorpay Test is a warning/information state, not failed demo readiness.
- Unsigned, conflict, and schema-failure counts receive explicit explanatory tooltips; never use only red/amber color.
- Exact duplicates explain that identical replays were safely ignored. Conflicts explain that modified duplicates were quarantined and not used as authoritative truth.
- Per-source conflicts must visually reconcile with the displayed conflict total; do not invent percentages or trends.

PIPELINE AND DATA QUALITY METRICS
- Use grouped, definition-rich metric cards or a structured list for:
  - Events received total.
  - Exact duplicate total.
  - Modified conflict/quarantine total.
  - Schema failure total.
  - Projector lag seconds.
  - Job lag seconds.
  - Pending verification.
  - Unlinked records.
  - Candidate links.
  - Stale projections.
- Distinguish measured zero from “Not measured in this prototype.” Fields that the backend/report identifies as genuinely untracked must not be celebrated as zero incidents; use an honest “Not measured in prototype” treatment with an info tooltip.
- Do not calculate totals in the design/client. Annotate that all values bind directly to GET /v1/data-health.

DATASET MANIFEST PANEL
- Title: “Synthetic dataset.”
- Show seed ID/version if available, generated/evaluated time, fixed demo clock, record count, and short manifest hash with copy affordance.
- Present the key persisted manifest facts in a compact definition list:
  - 500 records total.
  - 468 matched.
  - 16 unresolved material cases.
  - 4 unsafe candidates blocked.
  - ₹12,80,000.00 INR unresolved exposure.
  - Current stage-dependent restored, prevented, and reversed values.
- Label stage-dependent values with the current scenario stage. Do not imply every target amount exists immediately after reset.
- Provide “Open demo status” or operator-only “Open demo controller,” not a hidden reset button inside Data Health.

DEGRADED AND FAILURE STATES
- Optional-source/model absence: warning banner names the missing capability and explains that synthetic/offline evidence remains authoritative for prototype availability.
- Worker stale: show last heartbeat age if safely available, pending work caveat, and no unsafe mutation retry.
- Database down: page shell remains; show safe status envelope only, no raw URL/error; disable data-dependent actions.
- Source unavailable: individual source row/card shows Source unavailable and what conclusions cannot currently advance.
- Conflict spike: show exact count and quarantine explanation, never imply auto-resolution.
- No dataset: dataset panel explains import/reset requirement; only operator gets scenario-controller link.

RESPONSIVE AND ACCESSIBILITY
- Desktop uses readiness summary, source table/grid, pipeline metrics, then dataset manifest.
- Tablet uses two-column cards and a labeled horizontally contained source table or stacked source cards.
- Mobile uses one source card per system with capability and counts in a definition list; never omit unsigned/conflict/schema fields.
- Semantic table/card labels, visible focus, exact timestamps, icon-plus-text status, non-color-only warning levels, live refresh announcements without chatter, and reduced motion.
- Name reusable components: ReadinessSummary, ServiceHealthCard, SourceCapabilityTable, SourceHealthCard, DataQualityMetrics, MeasuredValue, UnmeasuredValue, DatasetManifestPanel, DegradedSafetyBanner, AutoRefreshStatus.

The final page must answer both “Is the demo operational?” and “Which conclusions remain safe if one optional capability is unavailable?” without leaking configuration or misrepresenting synthetic evidence as a live Razorpay connection.
```

## Prompt 09 — Demo Scenario Controller

```text
Act as a principal product designer creating the MoneyTrace “Demo Scenario Controller,” an operator-only global drawer/modal opened from the application header. Produce high-fidelity interaction states, responsive variants, accessibility annotations, and reusable component specifications only. Do not generate React code.

VISUAL AND PRODUCT FOUNDATION
- Use the same public Razorpay Blade-inspired MoneyTrace design: neutral enterprise surfaces, strong hierarchy, restrained borders/shadows, blue primary actions, modern sans-serif typography, and explicit statuses using icon plus text.
- Keep MoneyTrace branding and “Synthetic Demo.” This controller manages real persisted synthetic backend state; it is not an animation sequencer or slideshow.
- Only Demo Operator / Auditor (user_operator) can open mutation controls. Other roles may see current scenario context in the shell but cannot reset/advance.
- Never expose credentials, raw worker/provider/database messages, or a real-money implication.
- Never infer completion from HTTP 200. Use persisted current_step, completed_step, status, state_version, and last_error.
- Add a design annotation that manifest and scenario money values remain API decimal strings formatted with BigInt only, never Number() or parseFloat().

CREATE THESE FRAMES
1. Desktop 1440 × 1024 with a 480–560px right-side controller drawer open.
2. Desktop — one scenario queued/in progress.
3. Desktop — safe failed step with retry available.
4. Desktop — reset confirmation dialog.
5. Tablet 1024 × 1366 — full-height drawer.
6. Mobile 390 × 844 — full-screen controller sheet.

CONTROLLER HEADER
- Title: “Demo scenarios.”
- Subtitle: “Advance deterministic synthetic evidence through real backend workflows.”
- Show fixed demo clock: 25 Aug 2026, 05:20 UTC, with local equivalent.
- Show global readiness: Ready / Not ready, dataset seed, record count when present, and short manifest hash.
- Include Close button with accessible name; closing restores focus to the header trigger.

SCENARIO LIST — EXACTLY FOUR
1. Claim reversal — scenario ID claim-reversal.
   - Story: untrusted ₹1,20,000 recovery claim later offset by correlated authoritative refund; retained value becomes ₹0 and outcome REVERSED.
2. Missing-transfer remediation — scenario ID missing-transfer-remediation.
   - Story: ₹4,55,000 seller transfer missing; evidence-led investigation, policy, approval, one simulated action, bank allocation, ERP closure, VERIFIED.
3. Conflicting bank evidence — scenario ID conflicting-bank-evidence.
   - Story: incompatible/ambiguous bank candidates; system abstains, automatic closure blocked, exposure remains.
4. Duplicate / replay safety — scenario ID duplicate-replay.
   - Story: duplicate delivery and repeated command do not duplicate case, action, allocation, closure, or financial effect.
- Each scenario card shows readable title, concise purpose, current step, completed step, total steps, persisted resource/state version, and status exactly Queued, Completed, or Failed.
- Use progress text such as “Completed 2 of 6 · Step 3 queued,” not a misleading 50% if the queued step has not completed.
- Show last completed time only if returned; do not invent a timer.
- Annotate the real boundaries: GET /v1/demo/status supplies persisted state, POST /v1/demo/reset performs confirmed reset, and POST /v1/demo/scenarios/:id/advance queues the expected next step. Do not derive status from mutation response alone.

SELECTED SCENARIO DETAIL
- Show current completed step, queued/current step, next allowed step, total steps, version, and where the operator will be taken after completion.
- Primary action labels the actual operation: “Advance missing-transfer evidence,” “Inject authoritative refund,” or another backend-defined step label if available. If only generic step data exists, use “Advance to step 4” with the scenario name adjacent.
- Send expected step and current persisted version. Show both in a read-only “Command basis” disclosure.
- Disable advance while a request is in flight or while current_step is ahead of completed_step.
- While queued, poll persisted status and show “Step queued—waiting for worker completion,” not a fake animated pipeline.
- On completion, invalidate all cached views, announce completion, and present “Open relevant case” / navigate to the scenario’s relevant screen.

SAFE FAILURE AND RETRY
- Persisted failure appears only as the fixed safe code DEMO_STEP_FAILED. Display friendly copy: “This demo step did not complete. Persisted state is unchanged; try the same step again.”
- Preserve and show completed_step. Do not mark the failed queued step complete.
- Offer “Try same step again” only because the backend command is stable/idempotent; retain expected step/version and refetch first.
- Never expose raw exception text, stack, provider response, database URL, payload, or secret-bearing detail.
- Stale step/version response closes obsolete confirmation, refetches status, announces “Scenario changed; review the current step,” and requires a new action.

RESET FLOW
- Secondary but clearly separated destructive-looking action: “Reset synthetic demo.” It affects only synthetic persisted data and must not resemble real-account deletion.
- Reset opens a deliberate confirmation dialog showing:
  - Exactly 500 deterministic synthetic records will be rebuilt.
  - All four scenario states return to step 0.
  - No real Razorpay or bank data is involved.
  - Current demo state will be replaced.
- Require the exact backend-approved typed phrase or checkbox confirmation; show the expected seed ID and version where required.
- Final button: “Reset synthetic demo,” not Confirm.
- During reset show the real reset-in-progress state, disable conflicting mutations globally, and do not fake percentage progress.
- After persisted completion, clear cached data, announce completion, show returned resource version/manifest, and navigate to Overview.

MANIFEST SUMMARY
- Compactly show persisted dataset targets/current values: records total, matched, unresolved cases, unsafe matches blocked, exposure, restored, duplicate collection prevented, and reversed recovery.
- Label each as current persisted stage. Do not hard-code or imply all target outcomes exist immediately after reset.

ROLE, RESPONSIVE, AND ACCESSIBILITY
- Non-operator state: controller trigger absent or disabled for clarity, but include a design note that backend 403 remains authoritative.
- Desktop uses a right drawer that traps focus and keeps the current page dimmed but recognizable.
- Tablet uses a wider full-height drawer. Mobile uses a full-screen sheet with sticky footer actions that do not cover content.
- Full keyboard support, Escape close, focus trap/restore, initial focus on drawer heading, dialog error summary, explicit field labels, live-region announcements, and reduced motion.
- Use semantic progress/status text and never color alone. Keep all exact step/version information available to assistive technology.
- Name reusable components: ScenarioController, ScenarioCard, ScenarioProgress, ScenarioStatusBadge, ScenarioCommandBasis, AdvanceScenarioAction, ScenarioFailureNotice, ResetDemoDialog, ManifestSummary.

The controller should feel like a trustworthy operator tool for advancing durable synthetic evidence, with no possibility of confusing a queued request with a completed financial result.
```

## Prompt 10 — Accessible Not-Found and System-State Library

```text
Act as a principal product designer creating the complete MoneyTrace route/panel state library in Claude Design, including the URL catch-all not-found page. Produce high-fidelity reusable patterns, desktop/tablet/mobile variants, accessibility annotations, and action rules only. Do not generate application code.

VISUAL AND PRODUCT FOUNDATION
- Use the same public Razorpay Blade-inspired MoneyTrace system: neutral enterprise canvas, crisp surfaces, restrained illustration/icon use, blue safe-read actions, semantic warnings/errors with text plus icon, visible focus, and modern sans-serif typography.
- Preserve the shared MoneyTrace shell and “Synthetic Demo” environment context wherever the application can load safely.
- Do not use playful error mascots, fabricated metrics, fake AI progress, chat prompts, raw error dumps, or vague “Something went wrong” as the only explanation.
- Never disclose cross-tenant resource existence, credentials, payloads, provider/database details, hidden labels, or chain-of-thought.
- Add a design annotation that any preserved monetary context remains a decimal-string minor-unit value formatted with BigInt only, never Number() or parseFloat().

CREATE A COMPONENT BOARD PLUS ROUTE FRAMES
1. Desktop 1440px component/state board showing all required states.
2. Desktop full-page not-found route.
3. Tablet 1024px not-found and degraded panel examples.
4. Mobile 390px not-found and critical state examples.

LOCKED ACTION CLASSIFICATION
- Safe read failure: button label “Retry.”
- Idempotent command with unchanged stable request, only when backend marks retryable: “Try again.”
- OUTCOME_UNKNOWN: never Retry; show only “Check status.”
- APPROVAL_STALE / VERSION_CONFLICT: close stale modal, refetch, announce change, and require fresh review.
- RECONCILIATION_AMBIGUOUS / VERIFICATION_INCOMPLETE: keep exposure visible, list blockers/missing evidence, and offer evidence/review actions—not automatic resolution.

DESIGN EACH REQUIRED STATE

1. NO DATASET
- Message: “No synthetic dataset is available.”
- Explain that reset/import is required before metrics and cases can be evaluated.
- Viewer action: View Data Health or return to Overview.
- Demo Operator action: Open demo controller.
- Do not show zero-valued KPI cards as if they were measured.

2. NO EXPOSURE
- Positive but restrained: “No unresolved exposure in the current dataset.”
- Explicitly distinguish this from no data and mention that verified/reversed history may still be available.
- Offer View resolved cases or Audit where supported.

3. NO FILTER MATCHES
- Preserve visible filters/chips.
- Message: “No cases match these filters.”
- Action: Clear filters. Do not reset the entire dataset or navigate away unexpectedly.

4. LOADING
- Layout-matched skeletons for KPI cards, tables, case path, artifact rail, audit columns, and health cards.
- Do not animate fake AI steps, fabricate data shapes that imply success, or continuously shimmer under reduced-motion preference.

5. SOURCE DEGRADED
- Name the unavailable source and state exactly which conclusions can and cannot advance.
- Example: “Optional Razorpay Test source unavailable. Synthetic sources remain available; deterministic demo workflows are safe.”
- Action: View Data Health or Retry safe read if appropriate.

6. INVESTIGATION UNAVAILABLE
- Preserve deterministic controls and evidence.
- Message: “Investigation provider unavailable. Rules-only evidence review remains available.”
- Do not present a fabricated finding or fake thinking animation.

7. CONFLICTING EVIDENCE
- Keep exact exposure visible.
- List conflicting/candidate evidence and blocker reason.
- Message: “Conflicting evidence—automatic closure blocked.”
- Actions: Review evidence and Request more evidence if permitted. Never Resolve automatically.

8. OUTCOME UNKNOWN
- Explain that downstream outcome is uncertain and that retrying the action could duplicate an effect.
- Only action: Check status.
- Preserve action reference and last checked time where safely available.

9. STALE VERSION OR APPROVAL
- Message: “This case or approval changed while you were reviewing it.”
- Explain that the old decision cannot be submitted.
- Close stale modal state, refetch, restore focus to the updated heading, and action “Review updated details.”

10. PERMISSION DENIED
- Explain the role needed in general terms, for example “Finance Approver role is required for this decision.”
- Do not confirm whether an opaque/cross-tenant resource exists.
- Provide Return to safe page or Switch demo role where appropriate.

11. NOT FOUND — CATCH-ALL ROUTE
- One h1: “Page not found.”
- Concise text: “This MoneyTrace page does not exist or is not available to the current demo role.”
- Actions: Go to Overview and View Cases.
- Keep shell/navigation if authentication context is safe. Do not echo unsafe path/query content into the DOM.

12. NETWORK OR SERVER ERROR
- Preserve the page shell and last safe cached context.
- Use a safe request ID if returned; no raw error message.
- Action Retry only for reads. Mutations follow backend retry classification.
- Provide View Data Health when degraded infrastructure may be relevant.

13. RESET IN PROGRESS
- Global banner and panel state: “Demo reset in progress. Financial mutations are temporarily unavailable.”
- Preserve read-only context when safe; disable conflicting commands without deleting content.

14. SAFE DEMO STEP FAILURE
- Message maps only from DEMO_STEP_FAILED.
- Preserve completed step and explain that the same idempotent step can be tried again after refetch.
- Never display the stored/raw exception.

COMPONENT BEHAVIOR
- Provide page-level, section-level, inline, banner, table-empty, and drawer/dialog state patterns.
- Each pattern includes: icon with accessible name, specific heading, concise safe explanation, allowed action(s), optional request ID, and focus destination.
- Error summaries link to invalid fields. Toasts are supplemental only and cannot contain the only error explanation.
- Preserve the last safe financial amount and state when a non-authoritative panel fails; mark it with its last updated time.

RESPONSIVE AND ACCESSIBILITY
- Desktop states align with their parent layout rather than floating as generic centered cards everywhere.
- Tablet and mobile preserve full explanatory text and safe actions. No essential information is hidden behind hover.
- Visible focus, logical heading order, status/live regions, focus management after retry/refetch, 44px touch targets where practical, icon-plus-text status, and reduced motion.
- Use plain text for all untrusted content; never dangerously render evidence/model text.
- Name reusable components: RouteNotFound, PanelLoadingState, NoDatasetState, NoExposureState, NoFilterResults, DegradedSourceBanner, InvestigationUnavailableState, ConflictBlockedState, OutcomeUnknownState, StaleResourceState, PermissionDeniedState, SafeServerError, ResetInProgressBanner, DemoStepFailureState.

The state library must preserve financial truth under failure: never turn unavailable data into zero, uncertainty into failure, acknowledgement into verification, or stale state into an actionable approval.
```

## PRD traceability and design acceptance matrix

| Prompt                     | PRD coverage                   | Route/context                    | Primary backend reads/mutations represented                                                                                                        | Required roles/states                                                                           | Responsive deliverables                     |
| -------------------------- | ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 01 — Application Shell     | §§3–7, 15–18, 22               | All routes                       | Demo identity header; demo status; current-page refresh                                                                                            | All four seeded users; degraded and reset-in-progress                                           | 1440 desktop, 1024 tablet, 390 mobile       |
| 02 — Overview              | §8; §§6–7, 15–18, 22           | `/overview`                      | `GET /v1/overview`; related claim/audit links; demo status context                                                                                 | Viewer+; opening reversal, remediation complete, no dataset, no exposure                        | Two desktop scenario frames, tablet, mobile |
| 03 — Case Queue            | §9; §§6–7, 15–18, 22           | `/cases`                         | `GET /v1/cases` with allowlisted filters/sort/cursor                                                                                               | Viewer+; loading, no dataset, no match, read error                                              | Desktop, tablet, mobile cards               |
| 04 — Case Workspace        | §10; §§6–7, 12, 15–18, 22      | `/cases/:caseId`                 | Case, money path, evidence, notes, control-loop, verification reads; assignment, investigation, link review, note, policy/approval/action commands | Viewer read; Investigator/Approver/Operator mutations; all four demo-story states               | Five desktop states, tablet, mobile         |
| 05 — Approval Review       | §11; §§6–7, 15–18, 22          | `/approvals`                     | Approval queue; approve, reject, request-more-evidence; related case/control-loop context                                                          | Viewer read-only; Finance Approver decisions; stale, expired, invalidated, separation-of-duties | Three desktop states, tablet, mobile        |
| 06 — Verification Timeline | §12; §§6, 10.6–10.7, 15–18, 22 | Case workspace embedded/expanded | Case verification view; verification check                                                                                                         | Viewer+; waiting, ACK/unknown, missing bank, ambiguous, verified, reversed                      | Six desktop states, tablet, mobile          |
| 07 — Audit Replay          | §13; §§6–7, 15–18, 22          | `/audit?case=…&artifact=…`       | Case audit list and server-generated redacted export                                                                                               | Viewer/Auditor with redaction; no selection, no results, redacted, safe errors                  | Three desktop states, tablet, mobile        |
| 08 — Data Health           | §14; §§6–7, 15–18, 22          | `/data-health`                   | `GET /v1/data-health`; dataset/demo status context                                                                                                 | Viewer+; healthy synthetic, optional degraded, worker/database not ready                        | Three desktop states, tablet, mobile        |
| 09 — Scenario Controller   | §7.3; §§15–19, 22              | Global operator drawer/modal     | Demo status, reset, scenario advance                                                                                                               | Operator mutation; queued, completed, failed, stale, reset in progress                          | Four desktop states, tablet, mobile         |
| 10 — System States         | §§5.4, 15–18, 22               | Catch-all and reusable panels    | Standard safe envelopes and retry classifications                                                                                                  | All roles; all required empty/degraded/conflict/unknown/stale/error states                      | Component board, desktop, tablet, mobile    |

## Cross-prompt acceptance checklist

Use this checklist after Claude Design produces all frames:

- [ ] Every route is URL-addressable in the eventual UI: `/overview`, `/cases`, `/cases/:caseId`, `/approvals`, `/audit`, `/data-health`, plus an accessible catch-all.
- [ ] Navigation order is exactly Overview, Cases, Approvals, Audit, Data Health.
- [ ] No unfinished or prohibited navigation—Chat, Controls, Reconciliation, Money Paths, Settings—appears.
- [ ] MoneyTrace branding and `Synthetic Demo` are visible; no screen implies live or real-money operation.
- [ ] Public Razorpay Blade conventions are used without copying private assets, exact proprietary screens, or undisclosed token values.
- [ ] Viewer, Investigator / Case Manager, Finance Approver, and Demo Operator / Auditor states are represented.
- [ ] The UI never trusts a free-form role and never treats hidden controls as authorization.
- [ ] Financial amounts use Indian grouping, full INR labels, and screen-reader-accessible values.
- [ ] Lifecycle state and financial outcome remain separate.
- [ ] Source fact, derived control, investigation, policy, approval, simulated action, verification, reconciliation, and audit artifacts are visibly distinct.
- [ ] Agent-reported recovery is clearly untrusted; ₹1,20,000 minus the correlated ₹1,20,000 refund displays ₹0 retained and REVERSED — NOT VERIFIED.
- [ ] Missing-transfer remediation displays ₹4,55,000 verified only after transfer evidence, settlement, independent bank evidence, unique allocation, and observed ERP closure.
- [ ] Conflicting bank evidence remains unresolved, preserves exposure, and visibly blocks automatic closure.
- [ ] Duplicate/replay safety never depicts duplicate cases, actions, allocations, closures, or effects.
- [ ] ACK is never verification; settlement is never bank proof; closure requested is never closure observed.
- [ ] OUTCOME_UNKNOWN provides only Check status, never Retry/resubmit.
- [ ] Stale approvals/versions cannot be overridden and require refetch plus fresh review.
- [ ] Loading states match final geometry and never fake AI thinking or backend progress.
- [ ] No-data, no-exposure, and no-filter-match states are distinct.
- [ ] Optional Razorpay/model absence is a warning when deterministic synthetic/offline behavior remains safe.
- [ ] Every required desktop screen has a 1024px tablet and 390px mobile adaptation with no critical content removed.
- [ ] Every interactive element has visible focus; dialogs/drawers trap and restore focus; status is not color-only.
- [ ] The money path has an equivalent linear alternative and logical screen-reader order.
- [ ] Exact local timestamps retain accessible UTC detail; relative time never replaces exact time.
- [ ] No raw payload, secret, signature, key, connection string, sensitive bank/card detail, hidden label, unsafe HTML, or chain-of-thought appears.
- [ ] The frames are design artifacts only; annotations state that production/demo values must bind to validated backend APIs and cannot be hard-coded.

## Deliberately excluded design scope

- Conversational/chat interface.
- Settings, policy editor, controls editor, or administrative configuration.
- Standalone Reconciliation or Money Paths routes.
- Full graph editing or relationship authoring.
- Bulk financial actions.
- Advanced analytics or decorative chart library.
- Real-money mode, live credentials, or production connection flows.
- Production HA, enterprise authentication administration, deployment, or load-testing interfaces.
