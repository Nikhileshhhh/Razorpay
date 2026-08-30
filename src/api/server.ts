import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv, type Env } from '../config/env.js';
import { createLogger, REDACT_PATHS } from '../config/logger.js';
import { toSafeError } from '../config/errors.js';
import { loadDotenv } from '../config/dotenv.js';
import { getDb } from '../config/db.js';
import { HealthResponse } from '../contracts/health.js';
import { registerCaseRoutes } from './routes/cases.js';
import { registerEvidenceRoutes } from './routes/evidence.js';
import { registerCaseDetailRoutes } from './routes/case-details.js';
import { registerInvestigationRoutes } from './routes/investigations.js';
import { registerPolicyRoutes } from './routes/policy.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerActionRoutes } from './routes/actions.js';

/**
 * Fastify API entry point.
 *
 * `/health` never touches the database (liveness only, MT-001 guarantee
 * preserved). Database-backed routes are registered only when
 * `DATABASE_URL` is configured — `getDb()` itself never opens a connection
 * eagerly (the pg `Pool` connects lazily on first query), so this is purely
 * about not advertising routes that would always fail with no DB configured
 * at all (e.g. the built-artifact smoke check, which only exercises `/health`).
 */
export function buildServer(env: Env = loadEnv()): FastifyInstance {
  // Use Fastify's own pino with our shared redaction paths so secrets are never
  // logged. (Passing a pre-built pino instance changes Fastify's logger generic
  // and fights the FastifyInstance return type, so we pass options instead.)
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      name: 'moneytrace-api',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
  });

  app.get('/health', async () => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'moneytrace',
      environment: env.MONEYTRACE_ENV,
      time: new Date().toISOString(),
    };
    return HealthResponse.parse(body);
  });

  if (env.DATABASE_URL) {
    const db = getDb(env.DATABASE_URL);
    registerEvidenceRoutes(app, db, env);
    registerCaseRoutes(app, db);
    registerCaseDetailRoutes(app, db);
    registerInvestigationRoutes(app, db);
    registerPolicyRoutes(app, db);
    registerApprovalRoutes(app, db);
    registerActionRoutes(app, db);
  }

  return app;
}

async function start(): Promise<void> {
  // Load `.env` at the executable entry point only.
  loadDotenv();
  const env = loadEnv();
  const app = buildServer(env);
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

// Only start the server when executed directly, not when imported (e.g. by tests).
const entry = argv[1];
const isDirectRun = typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
if (isDirectRun) {
  start().catch((error: unknown) => {
    // Never log the raw error message; it may embed secrets. Use a safe descriptor.
    createLogger({ name: 'moneytrace-api' }).fatal({
      msg: 'API failed to start',
      err: toSafeError(error, 'startup'),
    });
    process.exitCode = 1;
  });
}
