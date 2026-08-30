import { eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { memberships, tenants, users } from '../../config/db-schema.js';
import { createTenantContext, type TenantContext } from './tenant-context.js';
import type { Role } from './roles.js';

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
  db: Database,
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
    .where(eq(memberships.userId, userId));

  return {
    userId: user.id,
    displayName: user.displayName,
    tenantContext: createTenantContext(tenant.id, tenant.environment),
    roles: membershipRows.map((m) => m.role as Role),
  };
}

export async function getTenant(db: Database, tenantId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return rows[0] ?? null;
}
