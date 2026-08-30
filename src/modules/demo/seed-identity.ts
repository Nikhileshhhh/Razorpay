import { randomUUID } from 'node:crypto';
import type { Database } from '../../config/db.js';
import { memberships, tenants, users } from '../../config/db-schema.js';
import { SEED_TENANTS, SEED_USERS } from '../identity/seed-data.js';

/**
 * Idempotently seed the deterministic demo tenants/users/memberships (backend
 * PRD §6.1, §16). Uses `onConflictDoNothing`/`onConflictDoUpdate` on the
 * literal seed IDs so running this twice produces identical resulting rows —
 * required by "seed/reset twice with identical manifest" (§19.2).
 */
export async function seedIdentity(db: Pick<Database, 'insert'>): Promise<void> {
  for (const tenant of SEED_TENANTS) {
    await db
      .insert(tenants)
      .values({
        id: tenant.id,
        displayName: tenant.displayName,
        environment: tenant.environment,
        currencyDefault: 'INR',
        dataRetentionPolicy: 'demo_synthetic_no_retention',
      })
      .onConflictDoUpdate({
        target: tenants.id,
        set: { displayName: tenant.displayName, environment: tenant.environment },
      });
  }

  for (const user of SEED_USERS) {
    await db
      .insert(users)
      .values({ id: user.id, tenantId: user.tenantId, displayName: user.displayName })
      .onConflictDoUpdate({
        target: users.id,
        set: { tenantId: user.tenantId, displayName: user.displayName },
      });

    for (const role of user.roles) {
      await db
        .insert(memberships)
        .values({
          // Deterministic membership id so re-seeding never duplicates a role row.
          id: `mem_${user.id}_${role}`,
          tenantId: user.tenantId,
          userId: user.id,
          role,
        })
        .onConflictDoNothing({
          target: [memberships.tenantId, memberships.userId, memberships.role],
        });
    }
  }
}

/** Exposed for callers that need a fresh opaque id (e.g. future seed steps). */
export function newSeedId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
