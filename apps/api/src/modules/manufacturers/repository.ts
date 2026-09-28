import { and, asc, count, eq, getTableColumns, isNull, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { afterName, type Page, toPage } from '../../db/pagination.ts';
import { manufacturers, manufacturerServiceProviders, serviceProviders } from '../../db/schema/index.ts';
import { containsText } from '../../db/search.ts';
import { setArchived, updateVersioned } from '../../db/versioned.ts';

export type Manufacturer = typeof manufacturers.$inferSelect;
export type RankedProvider = typeof serviceProviders.$inferSelect & { priority: number };

type ManufacturerFields = Pick<typeof manufacturers.$inferInsert, 'name' | 'note'>;
export type NewManufacturer = ManufacturerFields & { createdBy: string };
export type ManufacturerPatch = Partial<ManufacturerFields> & { updatedBy: string };
export type ManufacturerFilter = { q?: string };

function listWhere(filter: ManufacturerFilter): SQL[] {
  const conditions: SQL[] = [isNull(manufacturers.archivedAt)];
  if (filter.q) conditions.push(containsText(manufacturers.name, filter.q));
  return conditions;
}

export function createManufacturerRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<Manufacturer | undefined> {
      const [row] = await db.select().from(manufacturers).where(eq(manufacturers.id, id));
      return row;
    },

    /**
     * Exact name match ignoring case, archived included (the same rule as the unique index), so a
     * name typed into a form can reuse or restore an existing manufacturer instead of failing.
     */
    async findByName(name: string): Promise<Manufacturer | undefined> {
      const [row] = await db
        .select()
        .from(manufacturers)
        .where(sql`lower(${manufacturers.name}) = lower(${name})`);
      return row;
    },

    async list(filter: ManufacturerFilter, page: { limit: number; cursor?: string }): Promise<Page<Manufacturer>> {
      const rows = await db
        .select()
        .from(manufacturers)
        .where(and(...listWhere(filter), afterName(manufacturers.name, manufacturers.id, page.cursor)))
        .orderBy(asc(manufacturers.name), asc(manufacturers.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ name: r.name, id: r.id }));
    },

    async count(filter: ManufacturerFilter): Promise<number> {
      const [row] = await db.select({ n: count() }).from(manufacturers).where(and(...listWhere(filter)));
      return row!.n;
    },

    async insert(values: NewManufacturer): Promise<Manufacturer> {
      const [row] = await db
        .insert(manufacturers)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    update(id: string, version: number, patch: ManufacturerPatch): Promise<Manufacturer | undefined> {
      return updateVersioned(db, manufacturers, id, version, patch);
    },

    setArchived(id: string, version: number, archived: boolean, by: string): Promise<Manufacturer | undefined> {
      return setArchived(db, manufacturers, id, version, archived, by);
    },

    /** Service providers in the order to contact them (priority 1 first), archived ones included. */
    listProviders(manufacturerId: string): Promise<RankedProvider[]> {
      return db
        .select({ ...getTableColumns(serviceProviders), priority: manufacturerServiceProviders.priority })
        .from(manufacturerServiceProviders)
        .innerJoin(serviceProviders, eq(serviceProviders.id, manufacturerServiceProviders.serviceProviderId))
        .where(eq(manufacturerServiceProviders.manufacturerId, manufacturerId))
        .orderBy(asc(manufacturerServiceProviders.priority));
    },

    /**
     * Replaces the whole provider order: the first id gets priority 1. Run it in the service's
     * transaction; the deferred (manufacturer, priority) constraint is checked at commit.
     */
    async replaceProviders(manufacturerId: string, providerIds: string[], by: string): Promise<void> {
      await db
        .delete(manufacturerServiceProviders)
        .where(eq(manufacturerServiceProviders.manufacturerId, manufacturerId));
      if (providerIds.length === 0) return;
      await db.insert(manufacturerServiceProviders).values(
        providerIds.map((serviceProviderId, index) => ({
          manufacturerId,
          serviceProviderId,
          priority: index + 1,
          createdBy: by,
        })),
      );
    },
  };
}

export type ManufacturerRepository = ReturnType<typeof createManufacturerRepository>;
