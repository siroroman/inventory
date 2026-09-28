import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgSequence,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { manufacturers } from './catalog.ts';
import { auditColumns, createdColumns, id } from './common.ts';
import { locations } from './locations.ts';

export const itemCodeSeq = pgSequence('item_code_seq');

export const items = pgTable(
  'items',
  {
    id: id(),
    code: text()
      .notNull()
      .default(sql`format_code('INV', nextval('item_code_seq'), 5)`),
    name: text().notNull(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    manufacturerId: uuid().references(() => manufacturers.id, { onDelete: 'restrict' }),
    model: text(),
    serialNumber: text(),
    manufactureYear: smallint(),
    registeredOn: date({ mode: 'string' }),
    warrantyUntil: date({ mode: 'string' }),
    lastServiceOn: date({ mode: 'string' }),
    nextServiceOn: date({ mode: 'string' }),
    documentsUrl: text(),
    note: text(),
    ...auditColumns(),
  },
  (t) => [
    unique('items_code_key').on(t.code),
    index('items_location_id_idx').on(t.locationId),
    index('items_manufacturer_id_idx').on(t.manufacturerId),
    check('items_name_not_blank', sql`btrim(${t.name}) <> ''`),
    // "Not after the current year" is checked in Zod; a CHECK must be immutable.
    check('items_manufacture_year_range', sql`${t.manufactureYear} between 1950 and 2100`),
    check(
      'items_documents_url_google',
      sql`${t.documentsUrl} ~ '^https://(drive|docs)\\.google\\.com/'`,
    ),
  ],
);

export const itemExternalIds = pgTable(
  'item_external_ids',
  {
    id: id(),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    source: text().notNull(),
    value: text().notNull(),
    ...createdColumns(),
  },
  (t) => [
    unique('item_external_ids_item_source_value_key').on(t.itemId, t.source, t.value),
    check('item_external_ids_source_not_blank', sql`btrim(${t.source}) <> ''`),
    check('item_external_ids_value_not_blank', sql`btrim(${t.value}) <> ''`),
  ],
);

export const itemPhotos = pgTable(
  'item_photos',
  {
    id: id(),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    sortOrder: integer().notNull().default(0),
    ...createdColumns(),
  },
  (t) => [
    unique('item_photos_storage_key_key').on(t.storageKey),
    index('item_photos_item_id_sort_order_idx').on(t.itemId, t.sortOrder),
    check(
      'item_photos_content_type_image',
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check('item_photos_dimensions_positive', sql`${t.width} > 0 and ${t.height} > 0`),
  ],
);
