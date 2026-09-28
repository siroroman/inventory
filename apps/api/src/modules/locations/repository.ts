import { and, asc, count, eq, getTableColumns, isNull, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { afterName, type Page, toPage } from '../../db/pagination.ts';
import { locations, locationTypes } from '../../db/schema/index.ts';
import { containsText } from '../../db/search.ts';
import { setArchived, updateVersioned } from '../../db/versioned.ts';

export type Location = typeof locations.$inferSelect;
export type LocationType = typeof locationTypes.$inferSelect;
export type LocationWithType = Location & { type: Pick<LocationType, 'id' | 'code' | 'name'> | null };

type LocationFields = Pick<
  typeof locations.$inferInsert,
  'name' | 'parentId' | 'locationTypeId' | 'address' | 'note'
>;
/** `code` is optional: the database assigns the next LOC-nnn unless an existing number is imported. */
export type NewLocation = LocationFields & { code?: string; createdBy: string };
export type LocationPatch = Partial<LocationFields> & { updatedBy: string };

/**
 * `parentId: null` lists top-level locations, an id lists that location's direct children, and
 * leaving it out searches every level (used when picking a location for an item).
 */
export type LocationFilter = { parentId?: string | null; q?: string };

export type PathSegment = { id: string; code: string; name: string };
export type SubtreeCounts = { itemCount: number; childCount: number };

const withType = {
  ...getTableColumns(locations),
  type: { id: locationTypes.id, code: locationTypes.code, name: locationTypes.name },
};

function listWhere(filter: LocationFilter): SQL[] {
  const conditions: SQL[] = [isNull(locations.archivedAt)];
  if (filter.parentId === null) conditions.push(isNull(locations.parentId));
  else if (filter.parentId) conditions.push(eq(locations.parentId, filter.parentId));
  if (filter.q) conditions.push(containsText(locations.name, filter.q));
  return conditions;
}

export function createLocationRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<LocationWithType | undefined> {
      const [row] = await db
        .select(withType)
        .from(locations)
        .leftJoin(locationTypes, eq(locationTypes.id, locations.locationTypeId))
        .where(eq(locations.id, id));
      return row;
    },

    /** Active locations ordered by name (Czech collation). */
    async list(
      filter: LocationFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<LocationWithType>> {
      const rows = await db
        .select(withType)
        .from(locations)
        .leftJoin(locationTypes, eq(locationTypes.id, locations.locationTypeId))
        .where(and(...listWhere(filter), afterName(locations.name, locations.id, page.cursor)))
        .orderBy(asc(locations.name), asc(locations.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ name: r.name, id: r.id }));
    },

    async count(filter: LocationFilter): Promise<number> {
      const [row] = await db.select({ n: count() }).from(locations).where(and(...listWhere(filter)));
      return row!.n;
    },

    /** The path from the top-level location down to each given location (inclusive), for breadcrumbs. */
    async findPaths(ids: string[]): Promise<Map<string, PathSegment[]>> {
      const paths = new Map<string, PathSegment[]>();
      if (ids.length === 0) return paths;
      const result = await db.execute<PathSegment & { startId: string }>(sql`
        WITH RECURSIVE up (start_id, id, parent_id, code, name, depth) AS (
          SELECT l.id, l.id, l.parent_id, l.code, l.name, 0
            FROM locations l WHERE l.id = ANY(${sql.param(ids)}::uuid[])
          UNION ALL
          SELECT up.start_id, p.id, p.parent_id, p.code, p.name, up.depth + 1
            FROM locations p JOIN up ON p.id = up.parent_id
        )
        SELECT start_id AS "startId", id, code, name FROM up ORDER BY start_id, depth DESC`);
      for (const { startId, ...segment } of result.rows) {
        const path = paths.get(startId) ?? [];
        path.push(segment);
        paths.set(startId, path);
      }
      return paths;
    },

    /**
     * Active items anywhere below each location (itself included) and its active direct children.
     * An archived sub-location hides everything below it.
     */
    async countSubtree(ids: string[]): Promise<Map<string, SubtreeCounts>> {
      const counts = new Map<string, SubtreeCounts>();
      if (ids.length === 0) return counts;
      const result = await db.execute<SubtreeCounts & { id: string }>(sql`
        WITH RECURSIVE tree (root_id, id, depth) AS (
          SELECT l.id, l.id, 0 FROM locations l WHERE l.id = ANY(${sql.param(ids)}::uuid[])
          UNION ALL
          SELECT tree.root_id, c.id, tree.depth + 1
            FROM locations c JOIN tree ON c.parent_id = tree.id
           WHERE c.archived_at IS NULL
        )
        SELECT tree.root_id AS id,
               count(i.id)::int AS "itemCount",
               count(DISTINCT tree.id) FILTER (WHERE tree.depth = 1)::int AS "childCount"
          FROM tree LEFT JOIN items i ON i.location_id = tree.id AND i.archived_at IS NULL
         GROUP BY tree.root_id`);
      for (const { id, ...row } of result.rows) counts.set(id, row);
      return counts;
    },

    async insert(values: NewLocation): Promise<Location> {
      const [row] = await db
        .insert(locations)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    update(id: string, version: number, patch: LocationPatch): Promise<Location | undefined> {
      return updateVersioned(db, locations, id, version, patch);
    },

    setArchived(id: string, version: number, archived: boolean, by: string): Promise<Location | undefined> {
      return setArchived(db, locations, id, version, archived, by);
    },
  };
}

export type LocationRepository = ReturnType<typeof createLocationRepository>;

type LocationTypeFields = Pick<typeof locationTypes.$inferInsert, 'code' | 'name' | 'sortOrder'>;
export type NewLocationType = LocationTypeFields & { createdBy: string };
export type LocationTypePatch = Partial<LocationTypeFields> & { updatedBy: string };

export function createLocationTypeRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<LocationType | undefined> {
      const [row] = await db.select().from(locationTypes).where(eq(locationTypes.id, id));
      return row;
    },

    /** Active types in display order. A handful of rows, so no paging. */
    list(): Promise<LocationType[]> {
      return db
        .select()
        .from(locationTypes)
        .where(isNull(locationTypes.archivedAt))
        .orderBy(asc(locationTypes.sortOrder), asc(locationTypes.name));
    },

    async insert(values: NewLocationType): Promise<LocationType> {
      const [row] = await db
        .insert(locationTypes)
        .values({ ...values, updatedBy: values.createdBy })
        .returning();
      return row!;
    },

    update(id: string, version: number, patch: LocationTypePatch): Promise<LocationType | undefined> {
      return updateVersioned(db, locationTypes, id, version, patch);
    },
  };
}

export type LocationTypeRepository = ReturnType<typeof createLocationTypeRepository>;
