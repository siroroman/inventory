import { and, eq, type InferSelectModel, sql } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { DbExecutor } from './client.ts';

type VersionedTable = PgTable & {
  id: PgColumn;
  version: PgColumn;
  updatedBy: PgColumn;
};
type ArchivableTable = VersionedTable & { archivedAt: PgColumn };

/**
 * Optimistic update: changes the row only if it still has `version`. Returns the updated row, or
 * undefined when the id is unknown or the version is stale (the service tells 404 from 409).
 * The touch_row trigger bumps version and updated_at; never set them here.
 */
export async function updateVersioned<T extends VersionedTable>(
  db: DbExecutor,
  table: T,
  id: string,
  version: number,
  set: PgUpdateSetSource<T>,
): Promise<InferSelectModel<T> | undefined> {
  const rows = (await db
    .update(table)
    .set(set)
    .where(and(eq(table.id, id), eq(table.version, version)))
    .returning()) as InferSelectModel<T>[];
  return rows[0];
}

/** Archives (or restores) a row with the same optimistic check as updateVersioned. */
export function setArchived<T extends ArchivableTable>(
  db: DbExecutor,
  table: T,
  id: string,
  version: number,
  archived: boolean,
  by: string,
): Promise<InferSelectModel<T> | undefined> {
  const set = { archivedAt: archived ? sql`now()` : null, updatedBy: by } as PgUpdateSetSource<T>;
  return updateVersioned(db, table, id, version, set);
}
