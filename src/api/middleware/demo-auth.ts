import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../config/db.js';
import {
  resolveIdentity,
  type ResolvedIdentity,
} from '../../modules/identity/identity-repository.js';
import { assertHasAnyRole, RoleForbiddenError, type Role } from '../../modules/identity/roles.js';

/**
 * Demo-only authentication (backend PRD §6.1): the client sends
 * `x-demo-user-id`; the server resolves tenant/roles from seeded DB records.
 * The client can NEVER submit a tenant id, role, or any other identity claim —
 * only an opaque user id that is looked up server-side. Unknown/missing
 * identity -> `401`; valid identity without the required role -> `403`.
 */
declare module 'fastify' {
  interface FastifyRequest {
    identity?: ResolvedIdentity;
  }
}

export function readDemoUserId(req: FastifyRequest): string | undefined {
  const header = req.headers['x-demo-user-id'];
  return Array.isArray(header) ? header[0] : header;
}

export async function requireDemoIdentity(
  db: Database,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const userId = readDemoUserId(req);
  if (!userId) {
    await reply.code(401).send(unauthorized(req));
    return false;
  }
  const identity = await resolveIdentity(db, userId);
  if (!identity) {
    await reply.code(401).send(unauthorized(req));
    return false;
  }
  req.identity = identity;
  return true;
}

export async function requireAnyRole(
  req: FastifyRequest,
  reply: FastifyReply,
  requiredAnyOf: readonly Role[],
): Promise<boolean> {
  if (!req.identity) {
    await reply.code(401).send(unauthorized(req));
    return false;
  }
  try {
    assertHasAnyRole(req.identity.roles, requiredAnyOf);
    return true;
  } catch (error) {
    if (error instanceof RoleForbiddenError) {
      await reply.code(403).send(forbidden(req));
      return false;
    }
    throw error;
  }
}

function unauthorized(req: FastifyRequest) {
  return {
    schema_version: '1.0',
    error: {
      code: 'TENANT_SCOPE_REQUIRED',
      message: 'a valid x-demo-user-id header is required',
      request_id: req.id,
      retryable: false,
      details: { kind: 'none' },
    },
  };
}

function forbidden(req: FastifyRequest) {
  return {
    schema_version: '1.0',
    error: {
      code: 'POLICY_DENIED',
      message: 'the current demo identity does not have the required role',
      request_id: req.id,
      retryable: false,
      details: { kind: 'none' },
    },
  };
}
