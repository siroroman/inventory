import { and, asc, count, eq, getTableColumns, inArray, isNotNull, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { afterName, type Page, toPage } from '../../db/pagination.ts';
import { itemExternalIds, itemPhotos, items, locations, manufacturers } from '../../db/schema/index.ts';
import { containsText } from '../../db/search.ts';
import { setArchived, updateVersioned } from '../../db/versioned.ts';

export type Item = typeof items.$inferSelect;
export type ExternalId = typeof itemExternalIds.$inferSelect;
type ManufacturerRef = { id: string; name: string };
export type ItemWithManufacturer = Item & { manufacturer: ManufacturerRef | null };
export type ItemListRow = ItemWithManufacturer & {
  /** Missing while the item has no location. */
  location: { id: string; code: string; name: string } | null;
  /** Storage key of the first photo, for the list thumbnail. */
  thumbnailKey: string | null;
};

type ItemFields = Pick<
  typeof items.$inferInsert,
  | 'name'
  | 'locationId'
  | 'manufacturerId'
  | 'model'
  | 'serialNumber'
  | 'manufactureYear'
  | 'registeredOn'
  | 'warrantyUntil'
  | 'lastServiceOn'
  | 'nextServiceOn'
  | 'documentsUrl'
  | 'note'
>;
/** `code` is optional: the database assigns the next INV-nnnnn unless an existing number is imported. */
export type NewItem = ItemFields & { code?: string; createdBy: string };
export type ItemPatch = Partial<ItemFields> & { updatedBy: string };
export type ExternalIdInput = { source: string; value: string };
/** An external ID another item already has, as stored, and the code of that item. */
export type ExternalIdClash = ExternalIdInput & { itemCode: string };

/** `locationId` includes items anywhere below that location; `archived` lists the archived items instead. */
export type ItemFilter = { q?: string; locationId?: string; manufacturerId?: string; archived?: boolean };

/** The location and its active descendants; an archived sub-location hides everything below it. */
function subtreeOf(locationId: string): SQL {
  return sql`
    WITH RECURSIVE sub (id) AS (
      SELECT l.id FROM locations l WHERE l.id = ${locationId}
      UNION ALL
      SELECT c.id FROM locations c JOIN sub ON c.parent_id = sub.id WHERE c.archived_at IS NULL
    )
    SELECT id FROM sub`;
}

/**
 * Active locations whose name matches, and everything below them: a search hits the full path.
 * Looking for archived items, archived locations count too (the item may sit in one).
 */
function locationsMatching(q: string, archived: boolean): SQL {
  const active = archived ? sql`TRUE` : sql`${locations.archivedAt} IS NULL`;
  const activeChild = archived ? sql`TRUE` : sql`c.archived_at IS NULL`;
  return sql`
    WITH RECURSIVE sub (id) AS (
      SELECT ${locations.id} FROM ${locations}
       WHERE ${active} AND ${containsText(locations.name, q)}
      UNION ALL
      SELECT c.id FROM locations c JOIN sub ON c.parent_id = sub.id WHERE ${activeChild}
    )
    SELECT id FROM sub`;
}

function searchCondition(db: DbExecutor, q: string, archived: boolean): SQL {
  return or(
    containsText(items.name, q),
    containsText(items.code, q),
    containsText(items.serialNumber, q),
    containsText(items.model, q),
    inArray(
      items.id,
      db.select({ id: itemExternalIds.itemId }).from(itemExternalIds).where(containsText(itemExternalIds.value, q)),
    ),
    inArray(
      items.manufacturerId,
      db.select({ id: manufacturers.id }).from(manufacturers).where(containsText(manufacturers.name, q)),
    ),
    sql`${items.locationId} IN (${locationsMatching(q, archived)})`,
  )!;
}

function listWhere(db: DbExecutor, filter: ItemFilter): SQL[] {
  const conditions: SQL[] = [filter.archived ? isNotNull(items.archivedAt) : isNull(items.archivedAt)];
  if (filter.locationId) conditions.push(sql`${items.locationId} IN (${subtreeOf(filter.locationId)})`);
  if (filter.manufacturerId) conditions.push(eq(items.manufacturerId, filter.manufacturerId));
  if (filter.q) conditions.push(searchCondition(db, filter.q, Boolean(filter.archived)));
  return conditions;
}

const manufacturerRef = { id: manufacturers.id, name: manufacturers.name };

const listColumns = {
  ...getTableColumns(items),
  manufacturer: manufacturerRef,
  location: { id: locations.id, code: locations.code, name: locations.name },
  thumbnailKey: sql<string | null>`(
    SELECT ${itemPhotos.storageKey} FROM ${itemPhotos} WHERE ${itemPhotos.itemId} = ${items.id}
     ORDER BY ${itemPhotos.sortOrder}, ${itemPhotos.id} LIMIT 1)`,
};

export function createItemRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<ItemWithManufacturer | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(items), manufacturer: manufacturerRef })
        .from(items)
        .leftJoin(manufacturers, eq(manufacturers.id, items.manufacturerId))
        .where(eq(items.id, id));
      return row;
    },

    /**
     * Active (or, with `archived`, archived) items ordered by name. `q` matches name, code, serial number, model, an external ID,
     * the manufacturer, or any location on the item's path, ignoring case and diacritics.
     */
    async list(filter: ItemFilter, page: { limit: number; cursor?: string }): Promise<Page<ItemListRow>> {
      const rows = await db
        .select(listColumns)
        .from(items)
        .leftJoin(locations, eq(locations.id, items.locationId))
        .leftJoin(manufacturers, eq(manufacturers.id, items.manufacturerId))
        .where(and(...listWhere(db, filter), afterName(items.name, items.id, page.cursor)))
        .orderBy(asc(items.name), asc(items.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ name: r.name, id: r.id }));
    },

    async count(filter: ItemFilter): Promise<number> {
      const [row] = await db.select({ n: count() }).from(items).where(and(...listWhere(db, filter)));
      return row!.n;
    },

    async insert(values: NewItem): Promise<Item> {
      const [row] = await db
        .insert(items)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    update(id: string, version: number, patch: ItemPatch): Promise<Item | undefined> {
      return updateVersioned(db, items, id, version, patch);
    },

    setArchived(id: string, version: number, archived: boolean, by: string): Promise<Item | undefined> {
      return setArchived(db, items, id, version, archived, by);
    },

    listExternalIds(itemId: string): Promise<ExternalId[]> {
      return db
        .select()
        .from(itemExternalIds)
        .where(eq(itemExternalIds.itemId, itemId))
        .orderBy(sql`lower(${itemExternalIds.source})`, sql`lower(${itemExternalIds.value})`);
    },

    /**
     * The given external IDs that an item other than `exceptItemId` already has, archived items
     * included, matched ignoring case like the unique index. The service asks first so it can name
     * the clash; the index stays as the guard against two requests racing.
     */
    async findExternalIdClashes(ids: ExternalIdInput[], exceptItemId?: string): Promise<ExternalIdClash[]> {
      if (ids.length === 0) return [];
      const samePair = or(
        ...ids.map(
          ({ source, value }) =>
            sql`(lower(${itemExternalIds.source}) = lower(${source}) AND lower(${itemExternalIds.value}) = lower(${value}))`,
        ),
      );
      return db
        .select({ source: itemExternalIds.source, value: itemExternalIds.value, itemCode: items.code })
        .from(itemExternalIds)
        .innerJoin(items, eq(items.id, itemExternalIds.itemId))
        .where(and(samePair, exceptItemId ? ne(itemExternalIds.itemId, exceptItemId) : undefined))
        .orderBy(sql`lower(${itemExternalIds.source})`, sql`lower(${itemExternalIds.value})`);
    },

    /**
     * Replaces all external IDs of an item; run it in the service's transaction. A pair already
     * used by another item fails with item_external_ids_source_value_key.
     */
    async replaceExternalIds(itemId: string, ids: ExternalIdInput[], by: string): Promise<ExternalId[]> {
      await db.delete(itemExternalIds).where(eq(itemExternalIds.itemId, itemId));
      if (ids.length === 0) return [];
      return db
        .insert(itemExternalIds)
        .values(ids.map(({ source, value }) => ({ itemId, source, value, createdBy: by })))
        .returning();
    },
  };
}

export type ItemRepository = ReturnType<typeof createItemRepository>;
