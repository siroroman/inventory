import { and, asc, count, eq, getTableColumns, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { afterName, type Page, toPage } from '../../db/pagination.ts';
import { locations, locationTypes } from '../../db/schema/index.ts';
import { containsText, searchWords } from '../../db/search.ts';
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
 * leaving it out searches every level (used when picking a location for an item). `q` searches by
 * name and code, along the whole path (see `matchesSearch`); `withSubLocations` adds everything
 * below each match and orders the list by path, so the sub-locations follow the one they are in.
 * `archived` lists the archived locations instead of the active ones.
 */
export type LocationFilter = {
  parentId?: string | null;
  q?: string;
  withSubLocations?: boolean;
  archived?: boolean;
};

export type PathSegment = { id: string; code: string; name: string };
export type SubtreeCounts = { itemCount: number; childCount: number };

const withType = {
  ...getTableColumns(locations),
  type: { id: locationTypes.id, code: locationTypes.code, name: locationTypes.name },
};

/**
 * A location matches a search when every word is in the name or code of the location or of one of
 * the locations above it, and at least one word is in its own name or code. "zasedacka hrad" finds
 * Zasedačka in Centrála Hradec Králové, but "hrad" alone finds only Hradec, not everything below it.
 */
function matchesSearch(q: string): SQL | undefined {
  const words = searchWords(q);
  if (words.length === 0) return undefined;
  const own = words.map((word) => or(containsText(locations.name, word), containsText(locations.code, word)));
  // Each location with the codes and names of its whole path, top-level first. The words hold no
  // whitespace, so none can match across two segments.
  const onPath = sql`${locations.id} IN (
    WITH RECURSIVE tree (id, path) AS (
      SELECT l.id, l.code || ' ' || (l.name COLLATE "default")
        FROM locations l WHERE l.parent_id IS NULL
      UNION ALL
      SELECT c.id, tree.path || ' ' || c.code || ' ' || (c.name COLLATE "default")
        FROM locations c JOIN tree ON c.parent_id = tree.id
    )
    SELECT tree.id FROM tree WHERE ${and(...words.map((word) => containsText(sql`tree.path`, word)))}
  )`;
  return and(or(...own), onPath);
}

/** The locations matching `match` and their active sub-locations at every level. */
function andBelow(match: SQL): SQL {
  // The inner unaliased `locations` is the one `match` refers to.
  return sql`${locations.id} IN (
    WITH RECURSIVE sub (id) AS (
      SELECT locations.id FROM locations WHERE ${match}
      UNION
      SELECT c.id FROM locations c JOIN sub ON c.parent_id = sub.id WHERE c.archived_at IS NULL
    )
    SELECT sub.id FROM sub
  )`;
}

/**
 * The names from the top-level location down, "Centrála Hradec Králové › Zasedačka", in Czech
 * collation. Ordered by it, every location follows the one it is in (› sorts before letters/digits).
 */
const pathName = sql<string>`((
  WITH RECURSIVE up (parent_id, name, depth) AS (
    SELECT p.parent_id, p.name, 0 FROM locations p WHERE p.id = ${locations.id}
    UNION ALL
    SELECT p.parent_id, p.name, up.depth + 1 FROM locations p JOIN up ON p.id = up.parent_id
  )
  SELECT string_agg(up.name, ' › ' ORDER BY up.depth DESC) FROM up
) COLLATE cs_cz)`;

function listWhere(filter: LocationFilter): SQL[] {
  const conditions: SQL[] = [filter.archived ? isNotNull(locations.archivedAt) : isNull(locations.archivedAt)];
  if (filter.parentId === null) conditions.push(isNull(locations.parentId));
  else if (filter.parentId) conditions.push(eq(locations.parentId, filter.parentId));
  const search = filter.q ? matchesSearch(filter.q) : undefined;
  if (search) conditions.push(filter.withSubLocations ? andBelow(search) : search);
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

    /**
     * Active (or, with `archived`, archived) locations ordered by name (Czech collation), or by
     * path with `withSubLocations`.
     */
    async list(
      filter: LocationFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<LocationWithType>> {
      const sortKey = filter.withSubLocations ? pathName : locations.name;
      const rows = await db
        .select({ ...withType, sortKey })
        .from(locations)
        .leftJoin(locationTypes, eq(locationTypes.id, locations.locationTypeId))
        .where(and(...listWhere(filter), afterName(sortKey, locations.id, page.cursor)))
        .orderBy(asc(sortKey), asc(locations.id))
        .limit(page.limit + 1);
      const result = toPage(rows, page.limit, (r) => ({ name: r.sortKey, id: r.id }));
      return { ...result, items: result.items.map(({ sortKey: _, ...row }) => row) };
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
