# Frontend implementation notes

## Checkpoint 1 — Application shell

- The exported Claude Design project archive under `designs/` is now the visual source of truth for
  this checkpoint. The product frame follows its IBM Plex typography, custom trace mark, 248px
  desktop navigation, 72px tablet rail, 64px/56px/40px header rhythms, flat border-led surfaces,
  mobile navigation drawer, and separate mobile dataset-controls sheet. IBM Plex Sans and Mono are
  bundled locally so the prototype remains offline-capable.
- The public `@razorpay/blade` package was evaluated first. npm could not resolve its React 18
  dependency graph because the current React Native peer requires React 19. The supported
  `--omit=peer` install path failed with the same conflict, so the checkpoint uses accessible local
  primitives and Blade-inspired semantic tokens as allowed by the implementation plan. No forced
  or legacy peer resolution was used.
- React Router owns the exact five application routes; TanStack Query owns server state; Radix owns
  modal focus management; Lucide provides icons. All local status and environment text remains
  explicit and is never conveyed by color alone.
- `/v1` and `/ready` are relative browser requests proxied by Vite to the existing Fastify API at
  `127.0.0.1:3000`.
- The shell reads only `GET /v1/demo/status` and `GET /v1/data-health`. No financial KPI or command
  is introduced at this checkpoint.
- The API client validates success and safe error envelopes with the shared browser-safe Zod
  contracts, injects the selected demo identity and a client request ID, and preserves cancellation.
- Browser money formatting accepts only decimal-string INR minor units and uses `BigInt` throughout.

## Verification retained for the checkpoint

- Fresh migrations `0001` through `0007`, targeted backend contract/auth/money/control-loop checks,
  and the real PostgreSQL/Fastify/worker four-scenario lifecycle passed before UI work continued.
- Component coverage includes all four fixed role identities, safe API parsing, environment/data
  banners, the read-only scenario sheet, keyboard behavior, focus restoration, automated
  accessibility, and BigInt money edge cases.
- Chromium coverage runs at 1440×1024, 1024×1366, and 390×844. The mobile drawer is exercised with
  Escape and deterministic focus restoration; the dataset-controls sheet receives the same check.

## Exported design coverage

- The archive contains App Shell, Overview, Case Queue, and Case Workspace design documents.
- Approval Review, Audit Replay, Data Health, Demo Scenario Controller, and the final reusable state
  catalogue are not present in the archive. Those checkpoints still require design references or
  explicit approval to extend the established MoneyTrace visual system.

## Checkpoint 2 — Revenue Integrity Overview

- `/overview` now follows the exported `MoneyTrace Overview.dc.html` hierarchy while retaining the
  approved application shell. It includes dataset/scenario context, claim-versus-retained-value
  comparison, six API-derived KPI cards, lifecycle exposure, resolution distribution,
  opened/closed trend, and the three highest-exposure unresolved cases.
- The browser consumes validated `GET /v1/overview`, `GET /v1/demo/status`, and exposure-descending
  `GET /v1/cases` responses. Claim truth, lifecycle exposure, and case facts are server-authoritative;
  no financial value from the reference design is hard-coded into the page.
- Money and monetary proportions use decimal-string minor units and `BigInt`. The page distinguishes
  missing datasets, zero exposure, unavailable claim comparison, malformed responses, network
  failures, and a scoped prioritized-case failure.
- Tables have mobile card alternatives, chart-like modules have text or table equivalents, and all
  status meaning remains explicit. The page preserves one `h1`, keyboard-operable disclosures,
  visible focus, UTC timestamp details, and reduced-motion behavior.

## Checkpoint 2 verification

- TypeScript typecheck, ESLint, Prettier, the production Vite build, 149 contract tests, and all 23
  frontend unit/component/accessibility tests pass.
- Database-backed integration and real-browser scenario checks require the local PostgreSQL password
  in `DATABASE_URL` and a restart of the API currently listening on port 3000. The existing process
  serves the pre-Checkpoint-2 Overview contract, which the new client correctly rejects rather than
  presenting incomplete financial data.
