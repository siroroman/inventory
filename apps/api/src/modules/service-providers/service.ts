import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields, initialFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createManufacturerRepository, type ManufacturerRepository } from '../manufacturers/repository.ts';
import {
  createServiceProviderRepository,
  type ServiceProvider,
  type ServiceProviderFilter,
  type ServiceProviderRepository,
  type ServicedBrand,
} from './repository.ts';

export type ServiceProviderRepos = {
  serviceProviders: ServiceProviderRepository;
  /** Holds the ranked links, so brand changes rewrite the affected manufacturers' orders. */
  manufacturers: ManufacturerRepository;
  audit: AuditRepository;
};

export const serviceProviderRepos = (db: DbExecutor): ServiceProviderRepos => ({
  serviceProviders: createServiceProviderRepository(db),
  manufacturers: createManufacturerRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. */
export type ServiceProviderDeps = { repos: ServiceProviderRepos; transact: Transact<ServiceProviderRepos> };

/** A provider with the brands it services and its priority for each. */
export type ServiceProviderDetail = ServiceProvider & { manufacturers: ServicedBrand[] };

export type CreateServiceProviderInput = {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  web?: string | null;
  note?: string | null;
  /** The brands the provider services (see `setManufacturers`). */
  manufacturerIds?: string[];
};
export type UpdateServiceProviderInput = Partial<CreateServiceProviderInput> & { version: number };

const AUDITED = ['code', 'name', 'contactPerson', 'phone', 'email', 'web', 'note'] as const;
const EDITABLE = ['name', 'contactPerson', 'phone', 'email', 'web', 'note'] as const;

async function loadCurrent(r: ServiceProviderRepos, id: string, version: number): Promise<ServiceProvider> {
  const current = await r.serviceProviders.findById(id);
  if (!current) throw new DomainError('not_found');
  if (current.version !== version) throw new DomainError('conflict');
  return current;
}

/**
 * Makes `ids` the brands the provider services, inside the caller's transaction. A new brand ranks
 * the provider last; a dropped brand closes the gap in its order. Only active brands can be added;
 * leaving an archived brand is allowed. Every manufacturer whose order changes gets an audit entry;
 * the provider's own entry and version bump are the caller's.
 */
async function applyBrands(r: ServiceProviderRepos, actor: Actor, providerId: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new DomainError('duplicate_manufacturer');

  const before = (await r.serviceProviders.listManufacturers(providerId)).map((m) => m.id);
  const added = ids.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !ids.includes(m));
  for (const manufacturerId of added) {
    const manufacturer = await r.manufacturers.findById(manufacturerId);
    if (!manufacturer) throw new DomainError('manufacturer_not_found', { manufacturerId });
    if (manufacturer.archivedAt) throw new DomainError('manufacturer_archived', { manufacturerId });
  }
  if (!added.length && !removed.length) return undefined;

  for (const manufacturerId of [...added, ...removed]) {
    const order = (await r.manufacturers.listProviders(manufacturerId)).map((p) => p.id);
    const next = added.includes(manufacturerId) ? [...order, providerId] : order.filter((p) => p !== providerId);
    await r.manufacturers.replaceProviders(manufacturerId, next, actor.id);
    await r.audit.record({
      userId: actor.id,
      entityType: 'manufacturer',
      entityId: manufacturerId,
      action: 'update',
      changes: { providers: { from: order, to: next } },
    });
  }
  return { manufacturers: { from: before, to: [...before.filter((m) => !removed.includes(m)), ...added] } };
}

async function withBrands(r: ServiceProviderRepos, row: ServiceProvider): Promise<ServiceProviderDetail> {
  return { ...row, manufacturers: await r.serviceProviders.listManufacturers(row.id) };
}

export function createServiceProviderService({ repos, transact }: ServiceProviderDeps) {
  async function setArchived(actor: Actor, id: string, version: number, archive: boolean): Promise<ServiceProvider> {
    assertRole(actor, 'write');
    return transact(async (r) => {
      const current = await loadCurrent(r, id, version);
      if (archive && current.archivedAt) throw new DomainError('archived');
      if (!archive && !current.archivedAt) throw new DomainError('not_archived');
      const row = await r.serviceProviders.setArchived(id, version, archive, actor.id);
      if (!row) throw new DomainError('conflict');
      await r.audit.record({
        userId: actor.id,
        entityType: 'service_provider',
        entityId: id,
        action: archive ? 'archive' : 'restore',
      });
      return row;
    });
  }

  return {
    /** Detail: archived providers are returned too, so they can be viewed and restored. */
    async get(actor: Actor, id: string): Promise<ServiceProviderDetail> {
      assertRole(actor, 'read');
      const row = await repos.serviceProviders.findById(id);
      if (!row) throw new DomainError('not_found');
      return { ...row, manufacturers: await repos.serviceProviders.listManufacturers(id) };
    },

    /** Active (or archived) providers by name, plus the total for the list heading. */
    async list(
      actor: Actor,
      filter: ServiceProviderFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<ServiceProvider> & { total: number }> {
      assertRole(actor, 'read');
      const [result, total] = await Promise.all([
        repos.serviceProviders.list(filter, page),
        repos.serviceProviders.count(filter),
      ]);
      return { ...result, total };
    },

    async create(actor: Actor, input: CreateServiceProviderInput): Promise<ServiceProviderDetail> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const row = await r.serviceProviders.insert({
          name: input.name,
          contactPerson: input.contactPerson ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          web: input.web ?? null,
          note: input.note ?? null,
          createdBy: actor.id,
        });
        const brands = await applyBrands(r, actor, row.id, input.manufacturerIds ?? []);
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_provider',
          entityId: row.id,
          action: 'create',
          changes: { ...initialFields(row, AUDITED), ...brands },
        });
        return withBrands(r, row);
      });
    },

    /**
     * Edits the sent fields and, when `manufacturerIds` is sent, the brands in the same transaction
     * (see `setManufacturers`). A save that changes nothing but leaves the brands as they are
     * writes nothing; any other save bumps the version once.
     */
    async update(actor: Actor, id: string, input: UpdateServiceProviderInput): Promise<ServiceProviderDetail> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const current = await loadCurrent(r, id, input.version);
        if (current.archivedAt) throw new DomainError('archived');
        const patch = Object.fromEntries(EDITABLE.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
        const brands = input.manufacturerIds && (await applyBrands(r, actor, id, input.manufacturerIds));
        if (input.manufacturerIds && !brands && Object.keys(patch).length === 0) return withBrands(r, current);

        const updated = await r.serviceProviders.update(id, input.version, { ...patch, updatedBy: actor.id });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_provider',
          entityId: id,
          action: 'update',
          changes: { ...changedFields(current, updated, AUDITED), ...brands },
        });
        return withBrands(r, updated);
      });
    },

    /**
     * Sets which brands the provider services. A new brand ranks the provider last; a dropped
     * brand closes the gap in its order. Per-brand order is changed on the manufacturer
     * (`setProviders`). Only active brands can be added; leaving an archived brand is allowed.
     * A change bumps the provider's version like any edit, so a stale form gets a conflict.
     */
    async setManufacturers(
      actor: Actor,
      id: string,
      version: number,
      manufacturerIds: string[],
    ): Promise<ServiceProviderDetail> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const current = await loadCurrent(r, id, version);
        if (current.archivedAt) throw new DomainError('archived');
        const brands = await applyBrands(r, actor, id, manufacturerIds);
        if (!brands) return withBrands(r, current);

        const touched = await r.serviceProviders.update(id, version, { updatedBy: actor.id });
        if (!touched) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_provider',
          entityId: id,
          action: 'update',
          changes: brands,
        });
        return withBrands(r, touched);
      });
    },

    archive: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, true),
    restore: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, false),
  };
}

export type ServiceProviderService = ReturnType<typeof createServiceProviderService>;
