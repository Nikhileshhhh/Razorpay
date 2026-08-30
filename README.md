# Razorpay MoneyTrace

Financial revenue-integrity control plane (Buildathon prototype). A TypeScript
modular monolith: Fastify API + pg-boss worker + React/Vite web, backed by
PostgreSQL (used by later tasks).

> **Status:** MT-001 scaffold and MT-002 versioned contracts are complete. No
> domain behaviour, database tables/migrations, feature routes, connectors, or
> feature UI exists yet. For the five-day working prototype, implement
> `docs/MONEYTRACE_BACKEND_PRD.md` completely before
> `docs/MONEYTRACE_FRONTEND_PRD.md`; the architecture handoff and permanent
> review checklist remain the financial-safety authority.

## Setup (one command)

```bash
npm run setup
```

This installs dependencies and the Chromium browser used by the Playwright
browser tests. (Plain `npm install` is enough for everything except `test:e2e`.)

## Commands

| Command                    | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `npm run setup`            | Install dependencies + Chromium for browser tests                     |
| `npm run build`            | Emit runnable API + worker (`dist/`) and the web bundle (`dist-web/`) |
| `npm run build:server`     | Emit runnable Node ESM for API/worker to `dist/` (`tsc`)              |
| `npm run build:web`        | Build the browser bundle to `dist-web/` (`vite build`)                |
| `npm run typecheck`        | Strict TypeScript type-check of the whole repo (`tsc --noEmit`)       |
| `npm run lint`             | ESLint (includes a fast import-boundary guard)                        |
| `npm run format`           | Prettier check                                                        |
| `npm run test`             | Unit + integration tests (Vitest)                                     |
| `npm run test:unit`        | Unit tests only                                                       |
| `npm run test:integration` | Integration tests only                                                |
| `npm run test:e2e`         | Browser tests (Vite runs in-process via a Playwright fixture)         |
| `npm run smoke:api`        | Boot the built API and assert `/health` (needs `build` first)         |
| `npm run smoke:worker`     | Assert importing the built worker opens no DB (needs `build` first)   |
| `npm run start:api`        | Run the built API (`node dist/api/server.js`)                         |
| `npm run start:worker`     | Run the built worker (`node dist/worker/worker.js`)                   |
| `npm run dev:api`          | Run the Fastify API (tsx watch)                                       |
| `npm run dev:worker`       | Run the pg-boss worker (tsx watch)                                    |
| `npm run dev:web`          | Run the Vite web app                                                  |

## Configuration

Copy `.env.example` to `.env` and fill in **local / test-mode** values only.
`.env` is loaded **only** by the executable API and worker entry points (via
`src/config/dotenv.ts`) — never by browser or contract code — and is validated by
`src/config/env.ts`. All `.env*` files except `.env.example` are git-ignored.

In `demo` / `buildathon` environments, Razorpay **live** keys (`rzp_live_…`) are
rejected at startup — the prototype must never move real money. Errors are logged
through a safe serializer (`src/config/errors.ts`) plus Pino redaction, so secrets
never reach logs.

## Layout

```
src/
  contracts/     versioned Zod/OpenAPI schemas (browser-safe, pure)
  domain/        pure financial kernel (no I/O, no framework)
  modules/       domain modules (identity, ingestion, cases, …)
  integrations/  razorpay + synthetic connectors
  api/           Fastify entry point + routes/middleware
  worker/        pg-boss worker entry point + jobs
  web/           React/Vite browser app
  config/        env, dotenv, logger, errors, db (server-only)
db/              migrations + seeds (empty until MT-004)
fixtures/        public-shaped, synthetic, hidden-ground-truth
tests/           unit, integration, e2e, adversarial, support
docs/adr/        architecture decision records
docs/MONEYTRACE_BACKEND_PRD.md   backend-first prototype implementation contract
docs/MONEYTRACE_FRONTEND_PRD.md  frontend contract after backend acceptance
scripts/         built-artifact smoke checks
```

Import boundaries — `domain` and `contracts` are pure (no server/infra/Node
built-ins), `web` ⊄ server/config, `integrations` ⊄ module internals, and **no**
`src` file may import `fixtures/hidden-ground-truth` — are enforced by
`tests/unit/architecture-boundaries.test.ts` (with negative fixture tests) and
ESLint.
