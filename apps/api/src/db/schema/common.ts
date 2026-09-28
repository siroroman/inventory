import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';

export const id = () => uuid().primaryKey().defaultRandom();

export const createdColumns = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
});

// updated_at and version are maintained by the touch_row trigger; repositories must not set them.
export const auditColumns = () => ({
  ...createdColumns(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
  archivedAt: timestamp({ withTimezone: true }),
  version: integer().notNull().default(1),
});
