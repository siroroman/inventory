import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { createdColumns, id } from './common.ts';
import { items } from './items.ts';
import { locations } from './locations.ts';

// One inventory run: a physical check of a location and its whole subtree. Runs are never archived
// or deleted (they end as `finished` or `cancelled`), so there is no archived_at. Started =
// created_at / created_by. updated_at and version are maintained by the touch_row trigger; checks
// happen on `inventory_items` and do not bump the run's version.
export const inventories = pgTable(
  'inventories',
  {
    id: id(),
    // The run's root; its subtree is what the run covers.
    locationId: uuid()
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    status: text().notNull().default('in_progress'),
    endedAt: timestamp({ withTimezone: true }),
    endedBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
    note: text(),
    committee: text(),
    ...createdColumns(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
    version: integer().notNull().default(1),
  },
  (t) => [
    // Also serves the location's history: newest first.
    index('inventories_location_id_created_at_idx').on(t.locationId, t.createdAt, t.id),
    // The overlap guard looks only at runs in progress.
    index('inventories_in_progress_location_id_idx').on(t.locationId).where(sql`${t.status} = 'in_progress'`),
    // The two lists of the Inventura tab: in progress by start, ended by end.
    index('inventories_status_created_at_idx').on(t.status, t.createdAt, t.id),
    index('inventories_status_ended_at_idx').on(t.status, t.endedAt, t.id),
    check('inventories_status_valid', sql`${t.status} in ('in_progress', 'finished', 'cancelled')`),
    check(
      'inventories_ended_when_closed',
      sql`(${t.status} = 'in_progress') = (${t.endedAt} is null) and (${t.status} = 'in_progress') = (${t.endedBy} is null)`,
    ),
  ],
);

// One row per item per run: the snapshot taken at the start (`expected`) plus the items found or
// added during the run. Never deleted: an unticked `elsewhere` or `new` row stays with checked_at
// null and is hidden. No version or updated_at; checks are conditional updates.
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: id(),
    inventoryId: uuid()
      .notNull()
      .references(() => inventories.id, { onDelete: 'restrict' }),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    // Where the row belongs in the run: the item's location at the start, or the context location
    // for a found or new item; a move changes it.
    locationId: uuid()
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    // Where a found-elsewhere item was registered (null = no location).
    registeredLocationId: uuid().references(() => locations.id, { onDelete: 'restrict' }),
    checkedAt: timestamp({ withTimezone: true }),
    checkedBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
    method: text(),
    wasMissing: boolean().notNull().default(false),
    movedAt: timestamp({ withTimezone: true }),
    movedBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
    // Set at the finish for unchecked `expected` rows only.
    outcome: text(),
  },
  (t) => [
    unique('inventory_items_inventory_id_item_id_key').on(t.inventoryId, t.itemId),
    index('inventory_items_item_id_idx').on(t.itemId),
    index('inventory_items_location_id_idx').on(t.locationId),
    index('inventory_items_registered_location_id_idx').on(t.registeredLocationId),
    check('inventory_items_kind_valid', sql`${t.kind} in ('expected', 'elsewhere', 'new')`),
    check('inventory_items_method_valid', sql`${t.method} in ('scan', 'manual')`),
    check('inventory_items_outcome_valid', sql`${t.outcome} in ('missing', 'skipped')`),
    // Who, when and how are recorded together or not at all.
    check(
      'inventory_items_checked_together',
      sql`(${t.checkedAt} is null) = (${t.checkedBy} is null) and (${t.checkedAt} is null) = (${t.method} is null)`,
    ),
    check(
      'inventory_items_outcome_unchecked_expected',
      sql`${t.outcome} is null or (${t.kind} = 'expected' and ${t.checkedAt} is null)`,
    ),
  ],
);
