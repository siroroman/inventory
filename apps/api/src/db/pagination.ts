import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

export type Page<T> = { items: T[]; nextCursor: string | null };

/** The client sent a cursor this API did not issue. Routes map it to 400. */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

/** Sort key for lists ordered by name (Czech collation), with the id as a tie-breaker. */
export type NameKey = { name: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(key: object): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function decodeJson(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
}

export function decodeNameCursor(cursor: string): NameKey {
  const key = decodeJson(cursor) as Partial<NameKey> | null;
  if (typeof key?.name !== 'string' || typeof key.id !== 'string' || !UUID.test(key.id)) {
    throw new InvalidCursorError();
  }
  return { name: key.name, id: key.id };
}

/** Sort key for lists ordered by path (the names from the top down), with the id as a tie-breaker. */
export type PathKey = { path: string[]; id: string };

export function decodePathCursor(cursor: string): PathKey {
  const key = decodeJson(cursor) as Partial<PathKey> | null;
  const path = key?.path;
  if (!Array.isArray(path) || !path.every((name) => typeof name === 'string')) throw new InvalidCursorError();
  if (typeof key?.id !== 'string' || !UUID.test(key.id)) throw new InvalidCursorError();
  return { path, id: key.id };
}

export function decodeIdCursor(cursor: string): number {
  const key = decodeJson(cursor) as { id?: unknown } | null;
  if (!Number.isSafeInteger(key?.id) || (key!.id as number) < 1) throw new InvalidCursorError();
  return key!.id as number;
}

/**
 * Rows after the cursor in `ORDER BY name, id` order. The name column's collation (cs_cz) decides
 * the comparison, so pages continue exactly where the previous one ended.
 */
export function afterName(name: AnyColumn, id: AnyColumn, cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined;
  const key = decodeNameCursor(cursor);
  return sql`(${name}, ${id}) > (${key.name}, ${key.id}::uuid)`;
}

/** Rows after the cursor in `ORDER BY path, id` order; `path` is a cs_cz `text[]` expression. */
export function afterPath(path: SQL, id: AnyColumn, cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined;
  const key = decodePathCursor(cursor);
  return sql`(${path}, ${id}) > (${sql.param(key.path)}::text[] COLLATE cs_cz, ${key.id}::uuid)`;
}

/** Turns `limit + 1` fetched rows into a page; the extra row only signals that more exist. */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => object): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(keyOf(items[items.length - 1]!)) };
}
