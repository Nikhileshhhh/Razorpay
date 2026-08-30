import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Structured JSON logger (Pino) with secret redaction.
 *
 * Secrets, raw payloads, and card/bank data must never appear in logs
 * (architecture handoff §18, §21.5, final rule #16). The redaction paths below
 * mask common secret-bearing fields wherever they appear in a log object.
 */
export const REDACT_PATHS = [
  // Generic secret-bearing field names (top level and one level nested).
  'secret',
  '*.secret',
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'apiKey',
  '*.apiKey',
  // Authorization headers, including nested request/response header shapes.
  'authorization',
  '*.authorization',
  'headers.authorization',
  '*.headers.authorization',
  'req.headers.authorization',
  '*.req.headers.authorization',
  'request.headers.authorization',
  '*.request.headers.authorization',
  // Database connection string / URL.
  'DATABASE_URL',
  '*.DATABASE_URL',
  'databaseUrl',
  '*.databaseUrl',
  'connectionString',
  '*.connectionString',
  // Razorpay key identifiers and secrets.
  'RAZORPAY_KEY_ID',
  '*.RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  '*.RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  '*.RAZORPAY_WEBHOOK_SECRET',
  'razorpayKeyId',
  '*.razorpayKeyId',
  'razorpayKeySecret',
  '*.razorpayKeySecret',
  'webhookSecret',
  '*.webhookSecret',
  // Synthetic-source HMAC secret.
  'SYNTHETIC_SOURCE_HMAC_SECRET',
  '*.SYNTHETIC_SOURCE_HMAC_SECRET',
  'hmacSecret',
  '*.hmacSecret',
  // Raw request/payload bodies (may embed anything, incl. card/bank data).
  'rawBody',
  '*.rawBody',
  'raw_body',
  '*.raw_body',
  'rawPayload',
  '*.rawPayload',
  'raw_payload',
  '*.raw_payload',
];

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export function createLogger(options: { level?: LogLevel; name?: string } = {}): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };
  if (options.name !== undefined) {
    config.name = options.name;
  }
  return pino(config);
}
