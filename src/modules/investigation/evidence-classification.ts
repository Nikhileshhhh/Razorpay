import { and, eq } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { cases, economicSubjects, ingestEvents } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { CanonicalEventType } from '../../contracts/events/event-types.js';
import type { EvidenceType } from '../../contracts/evidence.js';
import { sealEvidenceSet, type SealedEvidenceSet } from '../evidence/evidence-set-service.js';

/**
 * Canonical event type -> investigation `EvidenceType` (backend PRD §11.1, §8.7).
 * Only events with a clear evidentiary role in a MISSING_EXPECTED_TRANSFER or
 * DUPLICATE_RECOVERY_RISK finding are mapped; everything else is `null` and
 * excluded from the sealed set (never guessed).
 */
export const EVENT_TYPE_TO_EVIDENCE_TYPE: Readonly<
  Partial<Record<CanonicalEventType, EvidenceType>>
> = {
  OrderPaid: 'paid_order',
  PaymentCaptured: 'captured_payment',
  RefundCreated: 'refund',
  RefundProcessed: 'refund',
  TransferCreated: 'authoritative_transfer_record',
  TransferProcessed: 'authoritative_transfer_record',
  SyntheticTransferFailed: 'authoritative_transfer_record',
  SettlementCreated: 'recipient_settlement',
  SettlementProcessed: 'recipient_settlement',
  SettlementObserved: 'recipient_settlement',
  BankCreditObserved: 'bank_credit',
  SellerReceivableOpened: 'seller_receivable',
  SellerReceivableClosed: 'seller_receivable_closed',
  RecoveryScheduled: 'recovery_action',
  RecoverySuppressed: 'recovery_action',
};

export function evidenceTypeForCanonicalEvent(eventType: string | null): EvidenceType | null {
  if (!eventType) return null;
  return EVENT_TYPE_TO_EVIDENCE_TYPE[eventType as CanonicalEventType] ?? null;
}

export interface ClassifiedEvidenceItem {
  readonly evidenceId: string;
  readonly evidenceType: EvidenceType;
  readonly entityReferences: Record<string, unknown>;
  readonly eventTime: Date;
  readonly amountMinor: bigint | null;
  /** Strict canonical event data retained for typed UTR/value-date comparisons. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface CaseEvidencePool {
  readonly caseId: string;
  readonly subjectId: string;
  readonly subjectKey: string;
  readonly items: readonly ClassifiedEvidenceItem[];
}

export class InvestigationCaseNotFoundError extends Error {
  constructor() {
    super('case not found for investigation');
    this.name = 'InvestigationCaseNotFoundError';
  }
}

/**
 * Collect every classified, non-quarantined evidence item tied to a case's
 * economic subject (backend PRD §11.1: "typed retriever" over real persisted
 * evidence — never model-invented). This is the pool the deterministic
 * gateway AND the citation validator both operate on.
 */
export async function collectCaseEvidencePool(
  db: Database,
  ctx: TenantContext,
  caseId: string,
): Promise<CaseEvidencePool> {
  const caseRows = await db
    .select({ subjectId: cases.subjectId, subjectKey: economicSubjects.subjectKey })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, caseId)))
    .limit(1);
  const row = caseRows[0];
  if (!row) throw new InvestigationCaseNotFoundError();

  const evidenceRows = await db
    .select({
      id: ingestEvents.id,
      eventType: ingestEvents.eventType,
      entityReferences: ingestEvents.entityReferences,
      eventTime: ingestEvents.eventTime,
      amountMinor: ingestEvents.amountMinor,
      rawPayload: ingestEvents.rawPayload,
    })
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        eq(ingestEvents.economicSubjectHint, row.subjectKey),
        eq(ingestEvents.quarantineStatus, 'none'),
      ),
    );

  const items: ClassifiedEvidenceItem[] = [];
  for (const evidenceRow of evidenceRows) {
    const evidenceType = evidenceRow.eventType
      ? EVENT_TYPE_TO_EVIDENCE_TYPE[evidenceRow.eventType as CanonicalEventType]
      : undefined;
    if (!evidenceType) continue;
    items.push({
      evidenceId: evidenceRow.id,
      evidenceType,
      entityReferences: (evidenceRow.entityReferences ?? {}) as Record<string, unknown>,
      eventTime: evidenceRow.eventTime,
      amountMinor: evidenceRow.amountMinor,
      data:
        evidenceRow.rawPayload &&
        typeof evidenceRow.rawPayload === 'object' &&
        !Array.isArray(evidenceRow.rawPayload) &&
        'data' in evidenceRow.rawPayload &&
        evidenceRow.rawPayload.data &&
        typeof evidenceRow.rawPayload.data === 'object' &&
        !Array.isArray(evidenceRow.rawPayload.data)
          ? (evidenceRow.rawPayload.data as Record<string, unknown>)
          : {},
    });
  }

  return { caseId, subjectId: row.subjectId, subjectKey: row.subjectKey, items };
}

/** Seal the case's classified evidence pool into an immutable, content-hashed set. */
export async function sealCaseEvidence(
  db: Database,
  ctx: TenantContext,
  pool: CaseEvidencePool,
): Promise<SealedEvidenceSet> {
  return sealEvidenceSet(
    db,
    ctx,
    pool.items.map((item) => ({ evidenceId: item.evidenceId, role: item.evidenceType })),
  );
}
