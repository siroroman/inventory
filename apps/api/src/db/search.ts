import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** Makes `%`, `_` and `\` in user input match literally inside a LIKE pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Case- and diacritics-insensitive substring match. The left side is exactly the expression the
 * trigram indexes are built on (migration 0008); change both together or the indexes go unused.
 */
export function containsText(column: AnyColumn | SQL, query: string): SQL {
  return sql`f_unaccent(lower(${column})) LIKE '%' || f_unaccent(lower(${escapeLike(query)})) || '%'`;
}

/** The words of a search text, split on whitespace; empty for a blank text. */
export function searchWords(query: string): string[] {
  return query.split(/\s+/).filter(Boolean);
}
