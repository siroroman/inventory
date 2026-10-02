import { and, desc, eq, getTableColumns } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { serviceRecordDocuments, user } from '../../db/schema/index.ts';
import { updateVersioned } from '../../db/versioned.ts';

export type RecordDocument = typeof serviceRecordDocuments.$inferSelect;
/** A document with the name of the user who added it (null without a recorded author). */
export type RecordDocumentWithAuthor = RecordDocument & { createdByName: string | null };
export type NewRecordDocument = Pick<
  typeof serviceRecordDocuments.$inferInsert,
  'serviceRecordId' | 'name' | 'storageKey' | 'contentType' | 'sizeBytes'
> & { createdBy: string };

const withAuthor = (db: DbExecutor) =>
  db
    .select({ ...getTableColumns(serviceRecordDocuments), createdByName: user.name })
    .from(serviceRecordDocuments)
    .leftJoin(user, eq(user.id, serviceRecordDocuments.createdBy));

export function createRecordDocumentRepository(db: DbExecutor) {
  return {
    /** A record's documents, newest first. */
    list(serviceRecordId: string): Promise<RecordDocumentWithAuthor[]> {
      return withAuthor(db)
        .where(eq(serviceRecordDocuments.serviceRecordId, serviceRecordId))
        .orderBy(desc(serviceRecordDocuments.createdAt), desc(serviceRecordDocuments.id));
    },

    async findById(id: string): Promise<RecordDocumentWithAuthor | undefined> {
      const [row] = await withAuthor(db).where(eq(serviceRecordDocuments.id, id));
      return row;
    },

    async insert(values: NewRecordDocument): Promise<RecordDocument> {
      const [row] = await db
        .insert(serviceRecordDocuments)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    /** Undefined when the version is stale (or the id is unknown): the service tells 409 from 404. */
    rename(id: string, version: number, patch: { name: string; updatedBy: string }): Promise<RecordDocument | undefined> {
      return updateVersioned(db, serviceRecordDocuments, id, version, patch);
    },

    /** Removes the row and returns it, so the service can delete the stored file. */
    async delete(serviceRecordId: string, id: string): Promise<RecordDocument | undefined> {
      const [row] = await db
        .delete(serviceRecordDocuments)
        .where(and(eq(serviceRecordDocuments.serviceRecordId, serviceRecordId), eq(serviceRecordDocuments.id, id)))
        .returning();
      return row;
    },
  };
}

export type RecordDocumentRepository = ReturnType<typeof createRecordDocumentRepository>;
