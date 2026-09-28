import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields, initialFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import {
  createLocationRepository,
  createLocationTypeRepository,
  type Location,
  type LocationFilter,
  type LocationRepository,
  type LocationType,
  type LocationTypeRepository,
  type LocationWithType,
  type PathSegment,
  type SubtreeCounts,
} from './repository.ts';

export type LocationRepos = {
  locations: LocationRepository;
  locationTypes: LocationTypeRepository;
  audit: AuditRepository;
};

export const locationRepos = (db: DbExecutor): LocationRepos => ({
  locations: createLocationRepository(db),
  locationTypes: createLocationTypeRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. */
export type LocationDeps = { repos: LocationRepos; transact: Transact<LocationRepos> };

/** A location with its path from the top (itself included) and its subtree counts. */
export type LocationSummary = LocationWithType & SubtreeCounts & { path: PathSegment[] };

export type CreateLocationInput = {
  name: string;
  /** Empty for a top-level location. */
  parentId?: string | null;
  /** Required for a top-level location, not allowed for a sub-location. */
  locationTypeId?: string | null;
  address?: string | null;
  note?: string | null;
};

/** Only the fields present change. Moving under a parent drops the type unless one is sent. */
export type UpdateLocationInput = Partial<CreateLocationInput> & { version: number };

const AUDITED = ['code', 'name', 'parentId', 'locationTypeId', 'address', 'note'] as const;

type Placement = {
  /** Undefined when creating. */
  id?: string;
  parentId: string | null;
  locationTypeId: string | null;
  parentChanged: boolean;
  typeChanged: boolean;
};

async function checkPlacement(r: LocationRepos, p: Placement): Promise<void> {
  if (p.parentId) {
    if (p.locationTypeId) throw new DomainError('location_type_not_allowed');
    if (!p.parentChanged) return;
    if (p.parentId === p.id) throw new DomainError('location_cycle');
    const parent = await r.locations.findById(p.parentId);
    if (!parent) throw new DomainError('parent_not_found');
    if (parent.archivedAt) throw new DomainError('parent_archived');
    if (p.id) {
      // The database trigger backs this up for concurrent moves.
      const path = (await r.locations.findPaths([p.parentId])).get(p.parentId) ?? [];
      if (path.some((segment) => segment.id === p.id)) throw new DomainError('location_cycle');
    }
    return;
  }
  if (!p.locationTypeId) throw new DomainError('location_type_required');
  if (!p.typeChanged) return;
  const type = await r.locationTypes.findById(p.locationTypeId);
  if (!type || type.archivedAt) throw new DomainError('location_type_not_found');
}

async function loadCurrent(r: LocationRepos, id: string, version: number): Promise<LocationWithType> {
  const current = await r.locations.findById(id);
  if (!current) throw new DomainError('not_found');
  if (current.version !== version) throw new DomainError('conflict');
  return current;
}

export function createLocationService({ repos, transact }: LocationDeps) {
  async function summarize(rows: LocationWithType[]): Promise<LocationSummary[]> {
    const ids = rows.map((row) => row.id);
    const [paths, counts] = await Promise.all([repos.locations.findPaths(ids), repos.locations.countSubtree(ids)]);
    return rows.map((row) => ({
      ...row,
      path: paths.get(row.id) ?? [],
      ...(counts.get(row.id) ?? { itemCount: 0, childCount: 0 }),
    }));
  }

  async function setArchived(actor: Actor, id: string, version: number, archive: boolean): Promise<Location> {
    assertRole(actor, 'write');
    return transact(async (r) => {
      const current = await loadCurrent(r, id, version);
      if (archive && current.archivedAt) throw new DomainError('archived');
      if (!archive && !current.archivedAt) throw new DomainError('not_archived');
      // Q6 (SPEC.md) is open: archiving does not check for active sub-locations or items yet.
      const row = await r.locations.setArchived(id, version, archive, actor.id);
      if (!row) throw new DomainError('conflict');
      await r.audit.record({
        userId: actor.id,
        entityType: 'location',
        entityId: id,
        action: archive ? 'archive' : 'restore',
      });
      return row;
    });
  }

  return {
    /** Detail: archived locations are returned too, so they can be viewed and restored. */
    async get(actor: Actor, id: string): Promise<LocationSummary> {
      assertRole(actor, 'read');
      const row = await repos.locations.findById(id);
      if (!row) throw new DomainError('not_found');
      const [summary] = await summarize([row]);
      return summary!;
    },

    /** Active locations with counts and paths, plus the total for the list heading. */
    async list(
      actor: Actor,
      filter: LocationFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<LocationSummary> & { total: number }> {
      assertRole(actor, 'read');
      const [result, total] = await Promise.all([
        repos.locations.list(filter, page),
        repos.locations.count(filter),
      ]);
      return { items: await summarize(result.items), nextCursor: result.nextCursor, total };
    },

    async create(actor: Actor, input: CreateLocationInput): Promise<Location> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const parentId = input.parentId ?? null;
        const locationTypeId = input.locationTypeId ?? null;
        await checkPlacement(r, { parentId, locationTypeId, parentChanged: true, typeChanged: true });
        const row = await r.locations.insert({
          name: input.name,
          parentId,
          locationTypeId,
          address: input.address ?? null,
          note: input.note ?? null,
          createdBy: actor.id,
        });
        await r.audit.record({
          userId: actor.id,
          entityType: 'location',
          entityId: row.id,
          action: 'create',
          changes: initialFields(row, AUDITED),
        });
        return row;
      });
    },

    async update(actor: Actor, id: string, input: UpdateLocationInput): Promise<Location> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const current = await loadCurrent(r, id, input.version);
        if (current.archivedAt) throw new DomainError('archived');

        const parentId = input.parentId !== undefined ? input.parentId : current.parentId;
        const locationTypeId =
          input.locationTypeId !== undefined ? input.locationTypeId : parentId ? null : current.locationTypeId;
        const parentChanged = parentId !== current.parentId;
        const typeChanged = locationTypeId !== current.locationTypeId;
        await checkPlacement(r, { id, parentId, locationTypeId, parentChanged, typeChanged });

        const updated = await r.locations.update(id, input.version, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.address !== undefined && { address: input.address }),
          ...(input.note !== undefined && { note: input.note }),
          ...(parentChanged && { parentId }),
          ...(typeChanged && { locationTypeId }),
          updatedBy: actor.id,
        });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'location',
          entityId: id,
          action: 'update',
          changes: changedFields(current, updated, AUDITED),
        });
        return updated;
      });
    },

    archive: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, true),
    restore: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, false),
  };
}

export type LocationService = ReturnType<typeof createLocationService>;

export type CreateLocationTypeInput = { code: string; name: string; sortOrder?: number };
export type UpdateLocationTypeInput = Partial<CreateLocationTypeInput> & { version: number };

const TYPE_AUDITED = ['code', 'name', 'sortOrder'] as const;

/** Location types are read by everyone and managed by admins only. */
export function createLocationTypeService({ repos, transact }: LocationDeps) {
  return {
    list(actor: Actor): Promise<LocationType[]> {
      assertRole(actor, 'read');
      return repos.locationTypes.list();
    },

    async create(actor: Actor, input: CreateLocationTypeInput): Promise<LocationType> {
      assertRole(actor, 'admin');
      return transact(async (r) => {
        const row = await r.locationTypes.insert({ ...input, createdBy: actor.id });
        await r.audit.record({
          userId: actor.id,
          entityType: 'location_type',
          entityId: row.id,
          action: 'create',
          changes: initialFields(row, TYPE_AUDITED),
        });
        return row;
      });
    },

    async update(actor: Actor, id: string, input: UpdateLocationTypeInput): Promise<LocationType> {
      assertRole(actor, 'admin');
      return transact(async (r) => {
        const current = await r.locationTypes.findById(id);
        if (!current) throw new DomainError('not_found');
        const { version, ...fields } = input;
        const updated = await r.locationTypes.update(id, version, { ...fields, updatedBy: actor.id });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'location_type',
          entityId: id,
          action: 'update',
          changes: changedFields(current, updated, TYPE_AUDITED),
        });
        return updated;
      });
    },
  };
}

export type LocationTypeService = ReturnType<typeof createLocationTypeService>;
