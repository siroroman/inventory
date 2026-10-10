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
  type RunItem,
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

/** An item of a run as the checklist shows it: the row with the path to where a found item was registered. */
export type InventoryRunItem = RunItem & { registeredPath: PathSegment[] };

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
    // Same name, different location: keep each one's subtree together.
    if (a.path[i]!.id !== b.path[i]!.id) return a.path[i]!.id < b.path[i]!.id ? -1 : 1;
  }
  return a.path.length - b.path.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const overlapOf = (row: InventoryRow): InventoryOverlap => ({
  id: row.id,
  location: row.location,
  startedBy: row.startedBy,
  startedAt: row.createdAt,
});

function toEntry(
  row: InventoryRow,
  paths: Map<string, PathSegment[]>,
  counts: Map<string, InventoryCounts>,
  participants: Map<string, Person[]>,
): InventoryEntry {
  return {
    ...row,
    path: paths.get(row.locationId) ?? [],
    counts: counts.get(row.id) ?? NO_COUNTS,
    participants: participants.get(row.id) ?? [],
  };
}

/** Inventory runs: a physical check of a location and everything below it. */
export function createInventoryService({ repos, transact, now = () => new Date() }: InventoryDeps) {
  /** The root must exist and be active; a run on an archived location would never show in a list. */
  async function loadRoot(r: InventoryRepos, locationId: string): Promise<void> {
    const location = await r.locations.findById(locationId);
    if (!location) throw new DomainError('location_not_found');
    if (location.archivedAt) throw new DomainError('location_archived');
  }

  /** Paths are looked up by the caller (one query for the root and whatever else it needs). */
  async function entries(
    rows: InventoryRow[],
    paths: Map<string, PathSegment[]>,
  ): Promise<InventoryEntry[]> {
    const ids = rows.map((row) => row.id);
    const [counts, participants] = await Promise.all([
      repos.inventories.counts(ids),
      repos.inventories.participants(ids),
    ]);
    return rows.map((row) => toEntry(row, paths, counts, participants));
  }

  async function runItemEntries(rows: RunItem[]): Promise<InventoryRunItem[]> {
    const registered = rows.flatMap((row) => (row.registeredLocationId ? [row.registeredLocationId] : []));
    const paths = await repos.locations.findPaths([...new Set(registered)]);
    return rows.map((row) => ({
      ...row,
      registeredPath: (row.registeredLocationId && paths.get(row.registeredLocationId)) || [],
    }));
  }

  /**
   * Ticks or unticks an item by hand. The run's row is locked shared, so ticks go on side by side
   * but never past a finish or cancel. A tick that changes nothing (already checked, already
   * unchecked) is not an error and leaves no audit entry; the first check wins.
   */
  async function setChecked(actor: Actor, id: string, itemId: string, checked: boolean): Promise<InventoryRunItem> {
    assertRole(actor, 'write');
    const answer = await transact(async (r) => {
      const run = await r.inventories.lockShared(id);
      if (!run) throw new DomainError('not_found');
      if (run.status !== 'in_progress') throw new DomainError('inventory_closed');
      const row = await r.inventories.findRunItem(id, itemId);
      if (!row) throw new DomainError('item_not_in_inventory');
      if (checked) {
        // An item archived since the start is no longer counted, so it cannot be checked either.
        if (row.itemArchived) throw new DomainError('archived');
        const method = 'manual';
        if (!(await r.inventories.markChecked(id, itemId, { checkedAt: now(), checkedBy: actor.id, method }))) {
          // Somebody ticked it between our read and our update: answer with their check, not our stale read.
          return (await r.inventories.findRunItem(id, itemId))!;
        }
        await r.audit.record({
          userId: actor.id,
          entityType: 'inventory',
          entityId: id,
          action: 'check',
          changes: { itemId: { from: null, to: itemId }, method: { from: null, to: method } },
        });
      } else {
        if (!(await r.inventories.markUnchecked(id, itemId))) return (await r.inventories.findRunItem(id, itemId))!;
        await r.audit.record({
          userId: actor.id,
          entityType: 'inventory',
          entityId: id,
          action: 'uncheck',
          changes: { itemId: { from: itemId, to: null } },
        });
      }
      // The row as this tick left it, not as a later one by somebody else might.
      return (await r.inventories.findRunItem(id, itemId))!;
    });
    const [entry] = await runItemEntries([answer]);
    return entry!;
  }

  async function get(actor: Actor, id: string): Promise<InventoryDetail> {
    assertRole(actor, 'read');
    const row = await repos.inventories.findById(id);
    if (!row) throw new DomainError('not_found');
    const [progress, checkers, activeNow, counts, participants] = await Promise.all([
      repos.inventories.locationProgress(id),
      repos.inventories.locationCheckers(id),
      row.status === 'in_progress'
        ? repos.inventories.recentCheckers(id, new Date(now().getTime() - ACTIVE_WINDOW_MS))
        : Promise.resolve([]),
      repos.inventories.counts([id]),
      repos.inventories.participants([id]),
    ]);
    const paths = await repos.locations.findPaths([row.locationId, ...progress.map((p) => p.locationId)]);
    const entry = toEntry(row, paths, counts, participants);
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
    return { ...entry, activeNow, locations };
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
      const paths = await repos.locations.findPaths([...new Set(result.items.map((row) => row.locationId))]);
      return { items: await entries(result.items, paths), nextCursor: result.nextCursor, total };
    },

    get,

    /** The rows of a run, or of one of its locations, that a person sees: not paged, by item name. */
    async listItems(actor: Actor, id: string, locationId?: string): Promise<InventoryRunItem[]> {
      assertRole(actor, 'read');
      if (!(await repos.inventories.findById(id))) throw new DomainError('not_found');
      return runItemEntries(await repos.inventories.runItems(id, locationId));
    },

    /** Ticks an item of a run in progress by hand. */
    check: (actor: Actor, id: string, itemId: string) => setChecked(actor, id, itemId, true),

    /** Clears the tick of an item. An item found elsewhere or added drops out of the run's rows with it. */
    uncheck: (actor: Actor, id: string, itemId: string) => setChecked(actor, id, itemId, false),

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
