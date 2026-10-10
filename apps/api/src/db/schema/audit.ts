import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';

// Append-only: a trigger rejects UPDATE/DELETE and app_runtime has only SELECT/INSERT.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userId: uuid().references(() => user.id, { onDelete: 'restrict' }),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    action: text().notNull(),
    changes: jsonb().notNull().default({}),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.occurredAt.desc()),
    check(
      'audit_log_action_valid',
      // The last six are the actions of an inventory run (SPEC §9.3 rule 16).
      sql`${t.action} in ('create', 'update', 'archive', 'restore', 'delete', 'start', 'check', 'uncheck', 'finish', 'cancel', 'reopen', 'mark_missing', 'unmark_missing')`,
    ),
  ],
);
