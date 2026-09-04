import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { sourceConnections, tenants } from '../../config/db-schema.js';
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
  // Gate B4 remediation: the connector's tenant AND environment both come
  // from persisted rows — never a hard-coded `'demo'` literal — so a
  // non-demo tenant connector is never mislabeled.
  const rows = await db
    .select({ tenantId: sourceConnections.tenantId, environment: tenants.environment })
    .from(sourceConnections)
    .innerJoin(tenants, eq(tenants.id, sourceConnections.tenantId))
    .where(
      and(
        eq(sourceConnections.sourceSystem, sourceSystem),
        eq(sourceConnections.externalAccountId, externalAccountId),
        eq(sourceConnections.capabilityStatus, 'available'),
      ),
    )
    .limit(1);
  return rows[0] ? createTenantContext(rows[0].tenantId, rows[0].environment) : null;
}
