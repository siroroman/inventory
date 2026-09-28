import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id } from './common.ts';

export const locationTypes = pgTable(
  'location_types',
  {
    id: id(),
    code: text().notNull(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
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
