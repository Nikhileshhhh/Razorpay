# ADR 0001 — Architecture and dependency choices (MT-001)

- **Status:** Accepted
- **Date:** 2026-08-25
- **Task:** MT-001 — Scaffold the single-package TypeScript repository
- **Deciders:** MoneyTrace Buildathon team
- **Controlling documents:** `MoneyTrace PRD.md` (§15, §26, §29), `docs/MONEYTRACE_ARCHITECTURE_HANDOFF.md` (§4, §6, §16, §21), `docs/CLAUDE_CODE_TASKS.md` (MT-001), `docs/CODEX_REVIEW_CHECKLIST.md`

## Context

MoneyTrace is a financial revenue-integrity control plane built for a Buildathon.
The architecture handoff mandates a **TypeScript modular monolith** backed by
PostgreSQL, deployed as two processes (API and worker) from one codebase, plus a
React web app. MT-001 establishes only the build/lint/test/entry-point/boundary
foundations — **no business behaviour, no database tables/migrations, no
financial logic, no external infrastructure**.

## Decision

### Repository shape

- **One TypeScript package** (npm), not a monorepo/workspace. The handoff (§16)
  explicitly says to avoid workspace machinery until a real need exists. One
  package gives shared contracts across UI/API/worker with the least ceremony.
- **npm** as the package manager (no existing lockfile/constraint requiring
  otherwise); **Node ≥ 20.19** (required by Vite 7; verified on Node 22).
- **`"type": "module"` + strict TypeScript.** `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`,
  `verbatimModuleSyntax`, `isolatedModules` are all on.
- **Explicit entry points:** `src/api/server.ts` (Fastify), `src/worker/worker.ts`
  (pg-boss), `src/web/main.tsx` (React/Vite). None open a database connection at
  import time, so build/typecheck/unit tests run without PostgreSQL.

### Dependency rationale

| Dependency                                                                     | Role                   | Why chosen                                                                                                 | Rejected alternative                                            |
| ------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **fastify** (+ `@fastify/swagger`)                                             | HTTP API               | Raw-body hooks (needed later for webhook HMAC over exact bytes), typed handlers, low ceremony              | NestJS: more boilerplate/conventions than the wedge needs       |
| **react** + **vite** + `@vitejs/plugin-react`                                  | Web SPA                | Public `@razorpay/blade` is React-compatible and accessible; Vite is a fast browser-only bundler           | Next.js: full-stack conventions unnecessary for an internal SPA |
| **zod** + **@asteasolutions/zod-to-openapi**                                   | Contracts / OpenAPI    | Single source of truth for validation + generated OpenAPI; money stays as decimal strings, not JS `number` | Hand-written JSON Schema: duplicative, drifts from TS types     |
| **drizzle-orm** + **drizzle-kit**                                              | Persistence (later)    | Typed schema without hiding SQL constraints (unique keys, row locks, checks the financial model needs)     | Prisma: productive but less direct for specialised constraints  |
| **pg**                                                                         | PostgreSQL driver      | Standard node-postgres driver Drizzle and pg-boss build on                                                 | —                                                               |
| **pg-boss**                                                                    | Durable jobs (later)   | Durable queue inside PostgreSQL — no Redis, transactional operational model                                | In-process jobs (not crash-safe); Redis/Kafka (extra infra)     |
| **pino** (+ `pino-pretty` dev)                                                 | Structured logging     | Fast JSON logs with field **redaction** so secrets/raw payloads never leak                                 | `console`/winston: weaker redaction ergonomics                  |
| **vitest**                                                                     | Unit/integration tests | Vite-native, fast, ESM-first; shares config with the web build                                             | Jest: heavier ESM/TS setup                                      |
| **@playwright/test**                                                           | Browser (e2e) tests    | Real-browser accessibility/keyboard/rendering checks required by the PRD UX bar                            | Cypress: heavier, less multi-browser                            |
| **eslint** + **typescript-eslint** + **prettier** (+ `eslint-config-prettier`) | Lint/format            | Strict TS-aware linting; Prettier owns formatting; ESLint carries a fast import-boundary guard             | tslint (deprecated)                                             |
| **dotenv**                                                                     | Local env loading      | Load `.env` for local dev only; validated by Zod                                                           | —                                                               |

### Import boundaries

Enforced two ways:

1. **Authoritative:** `tests/unit/architecture-boundaries.test.ts` (with negative
   fixture tests) scans real source and fails on any violation:
   - `domain` and `contracts` are pure, browser-safe layers: no API/worker/web/
     config/DB/modules/integrations code, no infrastructure/framework packages,
     and no Node built-ins;
   - `web` must not import server-only modules, configuration, infrastructure, or
     Node built-ins (the browser bundle must not contain server code or secrets);
   - `integrations` must not depend on module internals or app entry points;
   - **no file under `src/` may import — or use a literal dynamic `import()` for —
     anything resolving into `fixtures/hidden-ground-truth/`.**
2. **Fast secondary guard:** ESLint `no-restricted-imports` groups in
   `eslint.config.js`, plus a `no-restricted-syntax` rule banning non-literal
   dynamic imports in the model/evaluation runtime (`src/modules/investigation`).

**Scope and limits of the hidden-ground-truth guard (stated accurately):**

- The analyzer resolves only statically analyzable specifiers — `import`/`export
… from`, `require(...)`, and **literal** `import('…')`. It **cannot** prove that
  an arbitrary **computed** dynamic path will never resolve into hidden ground
  truth; the ESLint `no-restricted-syntax` rule closes that gap for the model
  runtime by forbidding non-literal dynamic imports there.
- **Directory placement alone is not a security boundary.** Node/TypeScript can
  import across the repository by relative path, so being outside `src/` does not
  by itself isolate `fixtures/hidden-ground-truth/`; the prohibition is enforced
  by the boundary test + ESLint, not by location.
- `fixtures/hidden-ground-truth/` **must remain empty in MT-001.** A stronger
  build/runtime exclusion of hidden labels (build-time exclusion and/or a broader
  ban on non-literal dynamic imports in the evaluation runtime) is a **deferred
  MT-010/MT-012 P0 requirement** that must land **before** any labels become
  model-visible evaluation data.

### Environment safety

- All environment access is validated by Zod (`src/config/env.ts`).
- **Financial-safety guard:** `assertNoLiveKeyInDemo()` rejects any Razorpay key
  beginning with `rzp_live_` when `MONEYTRACE_ENV` is `demo` or `buildathon`
  (PRD/handoff: the prototype must never move real money). The guard is pure and
  unit-tested, and its error message **never contains the secret value**.
- Pino redaction masks secret-bearing fields; secrets are never logged.

### Build command scope

`npm run build` = `build:server` (`tsc -p tsconfig.build.json`, emitting runnable
Node ESM for API + worker + shared code to `dist/`) **plus** `build:web`
(`vite build`, emitting the browser bundle to `dist-web/`). The server build uses
`module`/`moduleResolution: NodeNext` — relative imports already carry `.js`
extensions, so the emitted ESM runs directly under `node`. Start commands
`start:api` (`node dist/api/server.js`) and `start:worker`
(`node dist/worker/worker.js`) run the built artifacts; `dev:api`/`dev:worker`
keep the `tsx` watch loop. `smoke:api` boots the built API and asserts `/health`;
`smoke:worker` asserts importing the built worker opens no DB connection.

## What is explicitly NOT included (per MT-001 constraints)

- No Docker, Redis, Kafka, Kubernetes, Temporal, Elasticsearch, or graph DB.
- No database tables or migrations (Drizzle schema is an empty placeholder).
- No Razorpay API calls, webhooks, AI, policy, actions, or UI feature screens.
- No monorepo/workspace tooling; no BFF/service split.

## Consequences

- **Positive:** fast local loop; shared contracts; strong safety defaults
  (strict TS, validated env, live-key guard, log redaction, enforced boundaries)
  from commit one; the deterministic vertical slice can be built on top without
  reworking foundations.
- **Trade-offs:** one package will eventually need decomposition at measured
  scaling/security boundaries (handoff §5); mixing browser + Node in one
  `tsconfig` for typecheck is convenient but relies on the boundary test (not the
  compiler) to keep server code out of the web bundle.
- **Follow-ups:** MT-002 fills `src/contracts`; MT-003 the `src/domain` kernel;
  MT-004 the PostgreSQL schema/migrations.

## Codex review remediation (MT-001, 2026-08-25)

The following corrections were applied after the first Codex review. They stay
within MT-001 scope (no business logic, no tables/migrations, no integrations).

1. **Build emits runnable artifacts** — see "Build command scope" above.
   `tsconfig.build.json` added; `dist/api/server.js` + `dist/worker/worker.js`
   emitted; `start:api`/`start:worker` + `smoke:api`/`smoke:worker` added.
2. **`.env` is now loaded** at executable entry points only, via
   `src/config/dotenv.ts` (`loadDotenv()`), called inside `start()` (API) and the
   direct-run guard (worker). It is never imported by contracts or domain, so
   `.env` secrets cannot reach the web bundle. Tests still inject env explicitly;
   `scripts/smoke-built-api.mjs` proves an entry point reads a temporary `.env`.
3. **Env ignore rules** broadened to `.env*` with `!.env.example`; verified by
   `tests/unit/gitignore-env.test.ts`.
4. **Safe error logging** — `src/config/errors.ts` `toSafeError()` returns only an
   allowlisted error name/code/category + a fixed generic message. API and worker
   log `toSafeError(...)`, never raw `error.message`. Pino `redact` coverage
   expanded to `DATABASE_URL`/`connectionString`, nested `*.headers.authorization`,
   `rawBody`/`raw_payload` variants, Razorpay key ids/secrets, and the synthetic
   HMAC secret. Covered by `tests/unit/errors.test.ts` (fake pg URL, password,
   bearer token, Razorpay secret — none appear in output).
5. **Dependency security** — `vite` → 7.x, `vitest` → 3.x, `@vitejs/plugin-react`
   → 5.x. `npm audit --omit=dev` is **0**; full audit has **0 high/critical**.
   Node engine floor raised to `>=20.19` (Vite 7 requirement).
6. **Playwright lifecycle** — the E2E suite runs the Vite dev server **in-process**
   via a worker-scoped, automatic fixture (`tests/e2e/fixtures.ts`) that always
   `await server.close()`s in a `finally` block. `playwright.config.ts` has **no**
   `webServer`, so there is no external process for Playwright to terminate. See
   the second-review note below for the root cause this replaced.
7. **Contracts + hidden-truth boundaries** — the authoritative analyzer
   (`tests/support/boundaries.ts`) treats `src/contracts` as a pure browser-safe
   layer (no API/worker/config/modules/integrations/db, no Node built-ins, no
   infra packages) and forbids any `src` file from importing or using a literal
   dynamic import of `fixtures/hidden-ground-truth/**`. ESLint mirrors this. See
   the "Import boundaries" decision above for the accurate scope and limits.
   Negative fixture tests
   (`tests/unit/architecture-boundaries-negative.test.ts`) prove detection.
8. **Script consistency** — `test:unit` runs unit tests only, `test:integration`
   added, `npm test` runs both. Build/test artifacts (`dist/`, `dist-web/`,
   `coverage/`, `playwright-report/`, `test-results/`) remain git-ignored.

### Second Codex review remediation (MT-001, 2026-08-25)

- **E2E hang root cause & fix.** The `webServer` approach (even invoking the Vite
  binary directly) still hung on Windows: Playwright could not terminate the
  spawned Vite Node child, so the run never printed its summary or returned.
  Replaced with the in-process worker-scoped fixture above — no external process,
  so `npm run test:e2e` (and with `CI=1`) prints its summary, exits 0, and leaves
  nothing on port 5173. The server is closed on every path (success, assertion
  failure, setup failure after creation, retries, CI) by the `finally` block.
- **Secret-safe smoke failure output.** `scripts/smoke-built-api.mjs` no longer
  prints captured child stdout/stderr. Failures emit only safe metadata (reason
  code, exit code, signal, non-empty flags, elapsed) via
  `scripts/lib/safe-diagnostics.mjs`, unit-tested by
  `tests/unit/smoke-safe-diagnostics.test.mjs` (captured output containing a DB
  URL, bearer token, Razorpay-shaped credential, and HMAC marker never appears in
  the report). Temp files and the child are cleaned via a `process.on('exit')`
  handler.
- **Credential-shaped test fixtures replaced** with unmistakable markers
  (`rzp_test_FAKE_TEST_ONLY`, `TEST_ONLY_PASSWORD_MARKER`,
  `Bearer TEST_ONLY_TOKEN_MARKER`, etc.) in `tests/unit/errors.test.ts` and
  `tests/unit/env.test.ts`, preserving each test's purpose. No real credential is
  used or stored anywhere; no populated `.env` is created.
- **Boundary-guarantee precision** — see the "Import boundaries" decision above:
  only static and literal-dynamic imports are checked; directory location is not a
  boundary; the non-literal-dynamic-import ban covers the model runtime; a
  stronger exclusion is a deferred MT-010/MT-012 P0 item, and hidden ground truth
  stays empty until then.

### Known dev-only advisory (no compatible fix)

`npm audit` reports **4 moderate** advisories, all dev-only and from one chain:

- **Packages:** `drizzle-kit@0.31.10` (latest) → `@esbuild-kit/esm-loader` →
  `@esbuild-kit/core-utils` → `esbuild <=0.24.2`.
- **Advisory:** GHSA-67mh-4wv8-2f99 — esbuild's dev server allows any website to
  send requests to it and read the response.
- **Exposure condition:** only when running an `esbuild`/`@esbuild-kit` **dev
  server** reachable by a malicious web page. MoneyTrace uses `drizzle-kit` solely
  for offline `db:generate` (not even exercised in MT-001 — no migrations yet),
  which starts no such server; it is a build/dev-time tool, never shipped to
  production and never in the runtime dependency tree (`npm audit --omit=dev` = 0).
- **Mitigation:** no compatible fix exists (the current drizzle-kit still pins the
  deprecated `@esbuild-kit` loader). We do not run drizzle-kit against untrusted
  input, and will drop the advisory when drizzle-kit migrates off `@esbuild-kit`.
  These are **dev-only** advisories, not runtime vulnerabilities.
