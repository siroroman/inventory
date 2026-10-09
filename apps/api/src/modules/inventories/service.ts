import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createLocationRepository, type LocationRepository, type PathSegment } from '../locations/repository.ts';
import {
  createInventoryRepository,
  type InventoryCounts,
  type InventoryFilter,
  type InventoryRepository,
  type InventoryRow,
  type Person,
  type StartPreview,
} from './repository.ts';

export type InventoryRepos = {
  inventories: InventoryRepository;
  /** Read-only: the root of a run and the paths of its locations. */
  locations: LocationRepository;
  audit: AuditRepository;
};

export const inventoryRepos = (db: DbExecutor): InventoryRepos => ({
  inventories: createInventoryRepository(db),
  locations: createLocationRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. `now` is the clock. */
export type InventoryDeps = {
  repos: InventoryRepos;
  transact: Transact<InventoryRepos>;
  now?: () => Date;
};

/** A run in a list: its root with the path to it (the root last), its counts and the people who took part. */
export type InventoryEntry = InventoryRow & { path: PathSegment[]; counts: InventoryCounts; participants: Person[] };

/** A location of the run with the path to it (itself last) and the numbers shown on the overview. */
export type InventoryLocationEntry = PathSegment & {
  path: PathSegment[];
  total: number;
  checked: number;
  participants: Person[];
};

export type InventoryDetail = InventoryEntry & {
  /** People who checked something in the last 15 minutes (a run in progress only). */
  activeNow: Person[];
  /** Every location of the subtree that has rows in the run, in path order. */
  locations: InventoryLocationEntry[];
};

/** The run in progress that blocks a start. */
export type InventoryOverlap = {
  id: string;
  location: InventoryRow['location'];
  startedBy: Person | null;
  startedAt: Date;
};
export type InventoryPreview = StartPreview & { overlap: InventoryOverlap | null };

const ACTIVE_WINDOW_MS = 15 * 60_000;
const NO_COUNTS: InventoryCounts = { expected: 0, checked: 0, elsewhere: 0, new: 0, missing: 0 };

const collator = new Intl.Collator('cs');

/** Name by name in Czech order, a location before everything below it; like ordering by a `text[]` path. */
function byPath(a: { path: PathSegment[]; id: string }, b: { path: PathSegment[]; id: string }): number {
  for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
    const order = collator.compare(a.path[i]!.name, b.path[i]!.name);
    if (order) return order;
  }
  return a.path.length - b.path.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const overlapOf = (row: InventoryRow): InventoryOverlap => ({
  id: row.id,
  location: row.location,
  startedBy: row.startedBy,
  startedAt: row.createdAt,
});

/** Inventory runs: a physical check of a location and everything below it. */
export function createInventoryService({ repos, transact, now = () => new Date() }: InventoryDeps) {
  /** The root must exist and be active; a run on an archived location would never show in a list. */
  async function loadRoot(r: InventoryRepos, locationId: string): Promise<void> {
    const location = await r.locations.findById(locationId);
    if (!location) throw new DomainError('location_not_found');
    if (location.archivedAt) throw new DomainError('location_archived');
  }

  async function entries(rows: InventoryRow[]): Promise<InventoryEntry[]> {
    const ids = rows.map((row) => row.id);
    const [paths, counts, participants] = await Promise.all([
      repos.locations.findPaths([...new Set(rows.map((row) => row.locationId))]),
      repos.inventories.counts(ids),
      repos.inventories.participants(ids),
    ]);
    return rows.map((row) => ({
      ...row,
      path: paths.get(row.locationId) ?? [],
      counts: counts.get(row.id) ?? NO_COUNTS,
      participants: participants.get(row.id) ?? [],
    }));
  }

  async function get(actor: Actor, id: string): Promise<InventoryDetail> {
    assertRole(actor, 'read');
    const row = await repos.inventories.findById(id);
    if (!row) throw new DomainError('not_found');
    const [[entry], progress, checkers, activeNow] = await Promise.all([
      entries([row]),
      repos.inventories.locationProgress(id),
      repos.inventories.locationCheckers(id),
      row.status === 'in_progress'
        ? repos.inventories.recentCheckers(id, new Date(now().getTime() - ACTIVE_WINDOW_MS))
        : Promise.resolve([]),
    ]);
    const paths = await repos.locations.findPaths(progress.map((p) => p.locationId));
    const locations = progress
      .flatMap(({ locationId, total, checked }): InventoryLocationEntry[] => {
        const path = paths.get(locationId);
        const self = path?.at(-1);
        if (!path || !self) return [];
        const participants = checkers
          .filter((checker) => checker.locationId === locationId)
          .map(({ id: personId, name }) => ({ id: personId, name }));
        return [{ ...self, path, total, checked, participants }];
      })
      .sort(byPath);
    return { ...entry!, activeNow, locations };
  }

  return {
    /** Runs in progress (`open`) or ended ones (`closed`), newest first, with the total for the heading. */
    async list(
      actor: Actor,
      filter: InventoryFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<InventoryEntry> & { total: number }> {
      assertRole(actor, 'read');
      const [result, total] = await Promise.all([
        repos.inventories.list(filter, page),
        repos.inventories.count(filter),
      ]);
      return { items: await entries(result.items), nextCursor: result.nextCursor, total };
    },

    get,

    /** What starting a run on `locationId` would check, and the run in progress it would clash with. */
    async preview(actor: Actor, locationId: string): Promise<InventoryPreview> {
      assertRole(actor, 'write');
      await loadRoot(repos, locationId);
      const [counts, overlapping] = await Promise.all([
        repos.inventories.previewCounts(locationId),
        repos.inventories.findOverlapping(locationId),
      ]);
      return { ...counts, overlap: overlapping ? overlapOf(overlapping) : null };
    },

    /** Starts a run: takes the list of items to check and refuses a location that overlaps a run in progress. */
    async start(actor: Actor, input: { locationId: string }): Promise<InventoryDetail> {
      assertRole(actor, 'write');
      const id = await transact(async (r) => {
        // Serialised, so of two simultaneous starts the second sees the first.
        await r.inventories.lockStarts();
        await loadRoot(r, input.locationId);
        const overlapping = await r.inventories.findOverlapping(input.locationId);
        if (overlapping) throw new DomainError('inventory_overlap', { inventoryId: overlapping.id });
        const run = await r.inventories.insert({
          locationId: input.locationId,
          createdBy: actor.id,
          createdAt: now(),
        });
        const itemCount = await r.inventories.snapshot(run.id, input.locationId);
        await r.audit.record({
          userId: actor.id,
          entityType: 'inventory',
          entityId: run.id,
          action: 'start',
          changes: { locationId: { from: null, to: input.locationId }, items: { from: null, to: itemCount } },
        });
        return run.id;
      });
      return get(actor, id);
    },

    /** Ends a run in progress without marking anything missing; what was checked stays on record. */
    async cancel(actor: Actor, id: string, version: number): Promise<InventoryDetail> {
      assertRole(actor, 'write');
      await transact(async (r) => {
        const current = await r.inventories.lock(id);
        if (!current) throw new DomainError('not_found');
        if (current.status !== 'in_progress') throw new DomainError('inventory_closed');
        if (current.version !== version) throw new DomainError('conflict');
        const updated = await r.inventories.update(id, version, {
          status: 'cancelled',
          endedAt: now(),
          endedBy: actor.id,
          updatedBy: actor.id,
        });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'inventory',
          entityId: id,
          action: 'cancel',
          changes: changedFields(current, updated, ['status']),
        });
      });
      return get(actor, id);
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
