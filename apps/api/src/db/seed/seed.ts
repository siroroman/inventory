import { hashPassword } from 'better-auth/crypto';
import { count } from 'drizzle-orm';
import { createItemRepository } from '../../modules/items/repository.ts';
import {
  createLocationRepository,
  createLocationTypeRepository,
} from '../../modules/locations/repository.ts';
import { createManufacturerRepository } from '../../modules/manufacturers/repository.ts';
import { createServiceProviderRepository } from '../../modules/service-providers/repository.ts';
import { createServiceRecordRepository } from '../../modules/service-records/repository.ts';
import type { Db, DbExecutor } from '../client.ts';
import { account, items, locations, user } from '../schema/index.ts';
import {
  type SeedLocation,
  seedItems,
  seedLocations,
  seedManufacturers,
  seedProviders,
  seedServiceRecords,
  seedUsers,
} from './data.ts';

/** The database already has data; the seed never mixes into or overwrites it. */
export class SeedRefusedError extends Error {
  constructor() {
    super('The database already contains locations, items or users; the seed only fills an empty one.');
    this.name = 'SeedRefusedError';
  }
}

export type SeedOptions = {
  /** Password for every seeded user (dev only). */
  password: string;
  /** ISO date that the day offsets in the data are counted from. */
  today: string;
};

export type SeedSummary = {
  users: number;
  locations: number;
  manufacturers: number;
  serviceProviders: number;
  items: number;
  externalIds: number;
  serviceRecords: number;
};

function addDays(isoDate: string, days: number | undefined): string | null {
  if (days === undefined) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** No locations, items or users yet: the seed and the import only fill such a database. */
export async function isEmpty(db: DbExecutor): Promise<boolean> {
  for (const table of [locations, items, user]) {
    const [row] = await db.select({ n: count() }).from(table);
    if (row!.n > 0) return false;
  }
  return true;
}

/** The admin@, write@ and read@example.test users with a password account; returns their ids, admin first. */
export async function insertSeedUsers(db: DbExecutor, passwordHash: string): Promise<string[]> {
  const userIds: string[] = [];
  for (const u of seedUsers) {
    const [row] = await db.insert(user).values({ ...u, emailVerified: true }).returning({ id: user.id });
    await db.insert(account).values({
      userId: row!.id,
      accountId: row!.id,
      providerId: 'credential',
      password: passwordHash,
    });
    userIds.push(row!.id);
  }
  return userIds;
}

/** Fills an empty database with sample data, in one transaction. */
export async function seed(db: Db, options: SeedOptions): Promise<SeedSummary> {
  const passwordHash = await hashPassword(options.password);

  return db.transaction(async (tx) => {
    if (!(await isEmpty(tx))) throw new SeedRefusedError();

    // Users with a password account, so email + password sign-in works locally.
    const userIds = await insertSeedUsers(tx, passwordHash);
    const by = userIds[0]!;

    const typeIds = new Map((await createLocationTypeRepository(tx).list()).map((t) => [t.code, t.id]));
    const locationRepo = createLocationRepository(tx);
    const locationIds = new Map<string, string>();
    async function addLocation(l: SeedLocation, parentId: string | null): Promise<void> {
      const row = await locationRepo.insert({
        name: l.name,
        parentId,
        locationTypeId: l.type ? typeIds.get(l.type)! : null,
        address: l.address ?? null,
        note: l.note ?? null,
        createdBy: by,
      });
      locationIds.set(l.name, row.id);
      for (const child of l.children ?? []) await addLocation(child, row.id);
    }
    for (const l of seedLocations) await addLocation(l, null);

    const providerRepo = createServiceProviderRepository(tx);
    const providerIds = new Map<string, string>();
    for (const p of seedProviders) {
      providerIds.set(p.name, (await providerRepo.insert({ ...p, createdBy: by })).id);
    }

    const manufacturerRepo = createManufacturerRepository(tx);
    const manufacturerIds = new Map<string, string>();
    for (const m of seedManufacturers) {
      const row = await manufacturerRepo.insert({ name: m.name, note: m.note ?? null, createdBy: by });
      manufacturerIds.set(m.name, row.id);
      await manufacturerRepo.replaceProviders(row.id, m.providers.map((name) => providerIds.get(name)!), by);
    }

    const itemRepo = createItemRepository(tx);
    let externalIds = 0;
    const itemIds = new Map<string, string>();
    for (const i of seedItems) {
      const locationId = locationIds.get(i.location);
      if (!locationId) throw new Error(`seed item ${i.name}: unknown location ${i.location}`);
      const row = await itemRepo.insert({
        name: i.name,
        locationId,
        manufacturerId: i.manufacturer ? manufacturerIds.get(i.manufacturer)! : null,
        model: i.model ?? null,
        serialNumber: i.serialNumber ?? null,
        manufactureYear: i.manufactureYear ?? null,
        registeredOn: addDays(options.today, i.registered),
        purchasePrice: i.purchasePrice ?? null,
        warrantyUntil: addDays(options.today, i.warranty),
        lastServiceOn: addDays(options.today, i.lastService),
        nextServiceOn: addDays(options.today, i.nextService),
        documentsUrl: i.documentsUrl ?? null,
        note: i.note ?? null,
        createdBy: by,
      });
      itemIds.set(i.name, row.id);
      const ids = (i.externalIds ?? []).map(([source, value]) => ({ source, value }));
      externalIds += (await itemRepo.replaceExternalIds(row.id, ids, by)).length;
    }

    const recordRepo = createServiceRecordRepository(tx);
    for (const r of seedServiceRecords) {
      const itemId = itemIds.get(r.item);
      if (!itemId) throw new Error(`seed service record ${r.title}: unknown item ${r.item}`);
      await recordRepo.insert({
        itemId,
        performedOn: addDays(options.today, r.performed)!,
        title: r.title,
        performedBy: r.performedBy ?? null,
        responsiblePerson: r.responsiblePerson ?? null,
        description: r.description ?? null,
        createdBy: by,
      });
    }

    return {
      users: userIds.length,
      locations: locationIds.size,
      manufacturers: manufacturerIds.size,
      serviceProviders: providerIds.size,
      items: seedItems.length,
      externalIds,
      serviceRecords: seedServiceRecords.length,
    };
  });
}
