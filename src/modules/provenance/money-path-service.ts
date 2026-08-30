import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import {
  cases,
  economicSubjects,
  entityCurrent,
  entityLinks,
  entityLinkReviews,
  entityRevisions,
  evidenceSetItems,
  evidenceSets,
} from '../../config/db-schema.js';
import { MoneyPath, type NodeType } from '../../contracts/cases.js';
import type { TenantContext } from '../identity/tenant-context.js';

const MAX_DEPTH = 6;
const MAX_NODES = 100;
const MAX_LINKS_LOADED = 500;
const MAX_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

export class MoneyPathLimitError extends Error {
  constructor() {
    super('money path traversal limit exceeded');
    this.name = 'MoneyPathLimitError';
  }
}

export async function buildMoneyPath(
  db: Database,
  ctx: TenantContext,
  caseId: string,
  includeCandidates: boolean,
) {
  const caseRows = await db
    .select({ caseRow: cases, subjectKey: economicSubjects.subjectKey })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, caseId)))
    .limit(1);
  const found = caseRows[0];
  if (!found) return null;

  const loaded = await db
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.tenantId, ctx.tenantId),
        gte(entityLinks.createdAt, new Date(found.caseRow.openedAt.getTime() - MAX_LOOKBACK_MS)),
        lte(entityLinks.createdAt, new Date(found.caseRow.openedAt.getTime() + MAX_LOOKBACK_MS)),
      ),
    )
    .limit(MAX_LINKS_LOADED + 1);
  if (loaded.length > MAX_LINKS_LOADED) throw new MoneyPathLimitError();
  const reviews = loaded.length
    ? await db
        .select()
        .from(entityLinkReviews)
        .where(
          and(
            eq(entityLinkReviews.tenantId, ctx.tenantId),
            inArray(
              entityLinkReviews.linkId,
              loaded.map((link) => link.id),
            ),
          ),
        )
    : [];
  const latestReview = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    const prior = latestReview.get(review.linkId);
    if (!prior || review.reviewVersion > prior.reviewVersion)
      latestReview.set(review.linkId, review);
  }
  const visible = loaded
    .map((link) => {
      const review = latestReview.get(link.id);
      return {
        ...link,
        confidenceClass:
          review?.decision === 'confirmed'
            ? 'asserted'
            : review?.decision === 'rejected'
              ? 'rejected'
              : link.confidenceClass,
      };
    })
    .filter(
      (link) =>
        link.confidenceClass !== 'rejected' &&
        (includeCandidates || link.confidenceClass !== 'candidate'),
    );
  const chosen: typeof visible = [];
  const seenEdges = new Set<string>();
  const seenNodes = new Set<string>([found.subjectKey]);
  let frontier = [found.subjectKey];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const link of visible) {
        if (seenEdges.has(link.id)) continue;
        if (link.sourceNodeKey !== node && link.targetNodeKey !== node) continue;
        seenEdges.add(link.id);
        chosen.push(link);
        const other = link.sourceNodeKey === node ? link.targetNodeKey : link.sourceNodeKey;
        if (!seenNodes.has(other)) {
          seenNodes.add(other);
          next.push(other);
          if (seenNodes.size > MAX_NODES) throw new MoneyPathLimitError();
        }
      }
    }
    frontier = next;
  }

  const hashes = [...new Set(chosen.map((link) => link.evidenceSetHash))];
  const sets = hashes.length
    ? await db
        .select({ id: evidenceSets.id, hash: evidenceSets.evidenceSetHash })
        .from(evidenceSets)
        .where(
          and(
            eq(evidenceSets.tenantId, ctx.tenantId),
            inArray(evidenceSets.evidenceSetHash, hashes),
          ),
        )
    : [];
  const setIds = sets.map((set) => set.id);
  const items = setIds.length
    ? await db
        .select({ setId: evidenceSetItems.evidenceSetId, evidenceId: evidenceSetItems.evidenceId })
        .from(evidenceSetItems)
        .where(
          and(
            eq(evidenceSetItems.tenantId, ctx.tenantId),
            inArray(evidenceSetItems.evidenceSetId, setIds),
          ),
        )
    : [];
  const setIdByHash = new Map(sets.map((set) => [set.hash, set.id]));
  const evidenceBySet = new Map<string, string[]>();
  for (const item of items) {
    const list = evidenceBySet.get(item.setId) ?? [];
    list.push(item.evidenceId);
    evidenceBySet.set(item.setId, list);
  }

  const keys = [...seenNodes];
  const revisions = keys.length
    ? await db
        .select({ current: entityCurrent, revision: entityRevisions })
        .from(entityCurrent)
        .innerJoin(
          entityRevisions,
          and(
            eq(entityRevisions.tenantId, entityCurrent.tenantId),
            eq(entityRevisions.id, entityCurrent.currentRevisionId),
          ),
        )
        .where(
          and(eq(entityCurrent.tenantId, ctx.tenantId), inArray(entityCurrent.entityKey, keys)),
        )
    : [];
  const revisionByKey = new Map(revisions.map((row) => [row.current.entityKey, row.revision]));
  const evidenceCountByNode = new Map<string, number>();
  for (const link of chosen) {
    const count = evidenceBySet.get(setIdByHash.get(link.evidenceSetHash) ?? '')?.length ?? 0;
    evidenceCountByNode.set(
      link.sourceNodeKey,
      (evidenceCountByNode.get(link.sourceNodeKey) ?? 0) + count,
    );
    evidenceCountByNode.set(
      link.targetNodeKey,
      (evidenceCountByNode.get(link.targetNodeKey) ?? 0) + count,
    );
  }

  const result = {
    schema_version: '1.0',
    case_id: caseId,
    nodes: keys.map((key) => {
      const revision = revisionByKey.get(key);
      return {
        node_key: key,
        node_type: nodeType(key),
        status: revision?.businessState ?? 'expected_subject',
        amount:
          revision?.amountMinor != null && revision.currency === 'INR'
            ? { amount_minor: revision.amountMinor.toString(), currency: 'INR' as const }
            : null,
        event_time: revision?.eventTime.toISOString() ?? null,
        source_system: revision?.sourceSystem ?? null,
        evidence_count: evidenceCountByNode.get(key) ?? 0,
      };
    }),
    edges: chosen.map((link) => {
      const setId = setIdByHash.get(link.evidenceSetHash) ?? '';
      return {
        link_id: link.id,
        edge_type: link.edgeType,
        source_node_key: link.sourceNodeKey,
        target_node_key: link.targetNodeKey,
        confidence_class: link.confidenceClass,
        observation: link.observation,
        amount: null,
        evidence_ids: (evidenceBySet.get(setId) ?? []).sort(),
      };
    }),
    linear: chosen.map(
      (link) => `${link.sourceNodeKey} --${link.edgeType}--> ${link.targetNodeKey}`,
    ),
  };
  return MoneyPath.parse(result);
}

function nodeType(key: string): NodeType {
  const prefix = key.split(':', 1)[0];
  switch (prefix) {
    case 'order':
      return 'order';
    case 'payment':
      return 'payment';
    case 'refund':
      return 'refund';
    case 'transfer':
      return 'transfer';
    case 'settlement':
      return 'settlement';
    case 'bank_credit':
      return 'bank_credit';
    case 'receivable':
      return 'seller_receivable';
    case 'recovery':
      return 'recovery_action';
    case 'case':
      return 'financial_case';
    default:
      return 'commercial_intent';
  }
}
