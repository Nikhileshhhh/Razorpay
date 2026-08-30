import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { evidenceSetItems, evidenceSets, ingestEvents } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import { LIMITS } from '../../contracts/common/limits.js';
import type { TenantContext } from '../identity/tenant-context.js';

export interface EvidenceSetItemInput {
  readonly evidenceId: string;
  readonly role: string;
}

export interface SealedEvidenceSet {
  readonly id: string;
  readonly hash: string;
  readonly itemCount: number;
}

export class EvidenceSetInvalidError extends Error {
  constructor() {
    super('evidence set contains missing, duplicate, cross-tenant, or invalid evidence');
    this.name = 'EvidenceSetInvalidError';
  }
}

export async function sealEvidenceSet(
  db: Database,
  ctx: TenantContext,
  rawItems: readonly EvidenceSetItemInput[],
): Promise<SealedEvidenceSet> {
  if (rawItems.length === 0 || rawItems.length > LIMITS.EVIDENCE_IDS_MAX) {
    throw new EvidenceSetInvalidError();
  }
  const items = [...rawItems].sort((a, b) =>
    `${a.evidenceId}|${a.role}`.localeCompare(`${b.evidenceId}|${b.role}`),
  );
  if (new Set(items.map((item) => item.evidenceId)).size !== items.length) {
    throw new EvidenceSetInvalidError();
  }
  const evidence = await db
    .select({ id: ingestEvents.id, hash: ingestEvents.payloadHash })
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.tenantId, ctx.tenantId),
        inArray(
          ingestEvents.id,
          items.map((item) => item.evidenceId),
        ),
      ),
    );
  if (evidence.length !== items.length) throw new EvidenceSetInvalidError();
  const hashById = new Map(evidence.map((row) => [row.id, row.hash]));
  const canonicalItems = items.map((item) => ({
    evidenceId: item.evidenceId,
    payloadHash: hashById.get(item.evidenceId),
    role: item.role,
  }));
  const hash = contentHash(canonicalItems);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|evidence-set|${hash}`}, 0))`,
    );
    const existing = await tx
      .select()
      .from(evidenceSets)
      .where(and(eq(evidenceSets.tenantId, ctx.tenantId), eq(evidenceSets.evidenceSetHash, hash)))
      .limit(1);
    if (existing[0]) {
      return { id: existing[0].id, hash, itemCount: existing[0].itemCount };
    }
    const id = `evidence_set_${randomUUID()}`;
    await tx.insert(evidenceSets).values({
      id,
      tenantId: ctx.tenantId,
      evidenceSetHash: hash,
      itemCount: items.length,
    });
    await tx.insert(evidenceSetItems).values(
      items.map((item, ordinal) => ({
        id: `evidence_item_${randomUUID()}`,
        tenantId: ctx.tenantId,
        evidenceSetId: id,
        evidenceId: item.evidenceId,
        itemRole: item.role,
        ordinal,
      })),
    );
    return { id, hash, itemCount: items.length };
  });
}
