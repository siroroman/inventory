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
  type ScanTarget,
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
  /** The list taken at the start (without the items archived since) and how much of it is checked. */
  total: number;
  checked: number;
  /** Items found or added there, checked. */
  extra: number;
  /** List items flagged as missing. */
  missing: number;
  participants: Person[];
};

export type InventoryDetail = InventoryEntry & {
  /** People who checked something in the last 15 minutes (a run in progress only). */
  activeNow: Person[];
  /** Every location of the subtree that has rows in the run, in path order. */
  locations: InventoryLocationEntry[];
};

/**
 * An item of a run as the checklist shows it: the row with the path to where a found item was
 * registered. `registeredElsewhere` is true for an item found elsewhere that still is registered
 * somewhere other than where it was found; once its location is changed to that location (an
 * ordinary edit of the item) the row is in place and shows as an ordinary check.
 */
export type InventoryRunItem = RunItem & { registeredPath: PathSegment[]; registeredElsewhere: boolean };

/** The run in progress that blocks a start. */
export type InventoryOverlap = {
  id: string;
  location: InventoryRow['location'];
  startedBy: Person | null;
  startedAt: Date;
};
export type InventoryPreview = StartPreview & { overlap: InventoryOverlap | null };

/** The item a scan found, as the result sheet shows it: where it is registered is the path. */
export type ScannedItem = { id: string; code: string; name: string; path: PathSegment[] };

/** What a scan did (SPEC §9.6). `misplaced` and `wasMissing` are explained on `scanResultSchema`. */
export type ScanResult =
  | { outcome: 'found'; item: ScannedItem; row: InventoryRunItem; misplaced: boolean; wasMissing: boolean }
  | { outcome: 'found_elsewhere'; item: ScannedItem; row: InventoryRunItem; wasMissing: boolean }
  | { outcome: 'already_checked'; item: ScannedItem; row: InventoryRunItem }
  | { outcome: 'archived'; item: ScannedItem }
  | { outcome: 'unknown_code' };

/** The decision of a scan before paths are looked up. */
type ScanDecision =
  | { outcome: 'found'; target: ScanTarget; row: RunItem; misplaced: boolean }
  | { outcome: 'found_elsewhere'; target: ScanTarget; row: RunItem }
  | { outcome: 'already_checked'; target: ScanTarget; row: RunItem }
  | { outcome: 'archived'; target: ScanTarget }
  | { outcome: 'unknown_code' };

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
      registeredElsewhere: row.kind === 'elsewhere' && row.itemLocationId !== row.locationId,
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

  /**
   * Flags an unchecked item of the list as missing, or takes the flag back. Like a tick it runs with
   * the run's row locked shared, and what changes nothing is no error and leaves no audit entry:
   * an item somebody checked in the meantime stays checked (found beats missing, as the first
   * check wins), and an item that is flagged or not flagged already stays so. Only an item of the
   * list can be missing: one found elsewhere or added is `item_not_in_inventory`.
   */
  async function setMissing(actor: Actor, id: string, itemId: string, missing: boolean): Promise<InventoryRunItem> {
    assertRole(actor, 'write');
    const answer = await transact(async (r) => {
      const run = await r.inventories.lockShared(id);
      if (!run) throw new DomainError('not_found');
      if (run.status !== 'in_progress') throw new DomainError('inventory_closed');
      const row = await r.inventories.findRunItem(id, itemId);
      if (row?.kind !== 'expected') throw new DomainError('item_not_in_inventory');
      if (missing) {
        // An item archived since the start is not counted and is never offered as missing.
        if (row.itemArchived) throw new DomainError('archived');
        if (row.checkedAt || row.missing) return row;
        if (!(await r.inventories.markMissing(id, itemId))) return (await r.inventories.findRunItem(id, itemId))!;
      } else {
        if (!row.missing) return row;
        if (!(await r.inventories.unmarkMissing(id, itemId))) return (await r.inventories.findRunItem(id, itemId))!;
      }
      await r.audit.record({
        userId: actor.id,
        entityType: 'inventory',
        entityId: id,
        action: missing ? 'mark_missing' : 'unmark_missing',
        changes: { itemId: missing ? { from: null, to: itemId } : { from: itemId, to: null } },
      });
      return (await r.inventories.findRunItem(id, itemId))!;
    });
    const [entry] = await runItemEntries([answer]);
    return entry!;
  }

  /**
   * Checks an item by the code on its label. Like a tick, it runs with the run's row locked shared
   * and the first check wins; unlike a tick, an item that is not on the list is added to the run as
   * found elsewhere, at the context location. Nothing is recorded for an archived item or an
   * unknown code.
   */
  async function scan(
    actor: Actor,
    id: string,
    input: { code: string; locationId?: string; method?: 'scan' | 'manual' },
  ): Promise<ScanResult> {
    assertRole(actor, 'write');
    const method = input.method ?? 'scan';
    const decision = await transact(async (r): Promise<ScanDecision> => {
      const run = await r.inventories.lockShared(id);
      if (!run) throw new DomainError('not_found');
      if (run.status !== 'in_progress') throw new DomainError('inventory_closed');
      if (input.locationId) {
        const path = (await r.locations.findPaths([input.locationId])).get(input.locationId);
        if (!path) throw new DomainError('location_not_found');
        // Any location below the root counts, an archived one too: its checklist is still open to people.
        if (!path.some((segment) => segment.id === run.locationId)) throw new DomainError('location_outside_inventory');
      }
      const target = await r.inventories.findItemByCode(input.code);
      if (!target) return { outcome: 'unknown_code' };
      if (target.archived) return { outcome: 'archived', target };

      const existing = await r.inventories.findRunItem(id, target.id);
      if (existing?.checkedAt) return { outcome: 'already_checked', target, row: existing };

      const check = { checkedAt: now(), checkedBy: actor.id, method };
      // The row of somebody who checked it in the meantime: the first check wins.
      const lost = async (): Promise<ScanDecision> => ({
        outcome: 'already_checked',
        target,
        row: (await r.inventories.findRunItem(id, target.id))!,
      });

      if (existing && existing.kind !== 'elsewhere') {
        // On the list (or added during the run) and not checked yet.
        if (!(await r.inventories.markChecked(id, target.id, check))) return lost();
        await r.audit.record({
          userId: actor.id,
          entityType: 'inventory',
          entityId: id,
          action: 'check',
          changes: { itemId: { from: null, to: target.id }, method: { from: null, to: method } },
        });
        // `misplaced` only where the user said which location they stand in.
        const misplaced = input.locationId !== undefined && target.locationId !== input.locationId;
        return { outcome: 'found', target, row: (await r.inventories.findRunItem(id, target.id))!, misplaced };
      }

      // Not on the list, or found before and unticked since. Recorded where the user stands: the
      // checklist's location, or the root when the scanner was opened from the overview.
      const locationId = input.locationId ?? run.locationId;
      const found = { locationId, registeredLocationId: target.locationId, ...check };
      if (!(await r.inventories.recordFound(id, target.id, found))) return lost();
      await r.audit.record({
        userId: actor.id,
        entityType: 'inventory',
        entityId: id,
        action: 'check',
        changes: {
          itemId: { from: null, to: target.id },
          method: { from: null, to: method },
          kind: { from: null, to: 'elsewhere' },
          locationId: { from: null, to: locationId },
          registeredLocationId: { from: null, to: target.locationId },
        },
      });
      return { outcome: 'found_elsewhere', target, row: (await r.inventories.findRunItem(id, target.id))! };
    });

    if (decision.outcome === 'unknown_code') return decision;
    const { target } = decision;
    const paths = await repos.locations.findPaths(target.locationId ? [target.locationId] : []);
    const item: ScannedItem = {
      id: target.id,
      code: target.code,
      name: target.name,
      path: (target.locationId && paths.get(target.locationId)) || [],
    };
    if (decision.outcome === 'archived') return { outcome: 'archived', item };
    const [row] = await runItemEntries([decision.row]);
    // `wasMissing` stays false until the Nezvěstná status exists (`items.missing_since`).
    switch (decision.outcome) {
      case 'found':
        return { outcome: 'found', item, row: row!, misplaced: decision.misplaced, wasMissing: false };
      case 'found_elsewhere':
        return { outcome: 'found_elsewhere', item, row: row!, wasMissing: false };
      case 'already_checked':
        return { outcome: 'already_checked', item, row: row! };
    }
  }

  /**
   * Ends a run in progress as `finished` or `cancelled`. The run's row is locked `FOR UPDATE`, so no
   * tick can slip in between the last check and the end (ticks take it `FOR SHARE`). A finish
   * settles the unchecked items of the list: what people flagged as missing is missing, the rest
   * is not checked.
   */
  async function close(
    actor: Actor,
    id: string,
    version: number,
    status: 'finished' | 'cancelled',
  ): Promise<InventoryDetail> {
    assertRole(actor, 'write');
    await transact(async (r) => {
      const current = await r.inventories.lock(id);
      if (!current) throw new DomainError('not_found');
      if (current.status !== 'in_progress') throw new DomainError('inventory_closed');
      if (current.version !== version) throw new DomainError('conflict');
      const updated = await r.inventories.update(id, version, {
        status,
        endedAt: now(),
        endedBy: actor.id,
        updatedBy: actor.id,
      });
      if (!updated) throw new DomainError('conflict');
      const changes: Record<string, unknown> = changedFields(current, updated, ['status']);
      if (status === 'finished') {
        changes.missing = { from: null, to: await r.inventories.settleUnchecked(id) };
      }
      await r.audit.record({
        userId: actor.id,
        entityType: 'inventory',
        entityId: id,
        action: status === 'finished' ? 'finish' : 'cancel',
        changes,
      });
    });
    return get(actor, id);
  }

  /**
   * Archives or restores an ended run (a run in progress cannot be archived). Like cancel and
   * finish, the run's row is locked first, and a stale version is a conflict.
   */
  async function setArchived(actor: Actor, id: string, version: number, archive: boolean): Promise<InventoryDetail> {
    assertRole(actor, 'write');
    await transact(async (r) => {
      const current = await r.inventories.lock(id);
      if (!current) throw new DomainError('not_found');
      if (archive && current.status === 'in_progress') throw new DomainError('inventory_in_progress');
      if (archive && current.archivedAt) throw new DomainError('archived');
      if (!archive && !current.archivedAt) throw new DomainError('not_archived');
      if (current.version !== version) throw new DomainError('conflict');
      if (!(await r.inventories.setArchived(id, version, archive, actor.id))) throw new DomainError('conflict');
      await r.audit.record({
        userId: actor.id,
        entityType: 'inventory',
        entityId: id,
        action: archive ? 'archive' : 'restore',
      });
    });
    return get(actor, id);
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
      .flatMap(({ locationId, total, checked, extra, missing }): InventoryLocationEntry[] => {
        const path = paths.get(locationId);
        const self = path?.at(-1);
        if (!path || !self) return [];
        const participants = checkers
          .filter((checker) => checker.locationId === locationId)
          .map(({ id: personId, name }) => ({ id: personId, name }));
        return [{ ...self, path, total, checked, extra, missing, participants }];
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

    /** Flags an unchecked item of the list as missing; a check takes the flag back. */
    markMissing: (actor: Actor, id: string, itemId: string) => setMissing(actor, id, itemId, true),

    /** Takes the flag back: the item is not checked again, but no longer reported as missing. */
    unmarkMissing: (actor: Actor, id: string, itemId: string) => setMissing(actor, id, itemId, false),

    scan,

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

    /** Ends a run in progress; nothing more is marked missing, and what was checked or flagged stays on record. */
    cancel: (actor: Actor, id: string, version: number) => close(actor, id, version, 'cancelled'),

    /**
     * Ends a run in progress as finished. The items of the list that were flagged as missing are the
     * ones missing; the other unchecked ones stay not checked (as do those archived since, which are
     * never offered as missing). Checks, scans and further finishes are refused afterwards
     * (`inventory_closed`).
     */
    finish: (actor: Actor, id: string, version: number) => close(actor, id, version, 'finished'),

    /**
     * Takes a finished run back into progress, so that more can be checked and finished again.
     * Checks and the flags people set stay; what the finish set on items archived since is taken
     * back. The location must be free of another run in progress, as for a start. A cancelled
     * run is final, and an archived one is restored first.
     */
    async reopen(actor: Actor, id: string, version: number): Promise<InventoryDetail> {
      assertRole(actor, 'write');
      await transact(async (r) => {
        // Serialised with the starts: another run may have been started on the location since the finish.
        await r.inventories.lockStarts();
        const current = await r.inventories.lock(id);
        if (!current) throw new DomainError('not_found');
        if (current.status === 'in_progress') throw new DomainError('inventory_in_progress');
        if (current.status !== 'finished') throw new DomainError('inventory_not_finished');
        if (current.archivedAt) throw new DomainError('archived');
        if (current.version !== version) throw new DomainError('conflict');
        const overlapping = await r.inventories.findOverlapping(current.locationId);
        if (overlapping) throw new DomainError('inventory_overlap', { inventoryId: overlapping.id });
        const updated = await r.inventories.update(id, version, {
          status: 'in_progress',
          endedAt: null,
          endedBy: null,
          updatedBy: actor.id,
        });
        if (!updated) throw new DomainError('conflict');
        await r.inventories.clearSkipped(id);
        await r.audit.record({
          userId: actor.id,
          entityType: 'inventory',
          entityId: id,
          action: 'reopen',
          changes: changedFields(current, updated, ['status']),
        });
      });
      return get(actor, id);
    },

    /** Takes an ended run out of the lists. It can be restored; nothing about the run changes. */
    archive: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, true),
    restore: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, false),
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
