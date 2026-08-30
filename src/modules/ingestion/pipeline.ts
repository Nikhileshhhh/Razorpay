import type { Database } from '../../config/db.js';
import type { TenantContext } from '../identity/tenant-context.js';
import {
  acceptEvidence,
  type AcceptanceOutcome,
  type AcceptEvidenceInput,
} from './ingestion-service.js';
import { projectIngestEvent } from '../projection/projector.js';

/**
 * Compose acceptance + projection (backend PRD §9.1 acceptance sequence:
 * "enqueue projector only for accepted non-conflict evidence"). Ingestion
 * itself does not project before its own commit; this pipeline calls
 * projection as a SEPARATE step only once acceptance has already committed,
 * and only for a genuinely new `accepted` outcome — duplicates and conflicts
 * never trigger projection.
 */
export async function ingestAndProject(
  db: Database,
  ctx: TenantContext,
  input: AcceptEvidenceInput,
): Promise<AcceptanceOutcome> {
  const outcome = await acceptEvidence(db, ctx, input);
  if (outcome.outcome === 'accepted') {
    await projectIngestEvent(db, ctx, outcome.eventId);
  }
  return outcome;
}
