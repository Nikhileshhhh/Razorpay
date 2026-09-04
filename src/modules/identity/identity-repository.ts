import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseTransaction, DbExecutor } from '../../config/db.js';
import { memberships, tenants, users } from '../../config/db-schema.js';
import { createTenantContext, type TenantContext } from './tenant-context.js';
import { assertHasAnyRole, type Role } from './roles.js';

export interface ResolvedIdentity {
  readonly userId: string;
  readonly displayName: string;
  readonly tenantContext: TenantContext;
  readonly roles: readonly Role[];
}

/**
 * Resolve a demo user id into their tenant context and roles (backend PRD
 * §6.1). Returns `null` when the user does not exist — the caller (demo auth
 * middleware, Gate B2+) maps that to `401`. This is the ONLY path by which a
 * tenant/role is established; a client-submitted tenant/role is never trusted.
 */
export async function resolveIdentity(
  db: DbExecutor,
  userId: string,
): Promise<ResolvedIdentity | null> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return null;

  const membershipRows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.tenantId, user.tenantId), eq(memberships.userId, userId)));

  return {
    userId: user.id,
    displayName: user.displayName,
    tenantContext: createTenantContext(tenant.id, tenant.environment),
    roles: membershipRows.map((m) => m.role as Role),
  };
}

export class ActorIdentityInvalidError extends Error {
  constructor() {
    super('the actor is not a current member of the tenant');
    this.name = 'ActorIdentityInvalidError';
  }
}

/**
 * Re-resolve identity at the service boundary. Callers supply only an opaque
 * user id; tenant and roles always come from current database membership.
 */
export async function authorizeTenantActor(
  db: DbExecutor,
  ctx: TenantContext,
  userId: string,
  requiredAnyOf: readonly Role[],
): Promise<ResolvedIdentity> {
  const identity = await resolveIdentity(db, userId);
  if (!identity || identity.tenantContext.tenantId !== ctx.tenantId) {
    throw new ActorIdentityInvalidError();
  }
  assertHasAnyRole(identity.roles, requiredAnyOf);
  return identity;
}

/**
 * Transactional authorization variant used by mutations. Locking the user,
 * tenant, and current membership rows prevents role revocation or environment
 * changes from committing between authorization and the protected mutation.
 */
export async function authorizeTenantActorForUpdate(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  userId: string,
  requiredAnyOf: readonly Role[],
): Promise<ResolvedIdentity> {
  await tx.execute(sql`select id from users where id = ${userId} for update`);
  const userRows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user || user.tenantId !== ctx.tenantId) throw new ActorIdentityInvalidError();

  await tx.execute(sql`select id from tenants where id = ${user.tenantId} for update`);
  await tx.execute(
    sql`select id from memberships where tenant_id = ${user.tenantId} and user_id = ${userId} for update`,
  );
  return authorizeTenantActor(tx, ctx, userId, requiredAnyOf);
}

export async function getTenant(db: DbExecutor, tenantId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return rows[0] ?? null;
}

export class TenantNotFoundError extends Error {
  constructor(readonly tenantId: string) {
    super(`tenant ${tenantId} does not exist`);
    this.name = 'TenantNotFoundError';
  }
}

/**
 * Gate B4 remediation: resolve a job/connector payload's bare tenant id into
 * its persisted `TenantContext` (environment included) by reading the
 * `tenants` row — never a hard-coded `'demo'` literal. A payload naming a
 * tenant that no longer exists (deleted/never provisioned) fails the job
 * loudly rather than silently mislabeling its environment.
 */
export async function resolveTenantContext(
  db: DbExecutor,
  tenantId: string,
): Promise<TenantContext> {
  const tenant = await getTenant(db, tenantId);
  if (!tenant) throw new TenantNotFoundError(tenantId);
  return createTenantContext(tenant.id, tenant.environment);
}
