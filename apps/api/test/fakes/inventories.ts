import { randomUUID } from 'node:crypto';
import { decodeTimestampCursor, toPage } from '../../src/db/pagination.ts';
import type { inventoryItems } from '../../src/db/schema/index.ts';
import { searchWords } from '../../src/db/search.ts';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type {
  Inventory,
  InventoryCounts,
  InventoryFilter,
  InventoryRepository,
  InventoryRow,
  Person,
} from '../../src/modules/inventories/repository.ts';
import type { InventoryRepos } from '../../src/modules/inventories/service.ts';
import type { Location } from '../../src/modules/locations/repository.ts';
import { createFakeAuditRepository } from './audit.ts';
import { bumpVersion as bump, fakeContains, fakeTransact } from './common.ts';
import { createFakeItemStore } from './items.ts';

type Row = typeof inventoryItems.$inferSelect;

/** Inventory runs on top of the item fakes, which stay reachable for test setup. */
export function createFakeInventoryStore() {
  const itemStore = createFakeItemStore();
  const state = {
    inventories: [] as Inventory[],
    rows: [] as Row[],
    users: [] as Person[],
    audit: [] as AuditEntry[],
  };

  const allLocations = itemStore.locationStore.state.locations;
  const locationById = (id: string) => allLocations.find((l) => l.id === id);
  const itemById = (id: string) => itemStore.state.items.find((i) => i.id === id)!;
  const person = (id: string | null): Person | null => (id ? (state.users.find((u) => u.id === id) ?? null) : null);

  /** The location and its active descendants, like the repository's `subtreeOf`. */
  const activeSubtree = (id: string): string[] => [
    id,
    ...allLocations.filter((l) => l.parentId === id && !l.archivedAt).flatMap((l) => activeSubtree(l.id)),
  ];
  /** The location and every descendant, archived ones too. */
  const fullSubtree = (id: string): string[] => [
    id,
    ...allLocations.filter((l) => l.parentId === id).flatMap((l) => fullSubtree(l.id)),
  ];
  const ancestorsAndSelf = (id: string): string[] => {
    const location = locationById(id);
    return location ? [id, ...(location.parentId ? ancestorsAndSelf(location.parentId) : [])] : [];
  };
  const pathOf = (l: Location): Location[] => [...(l.parentId ? pathOf(locationById(l.parentId)!) : []), l];
  // Like the repository: every word on the path, at least one in the location itself.
  const matchesSearch = (l: Location, q: string) => {
    const words = searchWords(q);
    const hit = (word: string) => (segment: Location) =>
      fakeContains(segment.name, word) || fakeContains(segment.code, word);
    return words.length === 0 || (words.some((w) => hit(w)(l)) && words.every((w) => pathOf(l).some(hit(w))));
  };

  const rowOf = (run: Inventory): InventoryRow => {
    const root = locationById(run.locationId)!;
    return {
      ...run,
      location: { id: root.id, code: root.code, name: root.name },
      startedBy: person(run.createdBy),
      closedBy: person(run.endedBy),
    };
  };
  const moment = (filter: InventoryFilter, run: Inventory) => (filter.state === 'open' ? run.createdAt : run.endedAt!);
  const matching = (filter: InventoryFilter) =>
    state.inventories.filter((run) => {
      if ((run.status === 'in_progress') !== (filter.state === 'open')) return false;
      return !filter.q || matchesSearch(locationById(run.locationId)!, filter.q);
    });
  /** Newest first, ties by id descending, like `ORDER BY moment DESC, id DESC`. */
  const newestFirst = (filter: InventoryFilter) => (a: Inventory, b: Inventory) =>
    moment(filter, b).getTime() - moment(filter, a).getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  const visible = (row: Row) =>
    (row.kind === 'expected' && !itemById(row.itemId).archivedAt) || (row.kind !== 'expected' && row.checkedAt !== null);
  const rowsOf = (inventoryId: string) => state.rows.filter((r) => r.inventoryId === inventoryId);

  const inventories: InventoryRepository = {
    async lockStarts() {},
    async findOverlapping(locationId) {
      const blocking = new Set([...ancestorsAndSelf(locationId), ...fullSubtree(locationId)]);
      const run = state.inventories
        .filter((r) => r.status === 'in_progress' && blocking.has(r.locationId))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))[0];
      return run && rowOf(run);
    },
    async findById(id) {
      const run = state.inventories.find((r) => r.id === id);
      return run && rowOf(run);
    },
    async lock(id) {
      const run = state.inventories.find((r) => r.id === id);
      return run && { ...run };
    },
    async list(filter, page) {
      let runs = matching(filter).sort(newestFirst(filter));
      if (page.cursor) {
        const key = decodeTimestampCursor(page.cursor);
        runs = runs.filter(
          (r) => moment(filter, r).toISOString() < key.at || (moment(filter, r).toISOString() === key.at && r.id < key.id),
        );
      }
      const result = toPage(runs.slice(0, page.limit + 1), page.limit, (r) => ({
        at: moment(filter, r).toISOString(),
        id: r.id,
      }));
      return { ...result, items: result.items.map(rowOf) };
    },
    async count(filter) {
      return matching(filter).length;
    },
    async insert(values) {
      const run: Inventory = {
        id: randomUUID(),
        locationId: values.locationId,
        status: 'in_progress',
        endedAt: null,
        endedBy: null,
        note: null,
        committee: null,
        createdAt: values.createdAt,
        createdBy: values.createdBy,
        updatedAt: values.createdAt,
        updatedBy: values.createdBy,
        version: 1,
      };
      state.inventories.push(run);
      return { ...run };
    },
    async snapshot(inventoryId, rootId) {
      const inside = new Set(activeSubtree(rootId));
      const items = itemStore.state.items.filter((i) => !i.archivedAt && i.locationId && inside.has(i.locationId));
      for (const item of items) {
        state.rows.push({
          id: randomUUID(),
          inventoryId,
          itemId: item.id,
          kind: 'expected',
          locationId: item.locationId!,
          registeredLocationId: null,
          checkedAt: null,
          checkedBy: null,
          method: null,
          wasMissing: false,
          movedAt: null,
          movedBy: null,
          outcome: null,
        });
      }
      return items.length;
    },
    async previewCounts(rootId) {
      const inside = new Set(activeSubtree(rootId));
      const items = itemStore.state.items.filter((i) => !i.archivedAt && i.locationId && inside.has(i.locationId));
      return { itemCount: items.length, locationCount: new Set(items.map((i) => i.locationId)).size };
    },
    async update(id, version, patch) {
      const run = state.inventories.find((r) => r.id === id);
      return run && bump(run, version, patch);
    },
    async counts(ids) {
      const counts = new Map<string, InventoryCounts>();
      for (const id of ids) {
        const rows = rowsOf(id);
        if (rows.length === 0) continue;
        const expected = rows.filter((r) => r.kind === 'expected' && !itemById(r.itemId).archivedAt);
        counts.set(id, {
          expected: expected.length,
          checked: expected.filter((r) => r.checkedAt).length,
          elsewhere: rows.filter((r) => r.kind === 'elsewhere' && r.checkedAt).length,
          new: rows.filter((r) => r.kind === 'new' && r.checkedAt).length,
          missing: rows.filter((r) => r.outcome === 'missing').length,
        });
      }
      return counts;
    },
    async participants(ids) {
      const people = new Map<string, Person[]>();
      for (const id of ids) {
        const run = state.inventories.find((r) => r.id === id)!;
        const checks = rowsOf(id)
          .filter((r) => r.checkedBy && r.checkedAt)
          .sort((a, b) => a.checkedAt!.getTime() - b.checkedAt!.getTime());
        const list: Person[] = [];
        for (const userId of [run.createdBy, ...checks.map((r) => r.checkedBy)]) {
          const found = person(userId);
          if (found && !list.some((p) => p.id === found.id)) list.push(found);
        }
        if (list.length > 0) people.set(id, list);
      }
      return people;
    },
    async locationProgress(inventoryId) {
      const byLocation = new Map<string, { total: number; checked: number }>();
      for (const row of rowsOf(inventoryId).filter(visible)) {
        const entry = byLocation.get(row.locationId) ?? { total: 0, checked: 0 };
        entry.total += 1;
        if (row.checkedAt) entry.checked += 1;
        byLocation.set(row.locationId, entry);
      }
      return [...byLocation].map(([locationId, numbers]) => ({ locationId, ...numbers }));
    },
    async locationCheckers(inventoryId) {
      const checks = rowsOf(inventoryId)
        .filter((r) => r.checkedBy && r.checkedAt)
        .sort((a, b) => a.checkedAt!.getTime() - b.checkedAt!.getTime());
      const seen: { locationId: string; id: string; name: string }[] = [];
      for (const row of checks) {
        const found = person(row.checkedBy);
        if (found && !seen.some((s) => s.locationId === row.locationId && s.id === found.id)) {
          seen.push({ locationId: row.locationId, ...found });
        }
      }
      return seen;
    },
    async recentCheckers(inventoryId, since) {
      const latest = new Map<string, number>();
      for (const row of rowsOf(inventoryId)) {
        if (!row.checkedBy || !row.checkedAt || row.checkedAt < since) continue;
        latest.set(row.checkedBy, Math.max(latest.get(row.checkedBy) ?? 0, row.checkedAt.getTime()));
      }
      return [...latest]
        .sort((a, b) => b[1] - a[1])
        .map(([userId]) => person(userId)!)
        .filter(Boolean);
    },
  };

  const repos: InventoryRepos = {
    inventories,
    locations: itemStore.repos.locations,
    audit: createFakeAuditRepository(state.audit),
  };

  const snapshot = () => {
    const copy = structuredClone(state);
    const restoreItems = itemStore.snapshot();
    return () => {
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        state[key].splice(0, state[key].length, ...(copy[key] as never[]));
      }
      restoreItems();
    };
  };

  return {
    state,
    repos,
    snapshot,
    transact: fakeTransact(repos, { snapshot }),
    itemStore,
    /** Test setup shortcuts that skip the services. */
    addUser(name: string): Person {
      const user = { id: randomUUID(), name };
      state.users.push(user);
      return user;
    },
    addItem: (locationId: string | null, name = 'Kávovar') =>
      itemStore.repos.items.insert({ name, locationId, createdBy: 'setup' }),
    /** Marks the run's row for the item as checked, as a later check service will. */
    check(inventoryId: string, itemId: string, userId: string, at = new Date(), method: 'scan' | 'manual' = 'manual') {
      const row = state.rows.find((r) => r.inventoryId === inventoryId && r.itemId === itemId)!;
      Object.assign(row, { checkedAt: at, checkedBy: userId, method });
    },
  };
}
