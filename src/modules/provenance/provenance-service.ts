import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  auditEntries,
  entityLinkReviews,
  entityLinks,
  evidenceSets,
} from '../../config/db-schema.js';
import { EdgeType, EdgeConfidenceClass, PathObservation } from '../../contracts/cases.js';
import { isUniqueViolation } from '../../config/errors.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { sealEvidenceSet } from '../evidence/evidence-set-service.js';

export interface CreateEntityLinkInput {
  readonly edgeType: string;
  readonly sourceNodeKey: string;
  readonly targetNodeKey: string;
  readonly confidenceClass: string;
  readonly observation: string;
  readonly resolverVersion: string;
  readonly evidenceSetHash: string;
  readonly score?: string | null;
}

export class ProvenanceInputError extends Error {
  constructor() {
    super('invalid provenance link input');
    this.name = 'ProvenanceInputError';
  }
}

export class LinkVersionConflictError extends Error {
  constructor() {
    super('provenance link version conflict');
    this.name = 'LinkVersionConflictError';
  }
}

export async function createEntityLink(
  db: Database,
  ctx: TenantContext,
  input: CreateEntityLinkInput,
): Promise<string> {
  const edgeType = EdgeType.safeParse(input.edgeType);
  const confidence = EdgeConfidenceClass.safeParse(input.confidenceClass);
  const observation = PathObservation.safeParse(input.observation);
  if (
    !edgeType.success ||
    !confidence.success ||
    !observation.success ||
    input.sourceNodeKey === input.targetNodeKey
  ) {
    throw new ProvenanceInputError();
  }
  const set = await db
    .select({ hash: evidenceSets.evidenceSetHash })
    .from(evidenceSets)
    .where(
      and(
        eq(evidenceSets.tenantId, ctx.tenantId),
        eq(evidenceSets.evidenceSetHash, input.evidenceSetHash),
      ),
    )
    .limit(1);
  if (!set[0]) throw new ProvenanceInputError();
  return db.transaction(async (tx) => {
    const identity = `${ctx.tenantId}|${input.resolverVersion}|${input.sourceNodeKey}|${input.targetNodeKey}|${edgeType.data}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const existing = await tx
      .select({ id: entityLinks.id })
      .from(entityLinks)
      .where(
        and(
          eq(entityLinks.tenantId, ctx.tenantId),
          eq(entityLinks.resolverVersion, input.resolverVersion),
          eq(entityLinks.sourceNodeKey, input.sourceNodeKey),
          eq(entityLinks.targetNodeKey, input.targetNodeKey),
          eq(entityLinks.edgeType, edgeType.data),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;
    const id = `link_${randomUUID()}`;
    await tx.insert(entityLinks).values({
      id,
      tenantId: ctx.tenantId,
      edgeType: edgeType.data,
      sourceNodeKey: input.sourceNodeKey,
      targetNodeKey: input.targetNodeKey,
      confidenceClass: confidence.data,
      observation: observation.data,
      resolverVersion: input.resolverVersion,
      evidenceSetHash: input.evidenceSetHash,
      score: input.score ?? null,
      reviewStatus: confidence.data === 'candidate' ? 'unreviewed' : 'not_required',
      version: 0,
    });
    return id;
  });
}

export async function createProjectionProvenance(
  db: Database,
  ctx: TenantContext,
  input: {
    readonly ingestEventId: string;
    readonly subjectKey: string;
    readonly entityKey: string;
    readonly entityType: string;
  },
): Promise<string> {
  const set = await sealEvidenceSet(db, ctx, [
    { evidenceId: input.ingestEventId, role: 'projected_source' },
  ]);
  const edge = projectedEdge(input.entityType);
  return createEntityLink(db, ctx, {
    edgeType: edge.edgeType,
    sourceNodeKey: edge.subjectFirst ? input.subjectKey : input.entityKey,
    targetNodeKey: edge.subjectFirst ? input.entityKey : input.subjectKey,
    confidenceClass: 'verified',
    observation: 'observed',
    resolverVersion: 'projection-v1',
    evidenceSetHash: set.hash,
  });
}

function projectedEdge(entityType: string): { edgeType: string; subjectFirst: boolean } {
  switch (entityType) {
    case 'payment':
      return { edgeType: 'PAYMENT_FOR', subjectFirst: false };
    case 'transfer':
      return { edgeType: 'SOURCE_OF_TRANSFER', subjectFirst: true };
    case 'settlement':
      return { edgeType: 'SETTLED_IN', subjectFirst: true };
    case 'bank_credit':
      return { edgeType: 'OBSERVED_IN_BANK', subjectFirst: true };
    case 'receivable':
      return { edgeType: 'DERIVED_FROM', subjectFirst: true };
    case 'recovery':
      return { edgeType: 'RECOVERS_SUBJECT', subjectFirst: true };
    default:
      return { edgeType: 'DERIVED_FROM', subjectFirst: false };
  }
}

export async function reviewEntityLink(
  db: Database,
  ctx: TenantContext,
  input: {
    readonly linkId: string;
    readonly expectedVersion: number;
    readonly decision: 'confirm' | 'reject';
    readonly reason: string;
    readonly reviewerId: string;
    readonly reviewerRole: string;
  },
): Promise<number> {
  return db.transaction(async (tx) => {
    const link = await tx
      .select({ id: entityLinks.id, version: entityLinks.version })
      .from(entityLinks)
      .where(
        and(
          eq(entityLinks.tenantId, ctx.tenantId),
          eq(entityLinks.id, input.linkId),
          eq(entityLinks.confidenceClass, 'candidate'),
        ),
      )
      .limit(1);
    if (!link[0]) throw new LinkVersionConflictError();
    const latest = await tx
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
    const actual = latest[0]?.version ?? link[0].version;
    if (actual !== input.expectedVersion) throw new LinkVersionConflictError();
    const nextVersion = actual + 1;
    // The SELECT above does not lock against a concurrent reviewer inserting
    // the SAME next reviewVersion for this link; `entity_link_reviews_uq`
    // (tenant_id, link_id, review_version) is the actual race arbiter. Without
    // this catch, the loser of that race would surface a raw Postgres
    // unique-violation instead of the typed conflict callers expect.
    try {
      await tx.insert(entityLinkReviews).values({
        id: `link_review_${randomUUID()}`,
        tenantId: ctx.tenantId,
        linkId: input.linkId,
        reviewVersion: nextVersion,
        decision: input.decision === 'confirm' ? 'confirmed' : 'rejected',
        reviewerId: input.reviewerId,
        reason: input.reason,
      });
    } catch (caught) {
      if (isUniqueViolation(caught, 'entity_link_reviews_uq')) throw new LinkVersionConflictError();
      throw caught;
    }
    await tx.insert(auditEntries).values({
      id: `audit_${randomUUID()}`,
      tenantId: ctx.tenantId,
      artifactType: 'MANUAL_LINK',
      artifactId: input.linkId,
      actorId: input.reviewerId,
      actorRole: input.reviewerRole,
      details: { decision: input.decision, reason: input.reason },
    });
    return nextVersion;
  });
}
