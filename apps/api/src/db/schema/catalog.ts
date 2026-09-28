import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, createdColumns, id } from './common.ts';

export const manufacturers = pgTable(
  'manufacturers',
  {
    id: id(),
    name: text().notNull(),
    note: text(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('manufacturers_name_lower_key').on(sql`lower(${t.name})`),
    check('manufacturers_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

export const serviceProviderCodeSeq = pgSequence('service_provider_code_seq');

export const serviceProviders = pgTable(
  'service_providers',
  {
    id: id(),
    code: text()
      .notNull()
      .default(sql`format_code('SUP', nextval('service_provider_code_seq'), 3)`),
    name: text().notNull(),
    contactPerson: text(),
    phone: text(),
    email: text(),
    web: text(),
    note: text(),
    ...auditColumns(),
  },
  (t) => [
    unique('service_providers_code_key').on(t.code),
    check('service_providers_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

// UNIQUE (manufacturer_id, priority) is DEFERRABLE and lives in a custom migration (0002_db_rules).
export const manufacturerServiceProviders = pgTable(
  'manufacturer_service_providers',
  {
    manufacturerId: uuid()
      .notNull()
      .references(() => manufacturers.id, { onDelete: 'restrict' }),
    serviceProviderId: uuid()
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'restrict' }),
    priority: smallint().notNull(),
    ...createdColumns(),
  },
  (t) => [
    primaryKey({
      name: 'manufacturer_service_providers_pkey',
      columns: [t.manufacturerId, t.serviceProviderId],
    }),
    index('manufacturer_service_providers_service_provider_id_idx').on(t.serviceProviderId),
    check('manufacturer_service_providers_priority_positive', sql`${t.priority} >= 1`),
  ],
);
