import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields, initialFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createLocationRepository, type LocationRepository, type PathSegment } from '../locations/repository.ts';
import { createManufacturerRepository, type ManufacturerRepository } from '../manufacturers/repository.ts';
import {
  createItemRepository,
  type ExternalId,
  type ExternalIdInput,
  type ItemFilter,
  type ItemListRow,
  type ItemRepository,
  type ItemWithManufacturer,
} from './repository.ts';

export type ItemRepos = {
  items: ItemRepository;
  /** Read-only here: the target location is checked and its path shown. */
  locations: LocationRepository;
  /** Read-only here: the manufacturer is checked before it is linked. */
  manufacturers: ManufacturerRepository;
  audit: AuditRepository;
};

export const itemRepos = (db: DbExecutor): ItemRepos => ({
  items: createItemRepository(db),
  locations: createLocationRepository(db),
  manufacturers: createManufacturerRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. */
export type ItemDeps = { repos: ItemRepos; transact: Transact<ItemRepos> };

/** An item with its external IDs and the path of its location (the location itself last). */
export type ItemDetail = ItemWithManufacturer & { externalIds: ExternalId[]; path: PathSegment[] };
export type ItemListEntry = ItemListRow & { path: PathSegment[] };

export type CreateItemInput = {
  name: string;
  locationId: string;
  manufacturerId?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  manufactureYear?: number | null;
  registeredOn?: string | null;
  warrantyUntil?: string | null;
  lastServiceOn?: string | null;
  nextServiceOn?: string | null;
  documentsUrl?: string | null;
  note?: string | null;
  externalIds?: ExternalIdInput[];
};

/** Only the fields present change; `null` clears one. Sending `externalIds` replaces the whole list. */
export type UpdateItemInput = Partial<CreateItemInput> & { version: number };

const AUDITED = [
  'code',
  'name',
  'locationId',
  'manufacturerId',
  'model',
  'serialNumber',
  'manufactureYear',
  'registeredOn',
  'warrantyUntil',
  'lastServiceOn',
  'nextServiceOn',
  'documentsUrl',
  'note',
] as const;

const EDITABLE = AUDITED.filter((field) => field !== 'code');

const label = (id: ExternalIdInput) => `${id.source}: ${id.value}`;
const labels = (ids: ExternalIdInput[]) => ids.map(label).sort();

function assertDistinct(ids: ExternalIdInput[]): void {
  const keys = ids.map((id) => `${id.source.toLowerCase()}\n${id.value.toLowerCase()}`);
  if (new Set(keys).size !== keys.length) throw new DomainError('duplicate_external_id');
}

async function checkLocation(r: ItemRepos, locationId: string): Promise<void> {
  const location = await r.locations.findById(locationId);
  if (!location) throw new DomainError('location_not_found');
  if (location.archivedAt) throw new DomainError('location_archived');
}

async function checkManufacturer(r: ItemRepos, manufacturerId: string): Promise<void> {
  const manufacturer = await r.manufacturers.findById(manufacturerId);
  if (!manufacturer) throw new DomainError('manufacturer_not_found');
  if (manufacturer.archivedAt) throw new DomainError('manufacturer_archived');
}

async function loadCurrent(r: ItemRepos, id: string, version: number): Promise<ItemWithManufacturer> {
  const current = await r.items.findById(id);
  if (!current) throw new DomainError('not_found');
  if (current.version !== version) throw new DomainError('conflict');
  return current;
}

async function detailOf(r: ItemRepos, row: ItemWithManufacturer): Promise<ItemDetail> {
  const [externalIds, paths] = await Promise.all([
    r.items.listExternalIds(row.id),
    r.locations.findPaths([row.locationId]),
  ]);
  return { ...row, externalIds, path: paths.get(row.locationId) ?? [] };
}

/** Reads an item back with its external IDs and location path, for the response of a write. */
async function reload(r: ItemRepos, id: string): Promise<ItemDetail> {
  return detailOf(r, (await r.items.findById(id))!);
}

export function createItemService({ repos, transact }: ItemDeps) {
  async function setArchived(actor: Actor, id: string, version: number, archive: boolean): Promise<ItemDetail> {
    assertRole(actor, 'write');
    return transact(async (r) => {
      const current = await loadCurrent(r, id, version);
      if (archive && current.archivedAt) throw new DomainError('archived');
      if (!archive && !current.archivedAt) throw new DomainError('not_archived');
      if (!(await r.items.setArchived(id, version, archive, actor.id))) throw new DomainError('conflict');
      await r.audit.record({
        userId: actor.id,
        entityType: 'item',
        entityId: id,
        action: archive ? 'archive' : 'restore',
      });
      return reload(r, id);
    });
  }

  /** Active items by name with location paths, plus the total for the list heading. */
  async function list(
    actor: Actor,
    filter: ItemFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<ItemListEntry> & { total: number }> {
    assertRole(actor, 'read');
    const [result, total] = await Promise.all([repos.items.list(filter, page), repos.items.count(filter)]);
    const paths = await repos.locations.findPaths([...new Set(result.items.map((item) => item.location.id))]);
    return {
      items: result.items.map((item) => ({ ...item, path: paths.get(item.location.id) ?? [] })),
      nextCursor: result.nextCursor,
      total,
    };
  }

  return {
    /** Detail: archived items are returned too, so they can be viewed and restored. */
    async get(actor: Actor, id: string): Promise<ItemDetail> {
      assertRole(actor, 'read');
      const row = await repos.items.findById(id);
      if (!row) throw new DomainError('not_found');
      return detailOf(repos, row);
    },

    list,

    /** Items in a location and all its sub-locations; an unknown location is not found, not an empty list. */
    async listInLocation(
      actor: Actor,
      locationId: string,
      filter: Pick<ItemFilter, 'q'>,
      page: { limit: number; cursor?: string },
    ): Promise<Page<ItemListEntry> & { total: number }> {
      assertRole(actor, 'read');
      if (!(await repos.locations.findById(locationId))) throw new DomainError('not_found');
      return list(actor, { ...filter, locationId }, page);
    },

    async create(actor: Actor, input: CreateItemInput): Promise<ItemDetail> {
      assertRole(actor, 'write');
      const externalIds = input.externalIds ?? [];
      assertDistinct(externalIds);
      return transact(async (r) => {
        await checkLocation(r, input.locationId);
        if (input.manufacturerId) await checkManufacturer(r, input.manufacturerId);
        const row = await r.items.insert({
          name: input.name,
          locationId: input.locationId,
          manufacturerId: input.manufacturerId ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          manufactureYear: input.manufactureYear ?? null,
          registeredOn: input.registeredOn ?? null,
          warrantyUntil: input.warrantyUntil ?? null,
          lastServiceOn: input.lastServiceOn ?? null,
          nextServiceOn: input.nextServiceOn ?? null,
          documentsUrl: input.documentsUrl ?? null,
          note: input.note ?? null,
          createdBy: actor.id,
        });
        const saved = await r.items.replaceExternalIds(row.id, externalIds, actor.id);
        await r.audit.record({
          userId: actor.id,
          entityType: 'item',
          entityId: row.id,
          action: 'create',
          changes: {
            ...initialFields(row, AUDITED),
            ...(saved.length > 0 && { externalIds: { from: null, to: labels(saved) } }),
          },
        });
        return reload(r, row.id);
      });
    },

    async update(actor: Actor, id: string, input: UpdateItemInput): Promise<ItemDetail> {
      assertRole(actor, 'write');
      if (input.externalIds) assertDistinct(input.externalIds);
      return transact(async (r) => {
        const current = await loadCurrent(r, id, input.version);
        if (current.archivedAt) throw new DomainError('archived');
        if (input.locationId !== undefined && input.locationId !== current.locationId) {
          await checkLocation(r, input.locationId);
        }
        if (input.manufacturerId && input.manufacturerId !== current.manufacturerId) {
          await checkManufacturer(r, input.manufacturerId);
        }

        // The row is always updated, so the version moves even when only external IDs change.
        const patch = Object.fromEntries(EDITABLE.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
        const updated = await r.items.update(id, input.version, { ...patch, updatedBy: actor.id });
        if (!updated) throw new DomainError('conflict');

        const changes: Record<string, unknown> = changedFields(current, updated, AUDITED);
        if (input.externalIds) {
          const before = labels(await r.items.listExternalIds(id));
          const after = labels(await r.items.replaceExternalIds(id, input.externalIds, actor.id));
          if (before.join('\n') !== after.join('\n')) changes.externalIds = { from: before, to: after };
        }
        await r.audit.record({ userId: actor.id, entityType: 'item', entityId: id, action: 'update', changes });
        return reload(r, id);
      });
    },

    archive: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, true),
    restore: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, false),
  };
}

export type ItemService = ReturnType<typeof createItemService>;
