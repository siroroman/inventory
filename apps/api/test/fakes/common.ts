import type { Transact } from '../../src/db/transaction.ts';
import { decodeNameCursor, decodePathCursor, type Page, toPage } from '../../src/db/pagination.ts';

// In-memory stand-ins for repositories, for service unit tests. They follow the repository
// contracts (ordering, archived rows hidden from lists, optimistic versions) closely enough for
// business rules; SQL details are covered by the repository integration tests.

const collator = new Intl.Collator('cs');

/** Case- and diacritics-insensitive substring match, like containsText. */
export function fakeContains(text: string | null | undefined, query: string): boolean {
  const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return text != null && normalize(text).includes(normalize(query));
}

/** Keyset paging by (name, id) in Czech order, like the repositories. */
export function fakePageByName<T extends { name: string; id: string }>(
  rows: T[],
  page: { limit: number; cursor?: string },
): Page<T> {
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
    collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let sorted = [...rows].sort(byName);
  if (page.cursor) {
    const key = decodeNameCursor(page.cursor);
    sorted = sorted.filter((row) => byName(row, key) > 0);
  }
  return toPage(sorted.slice(0, page.limit + 1), page.limit, (r) => ({ name: r.name, id: r.id }));
}

/** Keyset paging by (path, id): name by name in Czech order, a prefix first, like `ORDER BY text[]`. */
export function fakePageByPath<T extends { path: string[]; id: string }>(
  rows: T[],
  page: { limit: number; cursor?: string },
): Page<T> {
  const byPath = (a: { path: string[]; id: string }, b: { path: string[]; id: string }) => {
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
      const order = collator.compare(a.path[i]!, b.path[i]!);
      if (order) return order;
    }
    return a.path.length - b.path.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
  let sorted = [...rows].sort(byPath);
  if (page.cursor) {
    const key = decodePathCursor(page.cursor);
    sorted = sorted.filter((row) => byPath(row, key) > 0);
  }
  return toPage(sorted.slice(0, page.limit + 1), page.limit, (r) => ({ path: r.path, id: r.id }));
}

/**
 * Runs work against the given repositories. On failure it restores the snapshot, so tests can
 * check that a rejected write left nothing behind (like a rollback).
 */
export function fakeTransact<Repos>(repos: Repos, state: { snapshot(): () => void }): Transact<Repos> {
  return async (work) => {
    const restore = state.snapshot();
    try {
      return await work(repos);
    } catch (error) {
      restore();
      throw error;
    }
  };
}

/** Optimistic update of a fake row: undefined when the version is stale, like the real repositories. */
export function bumpVersion<T extends { version: number; updatedAt: Date }>(
  row: T,
  version: number,
  patch: Partial<T>,
): T | undefined {
  if (row.version !== version) return undefined;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  Object.assign(row, defined, { version: row.version + 1, updatedAt: new Date() });
  return { ...row };
}
