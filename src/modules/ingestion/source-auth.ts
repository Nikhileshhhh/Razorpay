import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { sourceConnections } from '../../config/db-schema.js';
import type { SourceSystem } from '../../contracts/events/event-types.js';
import { createTenantContext, type TenantContext } from '../identity/tenant-context.js';

export function verifyHmacSha256(
  rawBytes: Buffer,
  provided: string | undefined,
  secret: string,
): boolean {
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac('sha256', secret).update(rawBytes).digest();
  const actual = Buffer.from(provided, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function resolveSourceTenant(
  db: Database,
  sourceSystem: SourceSystem,
  externalAccountId: string,
): Promise<TenantContext | null> {
  const rows = await db
    .select({ tenantId: sourceConnections.tenantId })
    .from(sourceConnections)
    .where(
      and(
        eq(sourceConnections.sourceSystem, sourceSystem),
        eq(sourceConnections.externalAccountId, externalAccountId),
        eq(sourceConnections.capabilityStatus, 'available'),
      ),
    )
    .limit(1);
  return rows[0] ? createTenantContext(rows[0].tenantId, 'demo') : null;
}
