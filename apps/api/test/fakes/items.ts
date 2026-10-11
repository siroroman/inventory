import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type { ExternalId, Item, ItemRepository } from '../../src/modules/items/repository.ts';
import type { ItemInventories, ItemRepos } from '../../src/modules/items/service.ts';
import { createFakeAuditRepository } from './audit.ts';
import { createFakeCatalogStore } from './catalog.ts';
import { bumpVersion as bump, fakeContains, fakePageByName, fakeTransact } from './common.ts';
import { createFakeLocationStore } from './locations.ts';

/** Items on top of the location and catalog fakes, which stay reachable for test setup. */
export function createFakeItemStore() {
  const locationStore = createFakeLocationStore();
  const catalog = createFakeCatalogStore();
  const state = {
    items: [] as Item[],
    externalIds: [] as ExternalId[],
    audit: [] as AuditEntry[],
    /** Inventory runs an item can be created for (the root and the state are all the items need). */
    runs: [] as { id: string; locationId: string; status: 'in_progress' | 'finished' | 'cancelled' }[],
    /** The rows `recordNew` added to runs. */
    addedToRuns: [] as {
      inventoryId: string;
      itemId: string;
      locationId: string;
      checkedAt: Date;
      checkedBy: string;
      method: string;
    }[],
  };
  const { locations } = locationStore.repos;
  const { manufacturers } = catalog.repos;

  const byId = (id: string) => state.items.find((i) => i.id === id);
  const now = () => new Date();
  const manufacturerRef = async (id: string | null) => {
    const m = id ? await manufacturers.findById(id) : undefined;
    return m ? { id: m.id, name: m.name } : null;
  };
  /** The location and its active descendants, like the repository's recursive query. */
  const subtree = (id: string): string[] => [
    id,
    ...locationStore.state.locations.filter((l) => l.parentId === id && !l.archivedAt).flatMap((l) => subtree(l.id)),
  ];
  const idsOf = (itemId: string) => state.externalIds.filter((e) => e.itemId === itemId);

  const matching = (filter: Parameters<ItemRepository['list']>[0]) =>
    state.items.filter((item) => {
      if (!!item.archivedAt !== !!filter.archived) return false;
      if (filter.locationId && !(item.locationId && subtree(filter.locationId).includes(item.locationId))) return false;
      if (filter.manufacturerId && item.manufacturerId !== filter.manufacturerId) return false;
      if (!filter.q) return true;
      const manufacturer = catalog.state.manufacturers.find((m) => m.id === item.manufacturerId);
      return [item.name, item.code, item.serialNumber, item.model, manufacturer?.name, ...idsOf(item.id).map((e) => e.value)].some(
        (text) => fakeContains(text, filter.q!),
      );
    });

  const items: ItemRepository = {
    async findById(id) {
      const row = byId(id);
      return row && { ...row, manufacturer: await manufacturerRef(row.manufacturerId) };
    },
    async list(filter, page) {
      const result = fakePageByName(matching(filter), page);
      const rows = await Promise.all(
        result.items.map(async (item) => {
          const location = item.locationId ? (await locations.findById(item.locationId))! : null;
          return {
            ...item,
            manufacturer: await manufacturerRef(item.manufacturerId),
            location: location && { id: location.id, code: location.code, name: location.name },
            thumbnailKey: null,
          };
        }),
      );
      return { ...result, items: rows };
    },
    async listForLabels(filter, limit) {
      const rows = matching({ ...filter, archived: false });
      // By ID with the numbers in it compared by value, like `ORDER BY code COLLATE cs_cz_numeric`.
      const collator = new Intl.Collator('cs', { numeric: true });
      return rows
        .sort((a, b) => collator.compare(a.code, b.code) || (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map(({ id, code, name, locationId }) => ({ id, code, name, locationId }));
    },
    async count(filter) {
      return matching(filter).length;
    },
    async insert(values) {
      const row: Item = {
        id: randomUUID(),
        code: values.code ?? `INV-${String(state.items.length + 1).padStart(5, '0')}`,
        name: values.name,
        locationId: values.locationId ?? null,
        manufacturerId: values.manufacturerId ?? null,
        model: values.model ?? null,
        serialNumber: values.serialNumber ?? null,
        manufactureYear: values.manufactureYear ?? null,
        registeredOn: values.registeredOn ?? null,
        purchasePrice: values.purchasePrice ?? null,
        warrantyUntil: values.warrantyUntil ?? null,
        lastServiceOn: values.lastServiceOn ?? null,
        nextServiceOn: values.nextServiceOn ?? null,
        documentsUrl: values.documentsUrl ?? null,
        note: values.note ?? null,
        createdAt: now(),
        createdBy: values.createdBy,
        updatedAt: now(),
        updatedBy: values.createdBy,
        archivedAt: null,
        version: 1,
      };
      state.items.push(row);
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
    async listExternalIds(itemId) {
      return idsOf(itemId).map((e) => ({ ...e }));
    },
    async findExternalIdClashes(ids, exceptItemId) {
      const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      return state.externalIds
        .filter((e) => e.itemId !== exceptItemId && ids.some((id) => same(id.source, e.source) && same(id.value, e.value)))
        .map((e) => ({ source: e.source, value: e.value, itemCode: byId(e.itemId)!.code }));
    },
    async replaceExternalIds(itemId, ids, by) {
      state.externalIds.splice(0, state.externalIds.length, ...state.externalIds.filter((e) => e.itemId !== itemId));
      const rows = ids.map(
        (id): ExternalId => ({ id: randomUUID(), itemId, source: id.source, value: id.value, createdAt: now(), createdBy: by }),
      );
      for (const row of rows) {
        // The unique index on lower(source), lower(value) spans all items, archived ones too.
        const taken = state.externalIds.some(
          (e) => e.source.toLowerCase() === row.source.toLowerCase() && e.value.toLowerCase() === row.value.toLowerCase(),
        );
        if (taken) {
          throw Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'item_external_ids_source_value_key',
          });
        }
        state.externalIds.push(row);
      }
      return rows.map((row) => ({ ...row }));
    },
  };

  const inventories: ItemInventories = {
    async lockShared(id) {
      const run = state.runs.find((r) => r.id === id);
      return run && ({ ...run } as Awaited<ReturnType<ItemInventories['lockShared']>>);
    },
    async recordNew(inventoryId, itemId, added) {
      state.addedToRuns.push({ inventoryId, itemId, ...added });
    },
  };

  const repos: ItemRepos = { items, locations, manufacturers, inventories, audit: createFakeAuditRepository(state.audit) };

  const snapshot = () => {
    const copy = structuredClone(state);
    const restoreLocations = locationStore.snapshot();
    const restoreCatalog = catalog.snapshot();
    return () => {
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        state[key].splice(0, state[key].length, ...(copy[key] as never[]));
      }
      restoreLocations();
      restoreCatalog();
    };
  };

  return {
    state,
    repos,
    snapshot,
    transact: fakeTransact(repos, { snapshot }),
    locationStore,
    catalog,
    /** Test setup shortcuts that skip the services. */
    addLocation: (name: string, parentId?: string) =>
      locations.insert({
        name,
        parentId: parentId ?? null,
        locationTypeId: parentId ? null : locationStore.typeId('HQ'),
        createdBy: 'setup',
      }),
  };
}
