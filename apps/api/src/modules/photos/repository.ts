import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { itemPhotos } from '../../db/schema/index.ts';

export type Photo = typeof itemPhotos.$inferSelect;
export type NewPhoto = Pick<
  typeof itemPhotos.$inferInsert,
  'itemId' | 'storageKey' | 'contentType' | 'width' | 'height'
> & { createdBy: string };

export function createPhotoRepository(db: DbExecutor) {
  return {
    /** Photos of an item in gallery order; the first one is the main photo and list thumbnail. */
    list(itemId: string): Promise<Photo[]> {
      return db
        .select()
        .from(itemPhotos)
        .where(eq(itemPhotos.itemId, itemId))
        .orderBy(asc(itemPhotos.sortOrder), asc(itemPhotos.id));
    },

    async count(itemId: string): Promise<number> {
      const [row] = await db.select({ n: count() }).from(itemPhotos).where(eq(itemPhotos.itemId, itemId));
      return row!.n;
    },

    /** Adds the photo at the end of the gallery. */
    async insert(values: NewPhoto): Promise<Photo> {
      const [row] = await db
        .insert(itemPhotos)
        .values({
          ...values,
          sortOrder: sql`(SELECT coalesce(max(${itemPhotos.sortOrder}), 0) + 1 FROM ${itemPhotos} WHERE ${itemPhotos.itemId} = ${values.itemId})`,
        })
        .returning();
      return row!;
    },

    /** Removes the row and returns it, so the service can delete the stored file. */
    async delete(itemId: string, photoId: string): Promise<Photo | undefined> {
      const [row] = await db
        .delete(itemPhotos)
        .where(and(eq(itemPhotos.itemId, itemId), eq(itemPhotos.id, photoId)))
        .returning();
      return row;
    },

    /**
     * Sets the gallery order: the first id becomes 1. Ids of other items are ignored; the returned
     * count lets the service check that the list covered exactly this item's photos.
     */
    async reorder(itemId: string, orderedIds: string[]): Promise<number> {
      if (orderedIds.length === 0) return 0;
      const result = await db.execute(sql`
        UPDATE item_photos p SET sort_order = o.position
          FROM unnest(${sql.param(orderedIds)}::uuid[]) WITH ORDINALITY AS o (id, position)
         WHERE p.id = o.id AND p.item_id = ${itemId}`);
      return result.rowCount ?? 0;
    },
  };
}

export type PhotoRepository = ReturnType<typeof createPhotoRepository>;
