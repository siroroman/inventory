import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type { Manufacturer, ManufacturerRepository } from '../../src/modules/manufacturers/repository.ts';
import type { ManufacturerRepos } from '../../src/modules/manufacturers/service.ts';
import type { ServiceProvider, ServiceProviderRepository } from '../../src/modules/service-providers/repository.ts';
import { createFakeAuditRepository } from './audit.ts';
import { bumpVersion as bump, fakeContains, fakePageByName, fakeTransact } from './common.ts';

type Link = { manufacturerId: string; providerId: string; priority: number };

/** Manufacturers, service providers and the ranked links between them. */
export function createFakeCatalogStore() {
  const state = {
    manufacturers: [] as Manufacturer[],
    providers: [] as ServiceProvider[],
    links: [] as Link[],
    audit: [] as AuditEntry[],
  };

  const now = () => new Date();
  const base = () => ({
    createdAt: now(),
    updatedAt: now(),
    updatedBy: null,
    archivedAt: null,
    version: 1,
  });
  const manufacturerById = (id: string) => state.manufacturers.find((m) => m.id === id);
  const providerById = (id: string) => state.providers.find((p) => p.id === id);
  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const manufacturers: ManufacturerRepository = {
    async findById(id) {
      const row = manufacturerById(id);
      return row && { ...row };
    },
    async findByName(name) {
      const row = state.manufacturers.find((m) => sameName(m.name, name));
      return row && { ...row };
    },
    async list(filter, page) {
      const rows = state.manufacturers.filter((m) => !m.archivedAt && (!filter.q || fakeContains(m.name, filter.q)));
      return fakePageByName(rows, page);
    },
    async count(filter) {
      return (await manufacturers.list(filter, { limit: Number.MAX_SAFE_INTEGER })).items.length;
    },
    async insert(values) {
      // The unique index on lower(name) applies to archived rows too.
      if (state.manufacturers.some((m) => sameName(m.name, values.name))) {
        throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'manufacturers_name_lower_key' });
      }
      const row: Manufacturer = {
        ...base(),
        id: randomUUID(),
        name: values.name,
        note: values.note ?? null,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      };
      state.manufacturers.push(row);
      return { ...row };
    },
    async update(id, version, patch) {
      const row = manufacturerById(id);
      return row && bump(row, version, patch);
    },
    async setArchived(id, version, archived, by) {
      const row = manufacturerById(id);
      return row && bump(row, version, { archivedAt: archived ? now() : null, updatedBy: by });
    },
    async listProviders(manufacturerId) {
      return state.links
        .filter((l) => l.manufacturerId === manufacturerId)
        .sort((a, b) => a.priority - b.priority)
        .map((l) => ({ ...providerById(l.providerId)!, priority: l.priority }));
    },
    async replaceProviders(manufacturerId, providerIds) {
      const others = state.links.filter((l) => l.manufacturerId !== manufacturerId);
      const ranked = providerIds.map((providerId, index) => ({ manufacturerId, providerId, priority: index + 1 }));
      state.links.splice(0, state.links.length, ...others, ...ranked);
    },
  };

  const serviceProviders: ServiceProviderRepository = {
    async findById(id) {
      const row = providerById(id);
      return row && { ...row };
    },
    async list(filter, page) {
      const rows = state.providers.filter((p) => !p.archivedAt && (!filter.q || fakeContains(p.name, filter.q)));
      return fakePageByName(rows, page);
    },
    async count(filter) {
      return (await serviceProviders.list(filter, { limit: Number.MAX_SAFE_INTEGER })).items.length;
    },
    async insert(values) {
      const row: ServiceProvider = {
        ...base(),
        id: randomUUID(),
        code: values.code ?? `SUP-${String(state.providers.length + 1).padStart(3, '0')}`,
        name: values.name,
        contactPerson: values.contactPerson ?? null,
        phone: values.phone ?? null,
        email: values.email ?? null,
        web: values.web ?? null,
        note: values.note ?? null,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      };
      state.providers.push(row);
      return { ...row };
    },
    async update(id, version, patch) {
      const row = providerById(id);
      return row && bump(row, version, patch);
    },
    async setArchived(id, version, archived, by) {
      const row = providerById(id);
      return row && bump(row, version, { archivedAt: archived ? now() : null, updatedBy: by });
    },
    async listManufacturers(providerId) {
      return state.links
        .filter((l) => l.providerId === providerId)
        .map((l) => {
          const m = manufacturerById(l.manufacturerId)!;
          return { id: m.id, name: m.name, archivedAt: m.archivedAt, priority: l.priority };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    },
  };

  const repos: ManufacturerRepos = { manufacturers, serviceProviders, audit: createFakeAuditRepository(state.audit) };

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
    /** Test setup shortcuts that skip the services. */
    addProvider: (name: string, archived = false) =>
      serviceProviders.insert({ name, createdBy: 'setup' }).then((row) => {
        if (archived) providerById(row.id)!.archivedAt = now();
        return row;
      }),
    addManufacturer: (name: string) => manufacturers.insert({ name, createdBy: 'setup' }),
  };
}
