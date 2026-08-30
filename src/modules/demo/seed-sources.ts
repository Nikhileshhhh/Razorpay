import type { Database } from '../../config/db.js';
import { sourceConnections } from '../../config/db-schema.js';
import type { SourceSystem } from '../../contracts/events/event-types.js';

const DEMO_SOURCES: readonly { source: SourceSystem; accountId: string }[] = [
  { source: 'RAZORPAY_TEST', accountId: 'acct_demo_razorpay_test' },
  { source: 'SYNTHETIC_RAZORPAY_FIXTURE', accountId: 'acct_demo_razorpay_fixture' },
  { source: 'SYNTHETIC_OMS', accountId: 'acct_demo_oms' },
  { source: 'SYNTHETIC_ERP', accountId: 'acct_demo_erp' },
  { source: 'SYNTHETIC_BANK', accountId: 'acct_demo_bank' },
  { source: 'SYNTHETIC_RECOVERY', accountId: 'acct_demo_recovery' },
  { source: 'SYNTHETIC_AGENT', accountId: 'acct_demo_agent' },
  { source: 'SYNTHETIC_ROUTE', accountId: 'acct_demo_route' },
  { source: 'MONEYTRACE', accountId: 'acct_demo_moneytrace' },
];

export async function seedSourceConnections(db: Pick<Database, 'insert'>): Promise<void> {
  for (const source of DEMO_SOURCES) {
    await db
      .insert(sourceConnections)
      .values({
        id: `source_${source.source.toLowerCase()}`,
        tenantId: 'ten_demo',
        sourceSystem: source.source,
        externalAccountId: source.accountId,
        capabilityStatus: 'available',
      })
      .onConflictDoUpdate({
        target: sourceConnections.id,
        set: { capabilityStatus: 'available', externalAccountId: source.accountId },
      });
  }
}
