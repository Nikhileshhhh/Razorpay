import { pgTable, text, timestamp, unique, index } from 'drizzle-orm/pg-core';

/**
 * Identity tables (backend PRD §8 "Identity", §6). Mirrors
 * `db/migrations/0001_init.sql` for typed query building; the SQL migration
 * remains the source of truth for constraints/triggers.
 */
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  environment: text('environment').notNull(),
  currencyDefault: text('currency_default').notNull().default('INR'),
  dataRetentionPolicy: text('data_retention_policy').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_tenant_idx').on(t.tenantId)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('memberships_tenant_user_role_uq').on(t.tenantId, t.userId, t.role),
    index('memberships_tenant_user_idx').on(t.tenantId, t.userId),
  ],
);
