import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client.ts';
import {
  items,
  locations,
  locationTypes,
  manufacturers,
  serviceProviders,
  user,
} from '../../src/db/schema/index.ts';

// Real inserts with minimal valid data; override only what a test cares about.

export async function insertUser(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
  const [row] = await db
    .insert(user)
    .values({ name: 'Jana Nováková', email: `user-${randomUUID()}@example.com`, ...overrides })
    .returning();
  return row!;
}

export async function locationTypeId(db: Db, code = 'HQ'): Promise<string> {
  const [row] = await db.select({ id: locationTypes.id }).from(locationTypes).where(eq(locationTypes.code, code));
  if (!row) throw new Error(`location type ${code} not seeded`);
  return row.id;
}

export async function insertLocation(
  db: Db,
  overrides: Partial<typeof locations.$inferInsert> = {},
) {
  const isTopLevel = !overrides.parentId;
  const [row] = await db
    .insert(locations)
    .values({
      name: 'Centrála Praha',
      locationTypeId: isTopLevel ? await locationTypeId(db) : null,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function insertManufacturer(
  db: Db,
  overrides: Partial<typeof manufacturers.$inferInsert> = {},
) {
  const [row] = await db
    .insert(manufacturers)
    .values({ name: `Výrobce ${randomUUID().slice(0, 8)}`, ...overrides })
    .returning();
  return row!;
}

export async function insertProvider(
  db: Db,
  overrides: Partial<typeof serviceProviders.$inferInsert> = {},
) {
  const [row] = await db
    .insert(serviceProviders)
    .values({ name: 'Servis Novák s.r.o.', ...overrides })
    .returning();
  return row!;
}

export async function insertItem(db: Db, overrides: Partial<typeof items.$inferInsert> = {}) {
  const locationId = overrides.locationId ?? (await insertLocation(db)).id;
  const [row] = await db
    .insert(items)
    .values({ name: 'Konvektomat', ...overrides, locationId })
    .returning();
  return row!;
}
