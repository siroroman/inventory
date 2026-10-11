import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { manufacturers } from './catalog.ts';
import { auditColumns, createdColumns, id } from './common.ts';
import { user } from './auth.ts';
import { locations } from './locations.ts';

export const itemCodeSeq = pgSequence('item_code_seq');

export const items = pgTable(
  'items',
  {
    id: id(),
    code: text()
      .notNull()
      .default(sql`format_code('INV', nextval('item_code_seq'), 4)`),
    name: text().notNull(),
    // Optional: an item can exist before anyone knows where it is.
    locationId: uuid().references(() => locations.id, { onDelete: 'restrict' }),
    manufacturerId: uuid().references(() => manufacturers.id, { onDelete: 'restrict' }),
    model: text(),
    serialNumber: text(),
    manufactureYear: smallint(),
    registeredOn: date({ mode: 'string' }),
    /** CZK, two decimals. */
    purchasePrice: numeric({ precision: 12, scale: 2, mode: 'number' }),
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
    check('items_purchase_price_not_negative', sql`${t.purchasePrice} >= 0`),
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
    // One supplier's ID identifies one item, across all items (archived too) and ignoring case.
    uniqueIndex('item_external_ids_source_value_key').on(sql`lower(${t.source})`, sql`lower(${t.value})`),
    index('item_external_ids_item_id_idx').on(t.itemId),
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

export const serviceRecords = pgTable(
  'service_records',
  {
    id: id(),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    performedOn: date({ mode: 'string' }).notNull(),
    title: text().notNull(),
    performedBy: text(),
    responsiblePerson: text(),
    description: text(),
    ...auditColumns(),
  },
  (t) => [
    // Also serves the item's history: newest first, id as the tie-break for the cursor.
    index('service_records_item_id_performed_on_idx').on(t.itemId, t.performedOn, t.id),
    check('service_records_title_not_blank', sql`btrim(${t.title}) <> ''`),
  ],
);

// A file attached to a service record, stored in the bucket under `storage_key`. Documents are
// deleted for real (the row and the file), so there is no archived_at; renaming is versioned.
export const serviceRecordDocuments = pgTable(
  'service_record_documents',
  {
    id: id(),
    serviceRecordId: uuid().notNull(),
    name: text().notNull(),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    ...createdColumns(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid().references(() => user.id, { onDelete: 'restrict' }),
    version: integer().notNull().default(1),
  },
  (t) => [
    // Named explicitly: the generated name is longer than the 63 characters Postgres keeps.
    foreignKey({
      name: 'service_record_documents_record_id_fk',
      columns: [t.serviceRecordId],
      foreignColumns: [serviceRecords.id],
    }).onDelete('restrict'),
    unique('service_record_documents_storage_key_key').on(t.storageKey),
    index('service_record_documents_record_id_created_at_idx').on(t.serviceRecordId, t.createdAt, t.id),
    check('service_record_documents_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check(
      'service_record_documents_content_type_allowed',
      sql`${t.contentType} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`,
    ),
    check('service_record_documents_size_range', sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 20971520`),
  ],
);
