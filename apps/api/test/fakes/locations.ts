import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type {
  Location,
  LocationRepository,
  LocationType,
  LocationTypeRepository,
  PathSegment,
} from '../../src/modules/locations/repository.ts';
import type { LocationRepos } from '../../src/modules/locations/service.ts';
import { createFakeAuditRepository } from './audit.ts';
import { bumpVersion as bump, fakeContains, fakePageByName, fakeTransact } from './common.ts';

type FakeItem = { locationId: string; archived: boolean };

export function createFakeLocationStore() {
  const state = {
    types: [] as LocationType[],
    locations: [] as Location[],
    items: [] as FakeItem[],
    audit: [] as AuditEntry[],
  };

  const now = () => new Date();
  const base = { createdAt: now(), updatedAt: now(), createdBy: null, updatedBy: null, archivedAt: null, version: 1 };
  ['HQ', 'STORE', 'SITE', 'WAREHOUSE'].forEach((code, i) =>
    state.types.push({ ...base, id: randomUUID(), code, name: code, sortOrder: i + 1 }),
  );

  const byId = (id: string) => state.locations.find((l) => l.id === id);
  const withType = (l: Location) => {
    const t = state.types.find((type) => type.id === l.locationTypeId);
    return { ...l, type: t ? { id: t.id, code: t.code, name: t.name } : null };
  };
  const activeChildren = (id: string) => state.locations.filter((l) => l.parentId === id && !l.archivedAt);
  const subtree = (id: string): string[] => [id, ...activeChildren(id).flatMap((c) => subtree(c.id))];

  const locations: LocationRepository = {
    async findById(id) {
      const row = byId(id);
      return row && withType(row);
    },
    async list(filter, page) {
      const rows = state.locations.filter(
        (l) =>
          !l.archivedAt &&
          (filter.parentId === undefined || l.parentId === filter.parentId) &&
          (!filter.q || fakeContains(l.name, filter.q)),
      );
      const result = fakePageByName(rows, page);
      return { ...result, items: result.items.map(withType) };
    },
    async count(filter) {
      return (await locations.list(filter, { limit: Number.MAX_SAFE_INTEGER })).items.length;
    },
    async findPaths(ids) {
      const paths = new Map<string, PathSegment[]>();
      for (const id of ids) {
        const path: PathSegment[] = [];
        for (let l = byId(id); l; l = l.parentId ? byId(l.parentId) : undefined) {
          path.unshift({ id: l.id, code: l.code, name: l.name });
        }
        if (path.length) paths.set(id, path);
      }
      return paths;
    },
    async countSubtree(ids) {
      return new Map(
        ids.map((id) => {
          const tree = subtree(id);
          const itemCount = state.items.filter((i) => !i.archived && tree.includes(i.locationId)).length;
          return [id, { itemCount, childCount: activeChildren(id).length }];
        }),
      );
    },
    async insert(values) {
      const row: Location = {
        id: randomUUID(),
        code: values.code ?? `LOC-${String(state.locations.length + 1).padStart(3, '0')}`,
        name: values.name,
        parentId: values.parentId ?? null,
        locationTypeId: values.locationTypeId ?? null,
        address: values.address ?? null,
        note: values.note ?? null,
        createdAt: now(),
        createdBy: values.createdBy,
        updatedAt: now(),
        updatedBy: values.createdBy,
        archivedAt: null,
        version: 1,
      };
      state.locations.push(row);
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

  const locationTypes: LocationTypeRepository = {
    async findById(id) {
      const row = state.types.find((t) => t.id === id);
      return row && { ...row };
    },
    async list() {
      return state.types.filter((t) => !t.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async insert(values) {
      const row: LocationType = {
        ...base,
        id: randomUUID(),
        code: values.code,
        name: values.name,
        sortOrder: values.sortOrder ?? 0,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      };
      state.types.push(row);
      return { ...row };
    },
    async update(id, version, patch) {
      const row = state.types.find((t) => t.id === id);
      return row && bump(row, version, patch);
    },
  };

  const repos: LocationRepos = { locations, locationTypes, audit: createFakeAuditRepository(state.audit) };

  const snapshot = () => {
    const copy = structuredClone(state);
    return () => {
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        state[key].splice(0, state[key].length, ...(copy[key] as never[]));
      }
    };
  };

  return {
    state,
    repos,
    snapshot,
    transact: fakeTransact(repos, { snapshot }),
    typeId: (code: string) => state.types.find((t) => t.code === code)!.id,
    addItem: (locationId: string, archived = false) => state.items.push({ locationId, archived }),
  };
}
