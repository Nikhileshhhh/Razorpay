import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { entityCurrent, entityRevisions, ingestEvents } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { contentHash } from '../../config/hashing.js';
import { openOrGetCase } from '../cases/case-service.js';
import { money } from '../../domain/money/money.js';
import { recordInvariantEvaluation } from './evaluation-store.js';

export const CTRL_04_ID = 'CTRL-04';
export const CTRL_04_VERSION = 'v1';
const CAPTURE_EVENT_TYPES = ['PaymentCaptured'] as const;

export interface Ctrl04Input {
  readonly subjectId: string;
  readonly subjectKey: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  /** The amount the scheduled recovery would otherwise collect. */
  readonly scheduledRecoveryAmountMinor: bigint;
  readonly evaluatedAt: Date;
}

export interface Ctrl04Result {
  readonly violated: boolean;
  readonly caseId: string | null;
  readonly caseCreated: boolean;
  readonly preventedAmountMinor: bigint | null;
}

/**
 * CTRL-04: duplicate recovery risk (PRD §9.4, §10.1). A captured payment that
 * already satisfies the commercial intent, PLUS a scheduled recovery for the
 * same subject, is flagged so the control loop can block the scheduled
 * collection (`SUPPRESS_SIMULATED_RECOVERY`) rather than double-charge the
 * customer. `evaluationWindow` is keyed by `evaluatedAt` in day-granularity so
 * a scheduling job that runs more than once on the same day converges to one
 * case, not a proliferation of windows.
 */
export async function evaluateCtrl04DuplicateRecovery(
  db: Database,
  ctx: TenantContext,
  input: Ctrl04Input,
): Promise<Ctrl04Result> {
  const evaluationWindow = input.evaluatedAt.toISOString().slice(0, 10); // day bucket

  // Recovery evidence must reflect the LATEST authoritative projected state
  // for the recovery entity, not merely "a RecoveryScheduled event was ever
  // ingested" — a later `RecoverySuppressed` supersedes it in
  // `entity_current` (recovery is cyclic, see `isCyclicEntityType` in
  // entity-mapping.ts) and must clear a stale violation, while a LATER
  // authoritative RecoveryScheduled reschedule must be detectable again.
  const [captureEvidence, recoveryRows] = await Promise.all([
    db
      .select({
        id: ingestEvents.id,
        amountMinor: ingestEvents.amountMinor,
        currency: ingestEvents.currency,
      })
      .from(ingestEvents)
      .where(
        and(
          eq(ingestEvents.tenantId, ctx.tenantId),
          eq(ingestEvents.economicSubjectHint, input.subjectKey),
          inArray(ingestEvents.eventType, [...CAPTURE_EVENT_TYPES]),
          eq(ingestEvents.quarantineStatus, 'none'),
        ),
      ),
    db
      .select({
        id: ingestEvents.id,
        amountMinor: entityRevisions.amountMinor,
        currency: entityRevisions.currency,
      })
      .from(entityCurrent)
      .innerJoin(
        entityRevisions,
        and(
          eq(entityRevisions.tenantId, entityCurrent.tenantId),
          eq(entityRevisions.id, entityCurrent.currentRevisionId),
        ),
      )
      .innerJoin(
        ingestEvents,
        and(
          eq(ingestEvents.tenantId, entityRevisions.tenantId),
          eq(ingestEvents.id, entityRevisions.ingestEventId),
        ),
      )
      .where(
        and(
          eq(entityCurrent.tenantId, ctx.tenantId),
          eq(entityCurrent.entityType, 'recovery'),
          eq(ingestEvents.economicSubjectHint, input.subjectKey),
          eq(entityRevisions.businessState, 'scheduled'),
          eq(ingestEvents.quarantineStatus, 'none'),
        ),
      ),
  ]);

  const qualifyingCapture = captureEvidence.filter(
    (row) => row.amountMinor === input.scheduledRecoveryAmountMinor && row.currency === 'INR',
  );
  const qualifyingRecovery = recoveryRows.filter(
    (row) => row.amountMinor === input.scheduledRecoveryAmountMinor && row.currency === 'INR',
  );
  const violated = qualifyingCapture.length > 0 && qualifyingRecovery.length > 0;
  const inputHash = contentHash({
    subjectId: input.subjectId,
    evaluationWindow,
    captureEvidenceIds: qualifyingCapture.map((row) => row.id).sort(),
    recoveryEvidenceIds: qualifyingRecovery.map((row) => row.id).sort(),
  });
  await recordInvariantEvaluation(db, ctx, {
    controlId: CTRL_04_ID,
    controlVersion: CTRL_04_VERSION,
    subjectId: input.subjectId,
    evaluationWindow,
    inputHash,
    result: violated ? 'violated' : 'clean',
    amountMinor: violated ? input.scheduledRecoveryAmountMinor : null,
    evidenceIds: [...qualifyingCapture, ...qualifyingRecovery].map((row) => row.id),
    evaluatedAt: input.evaluatedAt,
  });

  if (!violated) {
    return { violated: false, caseId: null, caseCreated: false, preventedAmountMinor: null };
  }

  const result = await openOrGetCase(db, ctx, {
    controlId: CTRL_04_ID,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow,
    exposure: money(input.scheduledRecoveryAmountMinor),
    priority: {
      exposure: money(input.scheduledRecoveryAmountMinor),
      evidenceCoverage: 'complete',
      customerHarmRisk: 'high',
      ageSeconds: 0,
    },
  });

  return {
    violated: true,
    caseId: result.caseId,
    caseCreated: result.created,
    preventedAmountMinor: input.scheduledRecoveryAmountMinor,
  };
}
