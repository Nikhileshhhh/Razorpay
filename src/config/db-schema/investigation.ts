import { pgTable, text, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';

/** Investigation table (backend PRD §8 "Investigation", §11). */
export const investigations = pgTable(
  'investigations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    evidenceSetHash: text('evidence_set_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    modelConfigHash: text('model_config_hash').notNull(),
    modelId: text('model_id').notNull(),
    gatewayMode: text('gateway_mode').notNull(),
    output: jsonb('output'),
    failureClass: text('failure_class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('investigations_uq').on(t.caseId, t.evidenceSetHash, t.promptVersion, t.modelConfigHash),
  ],
);
