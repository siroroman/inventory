import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields, initialFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createInventoryRepository, type InventoryRepository } from '../inventories/repository.ts';
import { createLocationRepository, type LocationRepository, type PathSegment } from '../locations/repository.ts';
import { createManufacturerRepository, type ManufacturerRepository } from '../manufacturers/repository.ts';
import {
  createItemRepository,
  type ExternalId,
  type ExternalIdInput,
  type ItemFilter,
  type ItemLabelRow,
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
  /** An item created from an inventory checklist is added to the run (rule 9 of SPEC §9.3). */
  inventories: ItemInventories;
  audit: AuditRepository;
};

/** What creating an item needs of the inventory runs: the run's row, locked, and a way to add a row. */
export type ItemInventories = Pick<InventoryRepository, 'lockShared' | 'recordNew'>;

export const itemRepos = (db: DbExecutor): ItemRepos => ({
  items: createItemRepository(db),
  locations: createLocationRepository(db),
  manufacturers: createManufacturerRepository(db),
  inventories: createInventoryRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. `now` is the clock. */
export type ItemDeps = { repos: ItemRepos; transact: Transact<ItemRepos>; now?: () => Date };

/** An item with its external IDs and the path of its location (the location itself last). */
export type ItemDetail = ItemWithManufacturer & { externalIds: ExternalId[]; path: PathSegment[] };
export type ItemListEntry = ItemListRow & { path: PathSegment[] };
/** An item for a label, with the path of its location (empty without one). */
export type ItemLabel = Omit<ItemLabelRow, 'locationId'> & { path: PathSegment[] };

export type CreateItemInput = {
  /** Chosen by the user; the database assigns the next INV-nnnnn when missing. */
  code?: string;
  /** The inventory run the item is created for; see `createItemBody`. */
  inventoryId?: string;
  name: string;
  /** Missing or null = the item has no location yet. */
  locationId?: string | null;
  manufacturerId?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  manufactureYear?: number | null;
  registeredOn?: string | null;
  /** CZK. */
  purchasePrice?: number | null;
  warrantyUntil?: string | null;
  lastServiceOn?: string | null;
  nextServiceOn?: string | null;
  documentsUrl?: string | null;
  note?: string | null;
  externalIds?: ExternalIdInput[];
};

/** Only the fields present change; `null` clears one. Sending `externalIds` replaces the whole list. */
export type UpdateItemInput = Partial<Omit<CreateItemInput, 'code' | 'inventoryId'>> & { version: number };

/** A created item, and whether it was added to the inventory run it was created for. */
export type CreatedItem = ItemDetail & { addedToInventory: boolean };

const AUDITED = [
  'code',
  'name',
  'locationId',
  'manufacturerId',
  'model',
  'serialNumber',
  'manufactureYear',
  'registeredOn',
  'purchasePrice',
  'warrantyUntil',
  'lastServiceOn',
  'nextServiceOn',
  'documentsUrl',
  'note',
] as const;

const EDITABLE = AUDITED.filter((field) => field !== 'code');

const label = (id: ExternalIdInput) => `${id.source}: ${id.value}`;
const labels = (ids: ExternalIdInput[]) => ids.map(label).sort();

/**
 * A pair repeated within the request clashes like one another item has, so the error has the same
 * `details.conflicts` shape; `itemCode` is null because no other item is involved.
 */
function assertDistinct(ids: ExternalIdInput[]): void {
  const seen = new Set<string>();
  const repeated = ids.filter((id) => {
    const key = `${id.source.toLowerCase()}\n${id.value.toLowerCase()}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (repeated.length > 0) {
    const conflicts = repeated.map(({ source, value }) => ({ source, value, itemCode: null }));
    throw new DomainError('duplicate_external_id', { conflicts });
  }
}

/** Names the clashing pairs and the items that own them; the unique index only catches a race. */
async function assertExternalIdsFree(r: ItemRepos, ids: ExternalIdInput[], exceptItemId?: string): Promise<void> {
  const conflicts = await r.items.findExternalIdClashes(ids, exceptItemId);
  if (conflicts.length > 0) throw new DomainError('duplicate_external_id', { conflicts });
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
    row.locationId ? r.locations.findPaths([row.locationId]) : new Map<string, PathSegment[]>(),
  ]);
  return { ...row, externalIds, path: (row.locationId && paths.get(row.locationId)) || [] };
}

/** Reads an item back with its external IDs and location path, for the response of a write. */
async function reload(r: ItemRepos, id: string): Promise<ItemDetail> {
  return detailOf(r, (await r.items.findById(id))!);
}

/**
 * Adds a just-created item to the run it was created for, checked by its creator, as an item added
 * during the inventory. Only a run that is still in progress takes it, and only into a location of
 * the run (the root or anything below it); otherwise nothing is recorded and the item is just
 * created. The run's row is locked shared, so this never lands after a finish or cancel.
 */
async function addToInventory(
  r: ItemRepos,
  actor: Actor,
  inventoryId: string,
  itemId: string,
  locationId: string | null,
  at: Date,
): Promise<boolean> {
  const run = await r.inventories.lockShared(inventoryId);
  if (run?.status !== 'in_progress' || !locationId) return false;
  const path = (await r.locations.findPaths([locationId])).get(locationId);
  if (!path?.some((segment) => segment.id === run.locationId)) return false;
  await r.inventories.recordNew(inventoryId, itemId, { locationId, checkedAt: at, checkedBy: actor.id, method: 'manual' });
  await r.audit.record({
    userId: actor.id,
    entityType: 'inventory',
    entityId: inventoryId,
    action: 'check',
    changes: {
      itemId: { from: null, to: itemId },
      method: { from: null, to: 'manual' },
      kind: { from: null, to: 'new' },
      locationId: { from: null, to: locationId },
    },
  });
  return true;
}

export function createItemService({ repos, transact, now = () => new Date() }: ItemDeps) {
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

  /** Active (or archived) items by name with location paths, plus the total for the list heading. */
  async function list(
    actor: Actor,
    filter: ItemFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<ItemListEntry> & { total: number }> {
    assertRole(actor, 'read');
    const [result, total] = await Promise.all([repos.items.list(filter, page), repos.items.count(filter)]);
    const paths = await repos.locations.findPaths([
      ...new Set(result.items.flatMap((item) => (item.location ? [item.location.id] : []))),
    ]);
    return {
      items: result.items.map((item) => ({ ...item, path: (item.location && paths.get(item.location.id)) || [] })),
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

    /**
     * Active items for the label wizard: those in a location's subtree and/or matching the search,
     * at most `limit`, by ID (the repository's order), with the total of all that match. An unknown
     * location is not found, not an empty answer.
     */
    async listLabels(
      actor: Actor,
      filter: Pick<ItemFilter, 'q' | 'locationId'>,
      limit: number,
    ): Promise<{ items: ItemLabel[]; total: number }> {
      assertRole(actor, 'read');
      if (filter.locationId && !(await repos.locations.findById(filter.locationId))) {
        throw new DomainError('not_found');
      }
      const [rows, total] = await Promise.all([repos.items.listForLabels(filter, limit), repos.items.count(filter)]);
      const paths = await repos.locations.findPaths([
        ...new Set(rows.flatMap((row) => (row.locationId ? [row.locationId] : []))),
      ]);
      return {
        items: rows.map(({ locationId, ...row }) => ({ ...row, path: (locationId && paths.get(locationId)) || [] })),
        total,
      };
    },

    async create(actor: Actor, input: CreateItemInput): Promise<CreatedItem> {
      assertRole(actor, 'write');
      const externalIds = input.externalIds ?? [];
      assertDistinct(externalIds);
      return transact(async (r) => {
        if (input.locationId) await checkLocation(r, input.locationId);
        if (input.manufacturerId) await checkManufacturer(r, input.manufacturerId);
        await assertExternalIdsFree(r, externalIds);
        const row = await r.items.insert({
          ...(input.code !== undefined && { code: input.code }),
          name: input.name,
          locationId: input.locationId ?? null,
          manufacturerId: input.manufacturerId ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          manufactureYear: input.manufactureYear ?? null,
          registeredOn: input.registeredOn ?? null,
          purchasePrice: input.purchasePrice ?? null,
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
        const addedToInventory = input.inventoryId
          ? await addToInventory(r, actor, input.inventoryId, row.id, row.locationId, now())
          : false;
        return { ...(await reload(r, row.id)), addedToInventory };
      });
    },

    async update(actor: Actor, id: string, input: UpdateItemInput): Promise<ItemDetail> {
      assertRole(actor, 'write');
      if (input.externalIds) assertDistinct(input.externalIds);
      return transact(async (r) => {
        const current = await loadCurrent(r, id, input.version);
        if (current.archivedAt) throw new DomainError('archived');
        if (input.locationId && input.locationId !== current.locationId) {
          await checkLocation(r, input.locationId);
        }
        if (input.manufacturerId && input.manufacturerId !== current.manufacturerId) {
          await checkManufacturer(r, input.manufacturerId);
        }
        if (input.externalIds) await assertExternalIdsFree(r, input.externalIds, id);

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
