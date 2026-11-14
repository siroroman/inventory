import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, createdColumns, id } from './common.ts';

export const locationTypes = pgTable(
  'location_types',
  {
    id: id(),
    code: text().notNull(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    /** Whether locations of this type are divided into sub-locations; the SPA hides them otherwise. */
    allowsSubLocations: boolean().notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    unique('location_types_code_key').on(t.code),
    unique('location_types_name_key').on(t.name),
    check('location_types_code_not_blank', sql`btrim(${t.code}) <> ''`),
    check('location_types_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

export const locationCodeSeq = pgSequence('location_code_seq');

export const locations = pgTable(
  'locations',
  {
    id: id(),
    code: text()
      .notNull()
      .default(sql`format_code('LOC', nextval('location_code_seq'), 3)`),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => locations.id, { onDelete: 'restrict' }),
    locationTypeId: uuid().references(() => locationTypes.id, { onDelete: 'restrict' }),
    address: text(),
    note: text(),
    ...auditColumns(),
  },
  (t) => [
    unique('locations_code_key').on(t.code),
    index('locations_parent_id_idx').on(t.parentId),
    index('locations_location_type_id_idx').on(t.locationTypeId),
    check('locations_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check('locations_not_own_parent', sql`${t.parentId} <> ${t.id}`),
    check(
      'locations_type_only_top_level',
      sql`(${t.parentId} is null) = (${t.locationTypeId} is not null)`,
    ),
  ],
);

/**
 * People and numbers to reach for a location (the owner, the manager, the store's phone). The form
 * saves the whole list at once, so rows are replaced, never edited; `sort_order` keeps the order entered.
 */
export const locationContacts = pgTable(
  'location_contacts',
  {
    id: id(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    sortOrder: integer().notNull(),
    role: text().notNull(),
    name: text(),
    phone: text(),
    email: text(),
    ...createdColumns(),
  },
  (t) => [
    // Also the index on the foreign key: location_id leads.
    unique('location_contacts_location_id_sort_order_key').on(t.locationId, t.sortOrder),
    check('location_contacts_role_not_blank', sql`btrim(${t.role}) <> ''`),
    // A contact nobody can call or write to is no contact.
    check(
      'location_contacts_phone_or_email',
      sql`coalesce(btrim(${t.phone}), '') <> '' OR coalesce(btrim(${t.email}), '') <> ''`,
    ),
  ],
);
