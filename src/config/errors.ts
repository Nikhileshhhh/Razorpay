/**
 * Safe error serialization.
 *
 * Arbitrary exception messages from startup, PostgreSQL, pg-boss, adapters, or
 * configuration can embed credentials (a connection string with a password, a
 * bearer token, a Razorpay secret). Pino field redaction cannot scrub a secret
 * hidden inside a free-text `error.message`, so we NEVER log raw messages.
 *
 * Instead we log only an allowlisted error name, an allowlisted short code
 * (e.g. Node `ECONNREFUSED`, Postgres `28P01`), a coarse category, and a fixed
 * generic message. Names and codes are validated against strict allowlists so
 * they cannot themselves carry secret text.
 */

/** Coarse categories used to describe where an error came from. */
export type ErrorCategory = 'startup' | 'config' | 'database' | 'queue' | 'adapter' | 'internal';

export interface SafeError {
  name: string;
  category: ErrorCategory;
  message: string;
  code?: string;
}

/**
 * Error class names we are willing to surface verbatim. Anything else becomes
 * the generic `Error`, so an attacker-influenced custom name cannot leak text.
 */
const SAFE_ERROR_NAMES = new Set<string>([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'EvalError',
  'ReferenceError',
  'URIError',
  'AggregateError',
  'ZodError',
  'FastifyError',
  'LiveKeyInDemoError',
]);

/**
 * Codes we accept: short, uppercase-alphanumeric identifiers only. This matches
 * Node errno codes (`ECONNREFUSED`, `ENOTFOUND`) and Postgres SQLSTATE codes
 * (`28P01`, `23505`). Such codes never contain secret payloads.
 */
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

function pickSafeName(error: unknown): string {
  if (
    error instanceof Error &&
    typeof error.name === 'string' &&
    SAFE_ERROR_NAMES.has(error.name)
  ) {
    return error.name;
  }
  return 'Error';
}

function pickSafeCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const raw = (error as { code?: unknown }).code;
    if (typeof raw === 'string' && SAFE_CODE_PATTERN.test(raw)) {
      return raw;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }
  return undefined;
}

/**
 * Convert any thrown value into a log-safe descriptor. The `message` is a fixed
 * template built only from the allowlisted name/code and category — never from
 * the original error message.
 */
/**
 * Postgres unique-violation (SQLSTATE 23505) on a specific named constraint.
 * drizzle-orm's `DrizzleQueryError` wraps the real `pg` error on `.cause`
 * WITHOUT copying `code`/`constraint` onto itself (see
 * `node_modules/drizzle-orm/src/errors.ts`), so both the error itself and one
 * level of `.cause` must be checked — checking only the outer error silently
 * never matches for any query run through a drizzle `db`/`tx` handle.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  return candidates.some(
    (candidate) =>
      Boolean(candidate) &&
      typeof candidate === 'object' &&
      (candidate as { code?: unknown }).code === '23505' &&
      (candidate as { constraint?: unknown }).constraint === constraintName,
  );
}

export function toSafeError(error: unknown, category: ErrorCategory = 'internal'): SafeError {
  const name = pickSafeName(error);
  const code = pickSafeCode(error);
  const suffix = code ? `${name}/${code}` : name;
  const safe: SafeError = {
    name,
    category,
    message: `A ${category} error occurred (${suffix}). See operator runbook; raw details are intentionally not logged.`,
  };
  if (code !== undefined) {
    safe.code = code;
  }
  return safe;
}
