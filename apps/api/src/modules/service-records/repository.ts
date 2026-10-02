import { and, count, desc, eq, getTableColumns, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { beforeDate, type Page, toPage } from '../../db/pagination.ts';
import { items, locations, serviceRecords } from '../../db/schema/index.ts';
import { containsText } from '../../db/search.ts';
import { setArchived, updateVersioned } from '../../db/versioned.ts';
import { locationsMatching } from '../locations/repository.ts';

export type ServiceRecord = typeof serviceRecords.$inferSelect;

type ServiceRecordFields = Pick<
  typeof serviceRecords.$inferInsert,
  'performedOn' | 'title' | 'performedBy' | 'responsiblePerson' | 'description'
>;
export type NewServiceRecord = ServiceRecordFields & { itemId: string; createdBy: string };
export type ServiceRecordPatch = Partial<ServiceRecordFields> & { updatedBy: string };

type CodeRef = { id: string; code: string; name: string };
/** A record of the all-items list with the item it belongs to and that item's location (none yet: null). */
export type ServiceRecordListRow = ServiceRecord & { item: CodeRef; location: CodeRef | null };

/** `archived` lists the archived records instead of the active ones. */
export type ServiceRecordFilter = { q?: string; archived?: boolean };

/** Archived records look in archived locations too, as the item list does. */
function searchCondition(q: string, archived: boolean): SQL {
  return or(
    containsText(serviceRecords.title, q),
    containsText(items.name, q),
    containsText(items.code, q),
    sql`${items.locationId} IN (${locationsMatching(q, archived)})`,
  )!;
}

function listWhere(filter: ServiceRecordFilter): SQL[] {
  const conditions: SQL[] = [filter.archived ? isNotNull(serviceRecords.archivedAt) : isNull(serviceRecords.archivedAt)];
  if (filter.q) conditions.push(searchCondition(filter.q, Boolean(filter.archived)));
  return conditions;
}

const listColumns = {
  ...getTableColumns(serviceRecords),
  item: { id: items.id, code: items.code, name: items.name },
  location: { id: locations.id, code: locations.code, name: locations.name },
};

export function createServiceRecordRepository(db: DbExecutor) {
  const activeOf = (itemId: string) => and(eq(serviceRecords.itemId, itemId), isNull(serviceRecords.archivedAt));

  return {
    async findById(id: string): Promise<ServiceRecord | undefined> {
      const [row] = await db.select().from(serviceRecords).where(eq(serviceRecords.id, id));
      return row;
    },

    /** An item's active records, newest first. */
    async listByItem(itemId: string, page: { limit: number; cursor?: string }): Promise<Page<ServiceRecord>> {
      const rows = await db
        .select()
        .from(serviceRecords)
        .where(and(activeOf(itemId), beforeDate(serviceRecords.performedOn, serviceRecords.id, page.cursor)))
        .orderBy(desc(serviceRecords.performedOn), desc(serviceRecords.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ on: r.performedOn, id: r.id }));
    },

    /** Records of every item, newest first. `q` matches the title, the item's name and code and the location names on its path. */
    async list(filter: ServiceRecordFilter, page: { limit: number; cursor?: string }): Promise<Page<ServiceRecordListRow>> {
      const rows = await db
        .select(listColumns)
        .from(serviceRecords)
        .innerJoin(items, eq(items.id, serviceRecords.itemId))
        .leftJoin(locations, eq(locations.id, items.locationId))
        .where(and(...listWhere(filter), beforeDate(serviceRecords.performedOn, serviceRecords.id, page.cursor)))
        .orderBy(desc(serviceRecords.performedOn), desc(serviceRecords.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ on: r.performedOn, id: r.id }));
    },

    async count(filter: ServiceRecordFilter): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(serviceRecords)
        .innerJoin(items, eq(items.id, serviceRecords.itemId))
        .where(and(...listWhere(filter)));
      return row!.n;
    },

    async countByItem(itemId: string): Promise<number> {
      const [row] = await db.select({ n: count() }).from(serviceRecords).where(activeOf(itemId));
      return row!.n;
    },

    async insert(values: NewServiceRecord): Promise<ServiceRecord> {
      const [row] = await db
        .insert(serviceRecords)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    update(id: string, version: number, patch: ServiceRecordPatch): Promise<ServiceRecord | undefined> {
      return updateVersioned(db, serviceRecords, id, version, patch);
    },

    setArchived(id: string, version: number, archived: boolean, by: string): Promise<ServiceRecord | undefined> {
      return setArchived(db, serviceRecords, id, version, archived, by);
    },
  };
}

export type ServiceRecordRepository = ReturnType<typeof createServiceRecordRepository>;
