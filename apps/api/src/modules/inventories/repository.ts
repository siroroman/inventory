import { and, asc, count, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../../db/client.ts';
import { beforeTimestamp, type Page, toPage } from '../../db/pagination.ts';
import { inventories, inventoryItems, items, locations, user } from '../../db/schema/index.ts';
import { updateVersioned } from '../../db/versioned.ts';
import { matchesSearch, subtreeOf } from '../locations/repository.ts';

export type Inventory = typeof inventories.$inferSelect;
export type Person = { id: string; name: string };
type LocationRef = { id: string; code: string; name: string };
/** A run with its root location and the people who started and ended it (null: unknown user). */
export type InventoryRow = Inventory & { location: LocationRef; startedBy: Person | null; closedBy: Person | null };

/** `created_at` and `created_by` are the start. The service sets `createdAt` from its clock (see `TimestampKey`). */
export type NewInventory = { locationId: string; createdBy: string; createdAt: Date };
export type InventoryPatch = Partial<Pick<typeof inventories.$inferInsert, 'status' | 'endedAt' | 'endedBy' | 'note' | 'committee'>> & {
  updatedBy: string;
};

/** `open` lists the runs in progress, `closed` the finished and cancelled ones. `q` searches the root location. */
export type InventoryFilter = { state: 'open' | 'closed'; q?: string };

/**
 * What a run's rows add up to. `expected` and `checked` count the list taken at the start without
 * the items archived since; `elsewhere` and `new` count the items found or added (checked ones only).
 */
export type InventoryCounts = { expected: number; checked: number; elsewhere: number; new: number; missing: number };
export type LocationProgress = { locationId: string; total: number; checked: number };
export type LocationChecker = { locationId: string } & Person;

export type StartPreview = { itemCount: number; locationCount: number };

/** The item a label names, with what a scan needs to decide: its state and where it is registered. */
export type ScanTarget = { id: string; code: string; name: string; archived: boolean; locationId: string | null };

/** An item of a run (a row of `inventory_items`) with the item's code, name and state and who checked it. */
export type RunItem = {
  itemId: string;
  code: string;
  name: string;
  itemArchived: boolean;
  kind: string;
  /** Where the row belongs in the run. */
  locationId: string;
  /** Where a found-elsewhere item was registered (null: nowhere). */
  registeredLocationId: string | null;
  checkedAt: Date | null;
  checkedBy: Person | null;
  method: string | null;
  moved: boolean;
};

const starter = user;
const closer = alias(user, 'closer');
const checker = alias(user, 'checker');

const rowColumns = {
  ...getTableColumns(inventories),
  location: { id: locations.id, code: locations.code, name: locations.name },
  startedBy: { id: starter.id, name: starter.name },
  closedBy: { id: closer.id, name: closer.name },
};

const runItemColumns = {
  itemId: inventoryItems.itemId,
  code: items.code,
  name: items.name,
  itemArchivedAt: items.archivedAt,
  kind: inventoryItems.kind,
  locationId: inventoryItems.locationId,
  registeredLocationId: inventoryItems.registeredLocationId,
  checkedAt: inventoryItems.checkedAt,
  checkedBy: { id: checker.id, name: checker.name },
  method: inventoryItems.method,
  movedAt: inventoryItems.movedAt,
};

type RunItemRecord = Omit<RunItem, 'itemArchived' | 'moved'> & { itemArchivedAt: Date | null; movedAt: Date | null };

function toRunItem({ itemArchivedAt, movedAt, ...row }: RunItemRecord): RunItem {
  return { ...row, itemArchived: itemArchivedAt !== null, moved: movedAt !== null };
}

/** A run in progress on the location, on any location above it, or on any location below it (archived ones too). */
function overlapWith(locationId: string): SQL {
  return sql`${inventories.locationId} IN (
    WITH RECURSIVE up (id, parent_id) AS (
      SELECT l.id, l.parent_id FROM locations l WHERE l.id = ${locationId}
      UNION ALL
      SELECT p.id, p.parent_id FROM locations p JOIN up ON p.id = up.parent_id
    ), down (id) AS (
      SELECT l.id FROM locations l WHERE l.id = ${locationId}
      UNION ALL
      SELECT c.id FROM locations c JOIN down ON c.parent_id = down.id
    )
    SELECT id FROM up UNION SELECT id FROM down
  )`;
}

function listWhere(db: DbExecutor, filter: InventoryFilter): SQL[] {
  const conditions: SQL[] = [
    filter.state === 'open' ? eq(inventories.status, 'in_progress') : ne(inventories.status, 'in_progress'),
  ];
  const search = filter.q ? matchesSearch(filter.q) : undefined;
  if (search) {
    conditions.push(inArray(inventories.locationId, db.select({ id: locations.id }).from(locations).where(search)));
  }
  return conditions;
}

/** Items of the active subtree: active, and in the root or an active location below it. */
const inSnapshot = (rootId: string) => sql`i.archived_at IS NULL AND i.location_id IN (${subtreeOf(rootId)})`;

/** The rows a person sees: the list taken at the start without the items archived since, plus the items found or added (checked ones). */
const visibleRow = or(
  and(eq(inventoryItems.kind, 'expected'), isNull(items.archivedAt)),
  and(ne(inventoryItems.kind, 'expected'), isNotNull(inventoryItems.checkedAt)),
);

export function createInventoryRepository(db: DbExecutor) {
  const selectRunItems = () =>
    db
      .select(runItemColumns)
      .from(inventoryItems)
      .innerJoin(items, eq(items.id, inventoryItems.itemId))
      .leftJoin(checker, eq(checker.id, inventoryItems.checkedBy));

  const selectRows = () =>
    db
      .select(rowColumns)
      .from(inventories)
      .innerJoin(locations, eq(locations.id, inventories.locationId))
      .leftJoin(starter, eq(starter.id, inventories.createdBy))
      .leftJoin(closer, eq(closer.id, inventories.endedBy));

  return {
    /** Serialises starts until the transaction ends, so two of them cannot both pass the overlap check. */
    async lockStarts(): Promise<void> {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inventories_start'))`);
    },

    /** The oldest run in progress that overlaps `locationId` (see `overlapWith`). */
    async findOverlapping(locationId: string): Promise<InventoryRow | undefined> {
      const [row] = await selectRows()
        .where(and(eq(inventories.status, 'in_progress'), overlapWith(locationId)))
        .orderBy(inventories.createdAt, inventories.id)
        .limit(1);
      return row;
    },

    async findById(id: string): Promise<InventoryRow | undefined> {
      const [row] = await selectRows().where(eq(inventories.id, id));
      return row;
    },

    /** The run's row, locked until the end of the transaction (finish and cancel). */
    async lock(id: string): Promise<Inventory | undefined> {
      const [row] = await db.select().from(inventories).where(eq(inventories.id, id)).for('update');
      return row;
    },

    /** The run's row, shared until the end of the transaction: checks go on side by side, but not past a finish or cancel. */
    async lockShared(id: string): Promise<Inventory | undefined> {
      const [row] = await db.select().from(inventories).where(eq(inventories.id, id)).for('share');
      return row;
    },

    /** Runs in progress newest first by start, or ended ones newest first by end. */
    async list(filter: InventoryFilter, page: { limit: number; cursor?: string }): Promise<Page<InventoryRow>> {
      const moment = filter.state === 'open' ? inventories.createdAt : inventories.endedAt;
      const rows = await selectRows()
        .where(and(...listWhere(db, filter), beforeTimestamp(moment, inventories.id, page.cursor)))
        .orderBy(desc(moment), desc(inventories.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({
        at: (filter.state === 'open' ? r.createdAt : r.endedAt!).toISOString(),
        id: r.id,
      }));
    },

    async count(filter: InventoryFilter): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(inventories)
        .where(and(...listWhere(db, filter)));
      return row!.n;
    },

    async insert(values: NewInventory): Promise<Inventory> {
      const [row] = await db
        .insert(inventories)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    /** Takes the list of the run: every active item in the root or an active location below it. Returns how many. */
    async snapshot(inventoryId: string, rootId: string): Promise<number> {
      const result = await db.execute(sql`
        INSERT INTO inventory_items (inventory_id, item_id, kind, location_id)
        SELECT ${inventoryId}::uuid, i.id, 'expected', i.location_id FROM items i WHERE ${inSnapshot(rootId)}`);
      return result.rowCount ?? 0;
    },

    /** What a run on `rootId` would check, for the start screen. */
    async previewCounts(rootId: string): Promise<StartPreview> {
      const result = await db.execute<StartPreview>(sql`
        SELECT count(*)::int AS "itemCount", count(DISTINCT i.location_id)::int AS "locationCount"
          FROM items i WHERE ${inSnapshot(rootId)}`);
      return result.rows[0]!;
    },

    /** The rows a person sees in the run, or in one of its locations, by item name in Czech order. */
    async runItems(inventoryId: string, locationId?: string): Promise<RunItem[]> {
      const rows = await selectRunItems()
        .where(
          and(
            eq(inventoryItems.inventoryId, inventoryId),
            visibleRow,
            locationId ? eq(inventoryItems.locationId, locationId) : undefined,
          ),
        )
        .orderBy(asc(items.name), asc(items.id));
      return rows.map(toRunItem);
    },

    /** The run's row for an item, visible or not. */
    async findRunItem(inventoryId: string, itemId: string): Promise<RunItem | undefined> {
      const [row] = await selectRunItems().where(
        and(eq(inventoryItems.inventoryId, inventoryId), eq(inventoryItems.itemId, itemId)),
      );
      return row && toRunItem(row);
    },

    /** Ticks the row if nobody has yet: false when it was already checked (the first check wins). */
    async markChecked(
      inventoryId: string,
      itemId: string,
      check: { checkedAt: Date; checkedBy: string; method: 'scan' | 'manual' },
    ): Promise<boolean> {
      const updated = await db
        .update(inventoryItems)
        .set({ checkedAt: check.checkedAt, checkedBy: check.checkedBy, method: check.method })
        .where(
          and(
            eq(inventoryItems.inventoryId, inventoryId),
            eq(inventoryItems.itemId, itemId),
            isNull(inventoryItems.checkedAt),
          ),
        )
        .returning({ id: inventoryItems.id });
      return updated.length > 0;
    },

    /** Clears a check: false when the row was not checked. */
    async markUnchecked(inventoryId: string, itemId: string): Promise<boolean> {
      const updated = await db
        .update(inventoryItems)
        .set({ checkedAt: null, checkedBy: null, method: null })
        .where(
          and(
            eq(inventoryItems.inventoryId, inventoryId),
            eq(inventoryItems.itemId, itemId),
            isNotNull(inventoryItems.checkedAt),
          ),
        )
        .returning({ id: inventoryItems.id });
      return updated.length > 0;
    },

    /** The item with this ID (case ignored, archived ones too). */
    async findItemByCode(code: string): Promise<ScanTarget | undefined> {
      const [row] = await db
        .select({ id: items.id, code: items.code, name: items.name, archivedAt: items.archivedAt, locationId: items.locationId })
        .from(items)
        .where(sql`upper(${items.code}) = ${code.trim().toUpperCase()}`)
        .orderBy(items.code)
        .limit(1);
      return row && { id: row.id, code: row.code, name: row.name, archived: row.archivedAt !== null, locationId: row.locationId };
    },

    /**
     * Adds an item that is not on the list to the run, checked, or checks a found item again that
     * was unticked (such rows are kept). False when the row is there and already checked, or is not
     * a found item: a check by somebody else came first, and the caller reads the row back.
     */
    async recordFound(
      inventoryId: string,
      itemId: string,
      found: {
        locationId: string;
        registeredLocationId: string | null;
        checkedAt: Date;
        checkedBy: string;
        method: 'scan' | 'manual';
      },
    ): Promise<boolean> {
      const rows = await db
        .insert(inventoryItems)
        .values({ inventoryId, itemId, kind: 'elsewhere', ...found })
        .onConflictDoUpdate({
          target: [inventoryItems.inventoryId, inventoryItems.itemId],
          set: found,
          setWhere: and(isNull(inventoryItems.checkedAt), eq(inventoryItems.kind, 'elsewhere')),
        })
        .returning({ id: inventoryItems.id });
      return rows.length > 0;
    },

    update(id: string, version: number, patch: InventoryPatch): Promise<Inventory | undefined> {
      return updateVersioned(db, inventories, id, version, patch);
    },

    async counts(ids: string[]): Promise<Map<string, InventoryCounts>> {
      const counts = new Map<string, InventoryCounts>();
      if (ids.length === 0) return counts;
      const result = await db.execute<InventoryCounts & { id: string }>(sql`
        SELECT r.inventory_id AS id,
          count(*) FILTER (WHERE r.kind = 'expected' AND i.archived_at IS NULL)::int AS expected,
          count(*) FILTER (WHERE r.kind = 'expected' AND i.archived_at IS NULL AND r.checked_at IS NOT NULL)::int AS checked,
          count(*) FILTER (WHERE r.kind = 'elsewhere' AND r.checked_at IS NOT NULL)::int AS elsewhere,
          count(*) FILTER (WHERE r.kind = 'new' AND r.checked_at IS NOT NULL)::int AS "new",
          count(*) FILTER (WHERE r.outcome = 'missing')::int AS missing
          FROM inventory_items r JOIN items i ON i.id = r.item_id
         WHERE r.inventory_id = ANY(${sql.param(ids)}::uuid[])
         GROUP BY r.inventory_id`);
      for (const { id, ...row } of result.rows) counts.set(id, row);
      return counts;
    },

    /** Who took part: the person who started it, then everyone who checked something, in order of their first check. */
    async participants(ids: string[]): Promise<Map<string, Person[]>> {
      const people = new Map<string, Person[]>();
      if (ids.length === 0) return people;
      const result = await db.execute<Person & { inventoryId: string }>(sql`
        SELECT p.inventory_id AS "inventoryId", u.id, u.name
          FROM (
            SELECT i.id AS inventory_id, i.created_by AS user_id, 0 AS rank, i.created_at AS at
              FROM inventories i WHERE i.id = ANY(${sql.param(ids)}::uuid[]) AND i.created_by IS NOT NULL
            UNION ALL
            SELECT r.inventory_id, r.checked_by, 1, min(r.checked_at)
              FROM inventory_items r
             WHERE r.inventory_id = ANY(${sql.param(ids)}::uuid[]) AND r.checked_by IS NOT NULL
             GROUP BY r.inventory_id, r.checked_by
          ) p JOIN ${user} u ON u.id = p.user_id
         ORDER BY p.inventory_id, p.rank, p.at`);
      for (const { inventoryId, ...person } of result.rows) {
        const list = people.get(inventoryId) ?? [];
        // The starter may have checked items too.
        if (!list.some((known) => known.id === person.id)) list.push(person);
        people.set(inventoryId, list);
      }
      return people;
    },

    /**
     * The rows of each location of the run that a person sees: the list taken at the start without
     * the items archived since, plus the items found or added (checked ones). Locations without
     * any such row are left out.
     */
    async locationProgress(inventoryId: string): Promise<LocationProgress[]> {
      const result = await db.execute<LocationProgress>(sql`
        SELECT r.location_id AS "locationId",
          count(*)::int AS total,
          count(*) FILTER (WHERE r.checked_at IS NOT NULL)::int AS checked
          FROM inventory_items r JOIN items i ON i.id = r.item_id
         WHERE r.inventory_id = ${inventoryId}
           AND ((r.kind = 'expected' AND i.archived_at IS NULL) OR (r.kind <> 'expected' AND r.checked_at IS NOT NULL))
         GROUP BY r.location_id`);
      return result.rows;
    },

    /** Who checked something in each location, in order of their first check there. */
    async locationCheckers(inventoryId: string): Promise<LocationChecker[]> {
      const result = await db.execute<LocationChecker>(sql`
        SELECT r.location_id AS "locationId", u.id, u.name
          FROM inventory_items r JOIN ${user} u ON u.id = r.checked_by
         WHERE r.inventory_id = ${inventoryId} AND r.checked_at IS NOT NULL
         GROUP BY r.location_id, u.id, u.name
         ORDER BY r.location_id, min(r.checked_at)`);
      return result.rows;
    },

    /** People who checked something since `since`, most recent first. */
    async recentCheckers(inventoryId: string, since: Date): Promise<Person[]> {
      const result = await db.execute<Person>(sql`
        SELECT u.id, u.name
          FROM inventory_items r JOIN ${user} u ON u.id = r.checked_by
         WHERE r.inventory_id = ${inventoryId} AND r.checked_at >= ${since.toISOString()}::timestamptz
         GROUP BY u.id, u.name
         ORDER BY max(r.checked_at) DESC`);
      return result.rows;
    },
  };
}

export type InventoryRepository = ReturnType<typeof createInventoryRepository>;
