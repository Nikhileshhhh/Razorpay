import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, or } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  auditEntries,
  caseNotes,
  cases,
  economicSubjects,
  entityLinks,
  entityLinkReviews,
  eventConflicts,
  ingestEvents,
  users,
} from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { isUniqueViolation } from '../../config/errors.js';
import { CaseVersionConflictError } from './case-service.js';

export class CaseOperationNotFoundError extends Error {
  constructor() {
    super('case operation target not found');
    this.name = 'CaseOperationNotFoundError';
  }
}

interface TimelineCursor {
  readonly time: string;
  readonly id: string;
}

function decodeTimelineCursor(cursor?: string): TimelineCursor | null {
  if (!cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      Object.keys(value).sort().join(',') !== 'id,time' ||
      typeof value.id !== 'string' ||
      typeof value.time !== 'string'
    )
      throw new Error();
    const time = new Date(value.time);
    if (Number.isNaN(time.getTime()) || time.toISOString() !== value.time) throw new Error();
    return { id: value.id, time: value.time };
  } catch {
    throw new Error('invalid timeline cursor');
  }
}

function encodeTimelineCursor(value: TimelineCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export async function assignCase(
  db: Database,
  ctx: TenantContext,
  input: {
    caseId: string;
    ownerId: string | null;
    expectedVersion: number;
    actorId: string;
    actorRole: string;
  },
) {
  return db.transaction(async (tx) => {
    if (input.ownerId) {
      const owner = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.ownerId)))
        .limit(1);
      if (!owner[0]) throw new CaseOperationNotFoundError();
    }
    const nextVersion = input.expectedVersion + 1;
    const updated = await tx
      .update(cases)
      .set({ ownerId: input.ownerId, version: nextVersion })
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.id, input.caseId),
          eq(cases.version, input.expectedVersion),
        ),
      )
      .returning({ id: cases.id });
    if (updated.length !== 1)
      throw new CaseVersionConflictError(input.caseId, input.expectedVersion, nextVersion);
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'ADMIN_CHANGE',
      artifactId: input.caseId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      details: { operation: 'case_assignment', owner_id: input.ownerId },
    });
    return { version: nextVersion, ownerId: input.ownerId };
  });
}

export async function appendCaseNote(
  db: Database,
  ctx: TenantContext,
  input: {
    caseId: string;
    body: string;
    expectedVersion: number;
    authorId: string;
    actorRole: string;
  },
) {
  return db.transaction(async (tx) => {
    const nextVersion = input.expectedVersion + 1;
    const updated = await tx
      .update(cases)
      .set({ version: nextVersion })
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.id, input.caseId),
          eq(cases.version, input.expectedVersion),
        ),
      )
      .returning({ id: cases.id });
    if (updated.length !== 1)
      throw new CaseVersionConflictError(input.caseId, input.expectedVersion, nextVersion);
    const noteId = `note_${randomUUID()}`;
    const createdAt = new Date();
    await tx.insert(caseNotes).values({
      id: noteId,
      tenantId: ctx.tenantId,
      caseId: input.caseId,
      authorId: input.authorId,
      body: input.body,
      expectedCaseVersion: input.expectedVersion,
      createdAt,
    });
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'ADMIN_CHANGE',
      artifactId: noteId,
      actorId: input.authorId,
      actorRole: input.actorRole,
      details: { operation: 'case_note_appended', case_id: input.caseId },
    });
    return { noteId, createdAt, version: nextVersion };
  });
}

export async function listCaseNotes(
  db: Database,
  ctx: TenantContext,
  caseId: string,
  cursorValue: string | undefined,
  limit: number,
) {
  const exists = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, caseId)))
    .limit(1);
  if (!exists[0]) return null;
  const cursor = decodeTimelineCursor(cursorValue);
  const conditions = [eq(caseNotes.tenantId, ctx.tenantId), eq(caseNotes.caseId, caseId)];
  if (cursor) {
    const time = new Date(cursor.time);
    conditions.push(
      or(
        gt(caseNotes.createdAt, time),
        and(eq(caseNotes.createdAt, time), gt(caseNotes.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(caseNotes)
    .where(and(...conditions))
    .orderBy(asc(caseNotes.createdAt), asc(caseNotes.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      note_id: row.id,
      case_id: row.caseId,
      author_id: row.authorId,
      body: row.body,
      created_at: row.createdAt.toISOString(),
      case_version: row.expectedCaseVersion + 1,
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeTimelineCursor({ time: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function listCaseEvidence(
  db: Database,
  ctx: TenantContext,
  caseId: string,
  cursorValue: string | undefined,
  limit: number,
) {
  const caseRows = await db
    .select({ subjectKey: economicSubjects.subjectKey })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, caseId)))
    .limit(1);
  if (!caseRows[0]) return null;
  const cursor = decodeTimelineCursor(cursorValue);
  const conditions = [
    eq(ingestEvents.tenantId, ctx.tenantId),
    eq(ingestEvents.economicSubjectHint, caseRows[0].subjectKey),
  ];
  if (cursor) {
    const time = new Date(cursor.time);
    conditions.push(
      or(
        gt(ingestEvents.eventTime, time),
        and(eq(ingestEvents.eventTime, time), gt(ingestEvents.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(ingestEvents)
    .where(and(...conditions))
    .orderBy(asc(ingestEvents.eventTime), asc(ingestEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const conflictRows = page.length
    ? await db
        .select({ eventId: eventConflicts.existingIngestEventId })
        .from(eventConflicts)
        .where(
          and(
            eq(eventConflicts.tenantId, ctx.tenantId),
            inArray(
              eventConflicts.existingIngestEventId,
              page.map((row) => row.id),
            ),
          ),
        )
    : [];
  const conflicting = new Set(conflictRows.map((row) => row.eventId));
  const hasMore = rows.length > limit;
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      schema_version: '1.0' as const,
      evidence_id: row.id,
      tenant_id: row.tenantId,
      source_system: row.sourceSystem,
      source_record_type: row.eventType ?? row.sourceEventType,
      source_record_id: row.sourceEventId ?? row.id,
      source_event_id: row.sourceEventId,
      source_event_type: row.sourceEventType,
      event_type: row.eventType,
      event_time: row.eventTime.toISOString(),
      ingested_at: row.ingestedAt.toISOString(),
      payload_hash: row.payloadHash,
      raw_payload_ref: `db:ingest_events/${row.id}`,
      signature_status: row.signatureStatus,
      dedupe_status: conflicting.has(row.id) ? 'conflicting_duplicate' : row.dedupeStatus,
      quarantine_status: row.quarantineStatus,
      related_case_id: caseId,
      is_conflicting: conflicting.has(row.id),
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeTimelineCursor({ time: last.eventTime.toISOString(), id: last.id })
        : null,
  };
}

export async function decideCandidateLink(
  db: Database,
  ctx: TenantContext,
  input: {
    caseId: string;
    linkId: string;
    expectedCaseVersion: number;
    expectedLinkVersion: number;
    decision: 'confirm' | 'reject';
    reason: string;
    actorId: string;
    actorRole: string;
  },
) {
  return db.transaction(async (tx) => {
    const related = await tx
      .select({ subjectKey: economicSubjects.subjectKey, link: entityLinks })
      .from(cases)
      .innerJoin(
        economicSubjects,
        and(
          eq(economicSubjects.tenantId, cases.tenantId),
          eq(economicSubjects.id, cases.subjectId),
        ),
      )
      .innerJoin(
        entityLinks,
        and(eq(entityLinks.tenantId, cases.tenantId), eq(entityLinks.id, input.linkId)),
      )
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.id, input.caseId),
          eq(cases.version, input.expectedCaseVersion),
        ),
      )
      .limit(1);
    const row = related[0];
    if (
      !row ||
      (row.link.sourceNodeKey !== row.subjectKey && row.link.targetNodeKey !== row.subjectKey)
    )
      throw new CaseOperationNotFoundError();
    if (row.link.confidenceClass !== 'candidate') throw new CaseOperationNotFoundError();
    const latestReview = await tx
      .select({ version: entityLinkReviews.reviewVersion })
      .from(entityLinkReviews)
      .where(
        and(
          eq(entityLinkReviews.tenantId, ctx.tenantId),
          eq(entityLinkReviews.linkId, input.linkId),
        ),
      )
      .orderBy(desc(entityLinkReviews.reviewVersion))
      .limit(1);
    const currentLinkVersion = latestReview[0]?.version ?? row.link.version;
    const linkVersion = currentLinkVersion + 1;
    if (currentLinkVersion !== input.expectedLinkVersion) {
      throw new CaseVersionConflictError(
        input.caseId,
        input.expectedLinkVersion,
        currentLinkVersion,
      );
    }
    // The SELECT above does not lock against a concurrent reviewer inserting
    // the SAME next reviewVersion for this link; `entity_link_reviews_uq`
    // (tenant_id, link_id, review_version) is the actual race arbiter.
    // Without this catch, the loser of that race would surface a raw
    // Postgres unique-violation instead of the typed conflict callers expect
    // (this is the route actually wired to `POST /v1/cases/:id/evidence` link
    // decisions — see api/routes/case-details.ts).
    try {
      await tx.insert(entityLinkReviews).values({
        id: `link_review_${randomUUID()}`,
        tenantId: ctx.tenantId,
        linkId: input.linkId,
        reviewVersion: linkVersion,
        decision: input.decision === 'confirm' ? 'confirmed' : 'rejected',
        reviewerId: input.actorId,
        reason: input.reason,
      });
    } catch (caught) {
      if (isUniqueViolation(caught, 'entity_link_reviews_uq')) {
        throw new CaseVersionConflictError(input.caseId, input.expectedLinkVersion, linkVersion);
      }
      throw caught;
    }
    const caseVersion = input.expectedCaseVersion + 1;
    const updatedCase = await tx
      .update(cases)
      .set({ version: caseVersion })
      .where(
        and(
          eq(cases.tenantId, ctx.tenantId),
          eq(cases.id, input.caseId),
          eq(cases.version, input.expectedCaseVersion),
        ),
      )
      .returning({ id: cases.id });
    if (updatedCase.length !== 1)
      throw new CaseVersionConflictError(input.caseId, input.expectedCaseVersion, caseVersion);
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'MANUAL_LINK',
      artifactId: input.linkId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      details: { decision: input.decision, reason: input.reason, case_id: input.caseId },
    });
    return { caseVersion, linkVersion };
  });
}
