import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields, initialFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createServiceProviderRepository, type ServiceProviderRepository } from '../service-providers/repository.ts';
import {
  createManufacturerRepository,
  type Manufacturer,
  type ManufacturerFilter,
  type ManufacturerRepository,
  type RankedProvider,
} from './repository.ts';

export type ManufacturerRepos = {
  manufacturers: ManufacturerRepository;
  /** Read-only here: providers are validated before they are ranked. */
  serviceProviders: ServiceProviderRepository;
  audit: AuditRepository;
};

export const manufacturerRepos = (db: DbExecutor): ManufacturerRepos => ({
  manufacturers: createManufacturerRepository(db),
  serviceProviders: createServiceProviderRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. */
export type ManufacturerDeps = { repos: ManufacturerRepos; transact: Transact<ManufacturerRepos> };

/** A manufacturer with its service providers in the order to contact them. */
export type ManufacturerDetail = Manufacturer & { providers: RankedProvider[] };

export type CreateManufacturerInput = { name: string; note?: string | null };
export type UpdateManufacturerInput = Partial<CreateManufacturerInput> & { version: number };

const AUDITED = ['name', 'note'] as const;

async function loadCurrent(r: ManufacturerRepos, id: string, version: number): Promise<Manufacturer> {
  const current = await r.manufacturers.findById(id);
  if (!current) throw new DomainError('not_found');
  if (current.version !== version) throw new DomainError('conflict');
  return current;
}

async function insertManufacturer(r: ManufacturerRepos, actor: Actor, input: CreateManufacturerInput) {
  const row = await r.manufacturers.insert({ name: input.name, note: input.note ?? null, createdBy: actor.id });
  await r.audit.record({
    userId: actor.id,
    entityType: 'manufacturer',
    entityId: row.id,
    action: 'create',
    changes: initialFields(row, AUDITED),
  });
  return row;
}

export function createManufacturerService({ repos, transact }: ManufacturerDeps) {
  async function setArchived(actor: Actor, id: string, version: number, archive: boolean): Promise<Manufacturer> {
    assertRole(actor, 'write');
    return transact(async (r) => {
      const current = await loadCurrent(r, id, version);
      if (archive && current.archivedAt) throw new DomainError('archived');
      if (!archive && !current.archivedAt) throw new DomainError('not_archived');
      const row = await r.manufacturers.setArchived(id, version, archive, actor.id);
      if (!row) throw new DomainError('conflict');
      await r.audit.record({
        userId: actor.id,
        entityType: 'manufacturer',
        entityId: id,
        action: archive ? 'archive' : 'restore',
      });
      return row;
    });
  }

  return {
    /** Detail: archived manufacturers are returned too, so they can be viewed and restored. */
    async get(actor: Actor, id: string): Promise<ManufacturerDetail> {
      assertRole(actor, 'read');
      const row = await repos.manufacturers.findById(id);
      if (!row) throw new DomainError('not_found');
      return { ...row, providers: await repos.manufacturers.listProviders(id) };
    },

    /** Active manufacturers by name, plus the total for the list heading. */
    async list(
      actor: Actor,
      filter: ManufacturerFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<Manufacturer> & { total: number }> {
      assertRole(actor, 'read');
      const [result, total] = await Promise.all([
        repos.manufacturers.list(filter, page),
        repos.manufacturers.count(filter),
      ]);
      return { ...result, total };
    },

    async create(actor: Actor, input: CreateManufacturerInput): Promise<Manufacturer> {
      assertRole(actor, 'write');
      return transact((r) => insertManufacturer(r, actor, input));
    },

    /**
     * For a name typed into a form: returns the manufacturer with that name (case-insensitive),
     * restoring it if archived, or creates it. Never fails on a name that already exists.
     */
    async findOrCreateByName(actor: Actor, name: string): Promise<Manufacturer> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const existing = await r.manufacturers.findByName(name);
        if (!existing) return insertManufacturer(r, actor, { name });
        if (!existing.archivedAt) return existing;
        const restored = await r.manufacturers.setArchived(existing.id, existing.version, false, actor.id);
        if (!restored) throw new DomainError('conflict');
        await r.audit.record({ userId: actor.id, entityType: 'manufacturer', entityId: existing.id, action: 'restore' });
        return restored;
      });
    },

    async update(actor: Actor, id: string, input: UpdateManufacturerInput): Promise<Manufacturer> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const current = await loadCurrent(r, id, input.version);
        if (current.archivedAt) throw new DomainError('archived');
        const updated = await r.manufacturers.update(id, input.version, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.note !== undefined && { note: input.note }),
          updatedBy: actor.id,
        });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'manufacturer',
          entityId: id,
          action: 'update',
          changes: changedFields(current, updated, AUDITED),
        });
        return updated;
      });
    },

    /**
     * Saves the whole provider order at once: the first id gets priority 1. The list must not
     * repeat a provider and may only add active providers (already ranked ones stay even if
     * archived); an empty list clears the order.
     * There is no version: the last saved order wins.
     */
    async setProviders(actor: Actor, id: string, providerIds: string[]): Promise<RankedProvider[]> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const current = await r.manufacturers.findById(id);
        if (!current) throw new DomainError('not_found');
        if (current.archivedAt) throw new DomainError('archived');
        if (new Set(providerIds).size !== providerIds.length) throw new DomainError('duplicate_provider');

        const before = (await r.manufacturers.listProviders(id)).map((p) => p.id);
        for (const providerId of providerIds) {
          const provider = await r.serviceProviders.findById(providerId);
          if (!provider) throw new DomainError('provider_not_found', { providerId });
          // A provider archived after it was ranked stays in the order; only new ones must be active.
          if (provider.archivedAt && !before.includes(providerId)) {
            throw new DomainError('provider_archived', { providerId });
          }
        }

        await r.manufacturers.replaceProviders(id, providerIds, actor.id);
        if (before.join() !== providerIds.join()) {
          await r.audit.record({
            userId: actor.id,
            entityType: 'manufacturer',
            entityId: id,
            action: 'update',
            changes: { providers: { from: before, to: providerIds } },
          });
        }
        return r.manufacturers.listProviders(id);
      });
    },

    archive: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, true),
    restore: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, false),
  };
}

export type ManufacturerService = ReturnType<typeof createManufacturerService>;
