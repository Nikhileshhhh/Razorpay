// Secret-safe diagnostics for child-process smoke checks.
//
// A smoke check may capture child stdout/stderr that CONTAINS the very secret it
// is trying to detect. Printing that captured output on failure would re-emit the
// secret. This helper builds a failure report from SAFE METADATA ONLY — it never
// includes raw captured output, response bodies, or `.env` values. It receives
// stdout/stderr only to derive booleans about whether they were non-empty.

/** Reason codes are constrained to an unmistakable, non-secret shape. */
const REASON_CODE = /^[A-Z0-9_]{1,48}$/;
/** POSIX/Node signal names, e.g. SIGTERM, SIGKILL. */
const SIGNAL = /^SIG[A-Z0-9]{1,12}$/;

export function sanitizeReasonCode(reasonCode) {
  return typeof reasonCode === 'string' && REASON_CODE.test(reasonCode) ? reasonCode : 'UNKNOWN';
}

function sanitizeSignal(signal) {
  return typeof signal === 'string' && SIGNAL.test(signal) ? signal : 'null';
}

function sanitizeExitCode(exitCode) {
  return typeof exitCode === 'number' && Number.isInteger(exitCode) ? String(exitCode) : 'null';
}

function sanitizeElapsed(elapsedMs) {
  return typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)
    ? String(Math.round(elapsedMs))
    : 'null';
}

/**
 * Build a single-line, secret-safe failure report. Only these fields are
 * emitted: reason code, exit code, signal, whether stdout/stderr was non-empty,
 * and elapsed time. `stdout`/`stderr` are used ONLY to compute booleans; their
 * content is never included.
 */
export function buildSafeFailureReport({
  reasonCode,
  exitCode = null,
  signal = null,
  stdout = '',
  stderr = '',
  elapsedMs = null,
} = {}) {
  const stdoutNonEmpty = typeof stdout === 'string' ? stdout.length > 0 : Boolean(stdout);
  const stderrNonEmpty = typeof stderr === 'string' ? stderr.length > 0 : Boolean(stderr);
  return [
    `reason=${sanitizeReasonCode(reasonCode)}`,
    `exitCode=${sanitizeExitCode(exitCode)}`,
    `signal=${sanitizeSignal(signal)}`,
    `stdoutNonEmpty=${stdoutNonEmpty}`,
    `stderrNonEmpty=${stderrNonEmpty}`,
    `elapsedMs=${sanitizeElapsed(elapsedMs)}`,
  ].join(' ');
}
