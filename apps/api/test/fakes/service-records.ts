import { randomUUID } from 'node:crypto';
import { decodeDateCursor, toPage } from '../../src/db/pagination.ts';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type {
  ServiceRecord,
  ServiceRecordFilter,
  ServiceRecordRepository,
} from '../../src/modules/service-records/repository.ts';
import type { ServiceRecordRepos } from '../../src/modules/service-records/service.ts';
import { createFakeAuditRepository } from './audit.ts';
import { bumpVersion as bump, fakeContains, fakeTransact } from './common.ts';
import { createFakeItemStore } from './items.ts';

/** Service records on top of the item fakes, which stay reachable for test setup. */
export function createFakeServiceRecordStore() {
  const itemStore = createFakeItemStore();
  const state = { records: [] as ServiceRecord[], audit: [] as AuditEntry[] };

  const byId = (id: string) => state.records.find((r) => r.id === id);
  const now = () => new Date();
  /** Newest first, ties by id descending, like `ORDER BY performed_on DESC, id DESC`. */
  const newestFirst = (a: ServiceRecord, b: ServiceRecord) =>
    a.performedOn < b.performedOn ? 1 : a.performedOn > b.performedOn ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  const activeOf = (itemId: string) => state.records.filter((r) => r.itemId === itemId && !r.archivedAt);

  const locationRows = itemStore.locationStore.state.locations;
  /** Like `locationsMatching`: a location whose name matches, or one below it that is reachable through active ones. */
  const locationMatches = (locationId: string | null, q: string, archived: boolean) => {
    const chain: typeof locationRows = [];
    for (let l = locationRows.find((x) => x.id === locationId); l; l = locationRows.find((x) => x.id === l!.parentId)) {
      chain.push(l);
    }
    return chain.some((l, i) => fakeContains(l.name, q) && (archived || chain.slice(0, i + 1).every((c) => !c.archivedAt)));
  };
  const matching = (filter: ServiceRecordFilter) =>
    state.records.filter((r) => {
      if (!!r.archivedAt !== !!filter.archived) return false;
      if (!filter.q) return true;
      const item = itemStore.state.items.find((i) => i.id === r.itemId)!;
      return (
        fakeContains(r.title, filter.q) ||
        fakeContains(item.name, filter.q) ||
        fakeContains(item.code, filter.q) ||
        locationMatches(item.locationId, filter.q, Boolean(filter.archived))
      );
    });

  const serviceRecords: ServiceRecordRepository = {
    async findById(id) {
      const row = byId(id);
      return row && { ...row };
    },
    async listByItem(itemId, page) {
      let rows = activeOf(itemId).sort(newestFirst);
      if (page.cursor) {
        const key = decodeDateCursor(page.cursor);
        rows = rows.filter((r) => newestFirst(r, { ...r, performedOn: key.on, id: key.id }) > 0);
      }
      return toPage(rows.slice(0, page.limit + 1), page.limit, (r) => ({ on: r.performedOn, id: r.id }));
    },
    async list(filter, page) {
      let rows = matching(filter).sort(newestFirst);
      if (page.cursor) {
        const key = decodeDateCursor(page.cursor);
        rows = rows.filter((r) => newestFirst(r, { ...r, performedOn: key.on, id: key.id }) > 0);
      }
      const result = toPage(rows.slice(0, page.limit + 1), page.limit, (r) => ({ on: r.performedOn, id: r.id }));
      const withItem = await Promise.all(
        result.items.map(async (r) => {
          const item = (await itemStore.repos.items.findById(r.itemId))!;
          const location = item.locationId ? (await itemStore.repos.locations.findById(item.locationId))! : null;
          return {
            ...r,
            item: { id: item.id, code: item.code, name: item.name },
            location: location && { id: location.id, code: location.code, name: location.name },
          };
        }),
      );
      return { ...result, items: withItem };
    },
    async count(filter) {
      return matching(filter).length;
    },
    async countByItem(itemId) {
      return activeOf(itemId).length;
    },
    async insert(values) {
      const row: ServiceRecord = {
        id: randomUUID(),
        itemId: values.itemId,
        performedOn: values.performedOn,
        title: values.title,
        performedBy: values.performedBy ?? null,
        responsiblePerson: values.responsiblePerson ?? null,
        description: values.description ?? null,
        createdAt: now(),
        createdBy: values.createdBy,
        updatedAt: now(),
        updatedBy: values.createdBy,
        archivedAt: null,
        version: 1,
      };
      state.records.push(row);
      return { ...row };
    },
    async update(id, version, patch) {
      const row = byId(id);
      return row && bump(row, version, patch);
    },
    async setArchived(id, version, archived, by) {
      const row = byId(id);
      return row && bump(row, version, { archivedAt: archived ? now() : null, updatedBy: by });
    },
  };

  const repos: ServiceRecordRepos = {
    serviceRecords,
    items: itemStore.repos.items,
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
    async addItem(name = 'Kávovar') {
      const location = await itemStore.addLocation('Kuchyně');
      return itemStore.repos.items.insert({ name, locationId: location.id, createdBy: 'setup' });
    },
    addRecord: (itemId: string, values: Partial<Parameters<ServiceRecordRepository['insert']>[0]> = {}) =>
      serviceRecords.insert({ itemId, performedOn: '2026-04-15', title: 'Výměna filtru', createdBy: 'setup', ...values }),
  };
}
