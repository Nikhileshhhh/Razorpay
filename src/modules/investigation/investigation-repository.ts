import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { investigations } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { Finding } from '../../contracts/findings.js';

export interface InvestigationSummary {
  readonly investigationId: string;
  readonly finding: Finding | null;
  readonly abstentionReason: 'INSUFFICIENT_EVIDENCE' | 'CONFLICTING_EVIDENCE' | null;
  readonly failureClass: string | null;
  readonly evidenceSetHash: string;
  readonly createdAt: string;
}

/** The most recent investigation attempt for a case (used by the control-loop read model). */
export async function getLatestInvestigation(
  db: Database,
  ctx: TenantContext,
  caseId: string,
): Promise<InvestigationSummary | null> {
  const rows = await db
    .select()
    .from(investigations)
    .where(and(eq(investigations.tenantId, ctx.tenantId), eq(investigations.caseId, caseId)))
    .orderBy(desc(investigations.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const output = row.output as
    | (Finding & { readonly result_type?: undefined })
    | {
        readonly result_type: 'ABSTENTION';
        readonly abstention_reason: 'INSUFFICIENT_EVIDENCE' | 'CONFLICTING_EVIDENCE';
      }
    | null;
  const isFinding = output !== null && 'finding_code' in output;
  return {
    investigationId: row.id,
    finding: isFinding ? (output as Finding) : null,
    abstentionReason:
      output !== null && 'abstention_reason' in output
        ? (output.abstention_reason as 'INSUFFICIENT_EVIDENCE' | 'CONFLICTING_EVIDENCE')
        : null,
    failureClass: row.failureClass,
    evidenceSetHash: row.evidenceSetHash,
    createdAt: row.createdAt.toISOString(),
  };
}
