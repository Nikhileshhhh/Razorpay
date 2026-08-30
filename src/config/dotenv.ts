import { config, type DotenvConfigOptions, type DotenvConfigOutput } from 'dotenv';

/**
 * `.env` loading. Server-only.
 *
 * This is invoked ONLY at executable API/worker entry points — never from
 * browser-safe contracts or the pure domain, so secrets from `.env` can never
 * reach the web bundle. The Vitest bootstrap loads `.env` server-side only so
 * database integration tests can use a disposable local PostgreSQL instance.
 *
 * By default it reads `${cwd}/.env` and populates `process.env`. A `path` and an
 * isolated `processEnv` target may be supplied (used by tests to avoid mutating
 * the real environment or leaking secret values into test output).
 */
export function loadDotenv(
  options: { path?: string; processEnv?: Record<string, string> } = {},
): DotenvConfigOutput {
  const opts: DotenvConfigOptions = {};
  if (options.path !== undefined) {
    opts.path = options.path;
  }
  if (options.processEnv !== undefined) {
    opts.processEnv = options.processEnv;
  }
  return config(opts);
}
