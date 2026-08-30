import type { FastifyRequest } from 'fastify';
import type { ErrorCode } from '../../contracts/errors.js';

/** Shared safe error-envelope builder for Gate B3 routes (never a retryable claim by default). */
export function problem(req: FastifyRequest, code: ErrorCode, message: string, retryable = false) {
  return {
    schema_version: '1.0' as const,
    error: { code, message, request_id: req.id, retryable, details: { kind: 'none' as const } },
  };
}
