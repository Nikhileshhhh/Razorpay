import type { FastifyInstance } from 'fastify';
import { toSafeError } from '../config/errors.js';
import { ActorIdentityInvalidError } from '../modules/identity/identity-repository.js';
import { RoleForbiddenError } from '../modules/identity/roles.js';
import { problem } from './routes/problem.js';

/** Install one fail-closed envelope for every unexpected route exception. */
export function installSafeErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error, req, reply) => {
    if (error instanceof ActorIdentityInvalidError) {
      return reply
        .code(401)
        .send(problem(req, 'TENANT_SCOPE_REQUIRED', 'the current identity is no longer valid'));
    }
    if (error instanceof RoleForbiddenError) {
      return reply
        .code(403)
        .send(
          problem(req, 'POLICY_DENIED', 'the current identity no longer has the required role'),
        );
    }

    req.log.error(
      { request_id: req.id, err: toSafeError(error, 'internal') },
      'request failed safely',
    );
    return reply
      .code(503)
      .send(problem(req, 'SOURCE_UNAVAILABLE', 'the request could not be completed', true));
  });
}
