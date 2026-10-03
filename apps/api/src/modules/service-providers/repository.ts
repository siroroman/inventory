import { and, asc, count, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { afterName, type Page, toPage } from '../../db/pagination.ts';
import { manufacturers, manufacturerServiceProviders, serviceProviders } from '../../db/schema/index.ts';
import { containsText } from '../../db/search.ts';
import { setArchived, updateVersioned } from '../../db/versioned.ts';

export type ServiceProvider = typeof serviceProviders.$inferSelect;
export type ServicedBrand = { id: string; name: string; archivedAt: Date | null; priority: number };

type ServiceProviderFields = Pick<
  typeof serviceProviders.$inferInsert,
  'name' | 'contactPerson' | 'phone' | 'email' | 'web' | 'note'
>;
/** `code` is optional: the database assigns the next SUP-nnn unless an existing number is imported. */
export type NewServiceProvider = ServiceProviderFields & { code?: string; createdBy: string };
export type ServiceProviderPatch = Partial<ServiceProviderFields> & { updatedBy: string };
/** `archived` lists the archived providers instead of the active ones. */
export type ServiceProviderFilter = { q?: string; archived?: boolean };

// Tens of providers: the search needs no trigram index. A number is found with or without the
// spaces it is written with ("+420 601 123 456" and "+420601"); a brand name finds the providers
// that service it, archived brands included.
function listWhere(db: DbExecutor, filter: ServiceProviderFilter): SQL[] {
  const conditions: SQL[] = [filter.archived ? isNotNull(serviceProviders.archivedAt) : isNull(serviceProviders.archivedAt)];
  if (filter.q) {
    const digits = filter.q.replace(/\s+/g, '');
    conditions.push(
      or(
        containsText(serviceProviders.name, filter.q),
        containsText(serviceProviders.code, filter.q),
        containsText(sql`regexp_replace(${serviceProviders.phone}, '[\\s\\u00a0]', '', 'g')`, digits),
        inArray(
          serviceProviders.id,
          db
            .select({ id: manufacturerServiceProviders.serviceProviderId })
            .from(manufacturerServiceProviders)
            .innerJoin(manufacturers, eq(manufacturers.id, manufacturerServiceProviders.manufacturerId))
            .where(containsText(manufacturers.name, filter.q)),
        ),
      )!,
    );
  }
  return conditions;
}

export function createServiceProviderRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<ServiceProvider | undefined> {
      const [row] = await db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
      return row;
    },

    async list(
      filter: ServiceProviderFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<ServiceProvider>> {
      const rows = await db
        .select()
        .from(serviceProviders)
        .where(and(...listWhere(db, filter), afterName(serviceProviders.name, serviceProviders.id, page.cursor)))
        .orderBy(asc(serviceProviders.name), asc(serviceProviders.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ name: r.name, id: r.id }));
    },

    async count(filter: ServiceProviderFilter): Promise<number> {
      const [row] = await db.select({ n: count() }).from(serviceProviders).where(and(...listWhere(db, filter)));
      return row!.n;
    },

    async insert(values: NewServiceProvider): Promise<ServiceProvider> {
      const [row] = await db
        .insert(serviceProviders)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    update(id: string, version: number, patch: ServiceProviderPatch): Promise<ServiceProvider | undefined> {
      return updateVersioned(db, serviceProviders, id, version, patch);
    },

    setArchived(id: string, version: number, archived: boolean, by: string): Promise<ServiceProvider | undefined> {
      return setArchived(db, serviceProviders, id, version, archived, by);
    },

    /** Brands this provider services, each with this provider's priority for that brand. */
    listManufacturers(providerId: string): Promise<ServicedBrand[]> {
      return db
        .select({
          id: manufacturers.id,
          name: manufacturers.name,
          archivedAt: manufacturers.archivedAt,
          priority: manufacturerServiceProviders.priority,
        })
        .from(manufacturerServiceProviders)
        .innerJoin(manufacturers, eq(manufacturers.id, manufacturerServiceProviders.manufacturerId))
        .where(eq(manufacturerServiceProviders.serviceProviderId, providerId))
        .orderBy(asc(manufacturers.name));
    },

    /** The same for several providers at once, one entry per id (an empty list for a provider without brands). */
    async listManufacturersOf(providerIds: string[]): Promise<Map<string, ServicedBrand[]>> {
      const brands = new Map<string, ServicedBrand[]>(providerIds.map((id) => [id, []]));
      if (providerIds.length === 0) return brands;
      const rows = await db
        .select({
          providerId: manufacturerServiceProviders.serviceProviderId,
          id: manufacturers.id,
          name: manufacturers.name,
          archivedAt: manufacturers.archivedAt,
          priority: manufacturerServiceProviders.priority,
        })
        .from(manufacturerServiceProviders)
        .innerJoin(manufacturers, eq(manufacturers.id, manufacturerServiceProviders.manufacturerId))
        .where(inArray(manufacturerServiceProviders.serviceProviderId, providerIds))
        .orderBy(asc(manufacturers.name));
      for (const { providerId, ...brand } of rows) brands.get(providerId)?.push(brand);
      return brands;
    },
  };
}

export type ServiceProviderRepository = ReturnType<typeof createServiceProviderRepository>;
