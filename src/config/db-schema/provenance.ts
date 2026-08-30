import { pgTable, text, timestamp, integer, numeric, unique, index } from 'drizzle-orm/pg-core';

/** Provenance tables (backend PRD §8 "Provenance", §10.3). */
export const entityLinks = pgTable(
  'entity_links',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    edgeType: text('edge_type').notNull(),
    sourceNodeKey: text('source_node_key').notNull(),
    targetNodeKey: text('target_node_key').notNull(),
    confidenceClass: text('confidence_class').notNull(),
    score: numeric('score'),
    resolverVersion: text('resolver_version').notNull(),
    evidenceSetHash: text('evidence_set_hash').notNull(),
    reviewStatus: text('review_status').notNull().default('unreviewed'),
    observation: text('observation').notNull().default('observed'),
    version: integer('version').notNull().default(0),
    reviewerId: text('reviewer_id'),
    reviewReason: text('review_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('entity_links_uq').on(
      t.tenantId,
      t.resolverVersion,
      t.sourceNodeKey,
      t.targetNodeKey,
      t.edgeType,
    ),
    index('entity_links_source_idx').on(t.tenantId, t.sourceNodeKey, t.edgeType),
    index('entity_links_target_idx').on(t.tenantId, t.targetNodeKey),
  ],
);

export const evidenceSets = pgTable(
  'evidence_sets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    evidenceSetHash: text('evidence_set_hash').notNull(),
    itemCount: integer('item_count').notNull().default(0),
    sealedAt: timestamp('sealed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('evidence_sets_uq').on(t.tenantId, t.evidenceSetHash)],
);

export const evidenceSetItems = pgTable(
  'evidence_set_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    evidenceSetId: text('evidence_set_id').notNull(),
    evidenceId: text('evidence_id').notNull(),
    itemRole: text('item_role').notNull().default('supporting'),
    ordinal: integer('ordinal').notNull(),
  },
  (t) => [
    unique('evidence_set_items_evidence_uq').on(t.evidenceSetId, t.evidenceId),
    unique('evidence_set_items_ordinal_uq').on(t.evidenceSetId, t.ordinal),
  ],
);

export const entityLinkReviews = pgTable(
  'entity_link_reviews',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    linkId: text('link_id').notNull(),
    reviewVersion: integer('review_version').notNull(),
    decision: text('decision').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('entity_link_reviews_uq').on(t.tenantId, t.linkId, t.reviewVersion),
    index('entity_link_reviews_latest_idx').on(t.tenantId, t.linkId, t.reviewVersion),
  ],
);
