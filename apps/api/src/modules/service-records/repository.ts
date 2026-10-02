import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { beforeDate, type Page, toPage } from '../../db/pagination.ts';
import { serviceRecords } from '../../db/schema/index.ts';
import { setArchived, updateVersioned } from '../../db/versioned.ts';

export type ServiceRecord = typeof serviceRecords.$inferSelect;

type ServiceRecordFields = Pick<
  typeof serviceRecords.$inferInsert,
  'performedOn' | 'title' | 'performedBy' | 'responsiblePerson' | 'description'
>;
export type NewServiceRecord = ServiceRecordFields & { itemId: string; createdBy: string };
export type ServiceRecordPatch = Partial<ServiceRecordFields> & { updatedBy: string };

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
