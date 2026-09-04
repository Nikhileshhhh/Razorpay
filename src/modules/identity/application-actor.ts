import type { RuntimeEnvironment } from '../../contracts/common/roles.js';
import type { ResolvedIdentity } from './identity-repository.js';
import type { Role } from './roles.js';
import type { TenantContext } from './tenant-context.js';
import type { TrustedWorkerActor } from './worker-actor.js';

/**
 * Identity accepted by application-service transaction variants. User actors
 * are always the result of a current, locked membership lookup. The worker
 * alternative is the unforgeable in-process value from `worker-actor.ts`.
 */
export interface ResolvedUserApplicationActor {
  readonly kind: 'resolved_user';
  readonly identity: ResolvedIdentity;
  readonly activeRole: Role;
}

export type ApplicationActor = ResolvedUserApplicationActor | TrustedWorkerActor;

export interface ApplicationActorProjection {
  readonly actorId: string;
  readonly actorRole: Role;
  readonly environment: RuntimeEnvironment;
}

export function resolvedUserApplicationActor(
  identity: ResolvedIdentity,
  activeRole: Role,
): ResolvedUserApplicationActor {
  if (!identity.roles.includes(activeRole)) {
    throw new Error('resolved actor does not hold the selected active role');
  }
  return { kind: 'resolved_user', identity, activeRole };
}

export function projectApplicationActor(
  actor: ApplicationActor,
  ctx: TenantContext,
): ApplicationActorProjection {
  if (actor.kind === 'trusted_worker') {
    return {
      actorId: 'moneytrace_worker',
      actorRole: 'worker',
      environment: ctx.environment as RuntimeEnvironment,
    };
  }
  if (actor.identity.tenantContext.tenantId !== ctx.tenantId) {
    throw new Error('resolved actor tenant does not match transaction tenant');
  }
  return {
    actorId: actor.identity.userId,
    actorRole: actor.activeRole,
    environment: actor.identity.tenantContext.environment as RuntimeEnvironment,
  };
}

/** Worker activity uses actor_role=worker and never fabricates a users-table FK. */
export function persistedApplicationActorId(actor: ApplicationActor): string | null {
  return actor.kind === 'trusted_worker' ? null : actor.identity.userId;
}
