import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { InvalidCursorError } from '../../../src/db/pagination.ts';
import { inventoryItems, items, locations } from '../../../src/db/schema/index.ts';
import { createInventoryRepository } from '../../../src/modules/inventories/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertInventory, insertInventoryItem, insertItem, insertLocation, insertUser } from '../../helpers/factories.ts';

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 3, 7, 0, 0) + minutes * MINUTE);

describe('inventory repository', () => {
  const t = useTestDb();
  const repo = () => createInventoryRepository(t().app);

  /** A top-level location with `Patro` below it and `Zasedačka` below that, and an unrelated one. */
  async function tree() {
    const praha = await insertLocation(t().app, { name: 'Centrála Praha' });
    const patro = await insertLocation(t().app, { name: 'Patro', parentId: praha.id });
    const zasedacka = await insertLocation(t().app, { name: 'Zasedačka', parentId: patro.id });
    const brno = await insertLocation(t().app, { name: 'Centrála Brno' });
    return { praha, patro, zasedacka, brno };
  }

  describe('snapshot and preview', () => {
    it('takes the active items of the root and its active sub-locations, once each', async () => {
      const { praha, patro, zasedacka, brno } = await tree();
      const user = await insertUser(t().app);
      const archivedRoom = await insertLocation(t().app, { name: 'Stará dílna', parentId: praha.id });
      const kept = [
        await insertItem(t().app, { locationId: praha.id }),
        await insertItem(t().app, { locationId: patro.id }),
        await insertItem(t().app, { locationId: zasedacka.id }),
      ];
      await insertItem(t().app, { locationId: patro.id, archivedAt: new Date() });
      await insertItem(t().app, { locationId: archivedRoom.id });
      await insertItem(t().app, { locationId: null });
      await insertItem(t().app, { locationId: brno.id });
      await t().owner.update(locations).set({ archivedAt: new Date() }).where(eq(locations.id, archivedRoom.id));

      expect(await repo().previewCounts(praha.id)).toEqual({ itemCount: 3, locationCount: 3 });
      const run = await repo().insert({ locationId: praha.id, createdBy: user.id, createdAt: at(0) });
      expect(await repo().snapshot(run.id, praha.id)).toBe(3);

      const rows = await t().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, run.id));
      expect(rows.map((r) => r.itemId).sort()).toEqual(kept.map((i) => i.id).sort());
      expect(rows.every((r) => r.kind === 'expected' && r.checkedAt === null && r.outcome === null)).toBe(true);
      expect(rows.find((r) => r.itemId === kept[2]!.id)!.locationId).toBe(zasedacka.id);
    });

    it('is empty for a location without items', async () => {
      const { praha } = await tree();
      expect(await repo().previewCounts(praha.id)).toEqual({ itemCount: 0, locationCount: 0 });
    });
  });

  describe('findOverlapping', () => {
    it('finds a run in progress on the location, above it or below it, but not beside it', async () => {
      const { praha, patro, zasedacka, brno } = await tree();
      const run = await insertInventory(t().app, { locationId: patro.id });
      for (const id of [patro.id, zasedacka.id, praha.id]) {
        expect(await repo().findOverlapping(id), id).toMatchObject({ id: run.id });
      }
      expect(await repo().findOverlapping(brno.id)).toBeUndefined();
      const sibling = await insertLocation(t().app, { name: 'Přízemí', parentId: praha.id });
      expect(await repo().findOverlapping(sibling.id)).toBeUndefined();
    });

    it('looks below archived locations too, and ignores ended runs', async () => {
      const { praha, patro } = await tree();
      await t().owner.update(locations).set({ archivedAt: new Date() }).where(eq(locations.id, patro.id));
      const user = await insertUser(t().app);
      await insertInventory(t().app, { locationId: praha.id, status: 'cancelled', endedAt: at(1), endedBy: user.id });
      expect(await repo().findOverlapping(praha.id)).toBeUndefined();
      const run = await insertInventory(t().app, { locationId: patro.id });
      expect(await repo().findOverlapping(praha.id)).toMatchObject({ id: run.id });
    });

    it('returns the root, who started it and when', async () => {
      const { praha } = await tree();
      const user = await insertUser(t().app, { name: 'Roman Siro' });
      const run = await repo().insert({ locationId: praha.id, createdBy: user.id, createdAt: at(5) });
      expect(await repo().findOverlapping(praha.id)).toMatchObject({
        id: run.id,
        location: { id: praha.id, code: praha.code, name: 'Centrála Praha' },
        startedBy: { id: user.id, name: 'Roman Siro' },
        closedBy: null,
        createdAt: at(5),
      });
    });
  });

  describe('counts and progress', () => {
    async function run() {
      const { praha, patro, zasedacka } = await tree();
      const [a, b] = [await insertUser(t().app, { name: 'Anna' }), await insertUser(t().app, { name: 'Boris' })];
      const inventory = await insertInventory(t().app, { locationId: praha.id, createdBy: a.id, createdAt: at(0) });
      const row = (locationId: string, overrides: Partial<typeof inventoryItems.$inferInsert> = {}) =>
        insertInventoryItem(t().app, { inventoryId: inventory.id, locationId, ...overrides });
      const check = (by: string, minutes: number) => ({ checkedAt: at(minutes), checkedBy: by, method: 'manual' as const });
      return { inventory, praha, patro, zasedacka, a, b, row, check };
    }

    it('counts the list without archived items, and the items found or added', async () => {
      const { inventory, praha, patro, a, b, row, check } = await run();
      await row(praha.id, check(a.id, 1));
      await row(patro.id);
      await row(patro.id, check(b.id, 2));
      const archived = await row(patro.id, check(a.id, 3));
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archived.itemId));
      await row(patro.id, { kind: 'elsewhere', ...check(a.id, 4) });
      await row(patro.id, { kind: 'elsewhere' }); // unticked: hidden
      await row(praha.id, { kind: 'new', ...check(b.id, 5) });
      await row(patro.id, { outcome: 'missing' });

      const counts = (await repo().counts([inventory.id])).get(inventory.id);
      expect(counts).toEqual({ expected: 4, checked: 2, elsewhere: 1, new: 1, missing: 1 });
      expect((await repo().counts([crypto.randomUUID()])).size).toBe(0);
      expect((await repo().counts([])).size).toBe(0);
    });

    it('sums each location by the rows a person sees there', async () => {
      const { inventory, praha, patro, zasedacka, a, row, check } = await run();
      await row(praha.id, check(a.id, 1));
      await row(patro.id);
      await row(patro.id, check(a.id, 2));
      const archived = await row(patro.id);
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archived.itemId));
      await row(zasedacka.id, { kind: 'elsewhere' }); // unticked: no row, so no location

      const progress = await repo().locationProgress(inventory.id);
      expect(progress.sort((x, y) => y.total - x.total)).toEqual([
        { locationId: patro.id, total: 2, checked: 1 },
        { locationId: praha.id, total: 1, checked: 1 },
      ]);
    });

    it('lists the people: the starter first, then the checkers in order of their first check', async () => {
      const { inventory, praha, patro, a, b, row, check } = await run();
      const c = await insertUser(t().app, { name: 'Cyril' });
      await row(patro.id, check(c.id, 3));
      await row(patro.id, check(b.id, 1));
      await row(praha.id, check(b.id, 2));
      await row(praha.id, check(a.id, 4)); // the starter checked something too: still listed once, first

      const people = await repo().participants([inventory.id]);
      expect(people.get(inventory.id)).toEqual([
        { id: a.id, name: 'Anna' },
        { id: b.id, name: 'Boris' },
        { id: c.id, name: 'Cyril' },
      ]);
      expect((await repo().participants([])).size).toBe(0);
    });

    it('lists who checked in each location and who checked recently', async () => {
      const { inventory, praha, patro, a, b, row, check } = await run();
      await row(praha.id, check(a.id, 10));
      await row(patro.id, check(b.id, 1));
      await row(patro.id, check(a.id, 2));
      await row(patro.id, check(b.id, 30));

      const checkers = await repo().locationCheckers(inventory.id);
      expect(checkers.filter((c) => c.locationId === patro.id).map((c) => c.name)).toEqual(['Boris', 'Anna']);
      expect(checkers.filter((c) => c.locationId === praha.id).map((c) => c.name)).toEqual(['Anna']);
      expect((await repo().recentCheckers(inventory.id, at(15))).map((p) => p.name)).toEqual(['Boris']);
      expect((await repo().recentCheckers(inventory.id, at(5))).map((p) => p.name)).toEqual(['Boris', 'Anna']);
      expect((await repo().recentCheckers(inventory.id, at(0))).map((p) => p.name)).toEqual(['Boris', 'Anna']);
      expect(await repo().recentCheckers(inventory.id, at(31))).toEqual([]);
    });
  });

  describe('list', () => {
    it('separates runs in progress from ended ones and sorts each newest first', async () => {
      const { praha, patro, zasedacka, brno } = await tree();
      const user = await insertUser(t().app);
      const open1 = await repo().insert({ locationId: praha.id, createdBy: user.id, createdAt: at(1) });
      const open2 = await repo().insert({ locationId: brno.id, createdBy: user.id, createdAt: at(2) });
      const ended = (locationId: string, startedAt: number, endedAt: number) =>
        insertInventory(t().app, {
          locationId,
          createdAt: at(startedAt),
          createdBy: user.id,
          status: 'cancelled',
          endedAt: at(endedAt),
          endedBy: user.id,
        });
      const early = await ended(patro.id, 0, 10);
      const late = await ended(zasedacka.id, 5, 20);

      const open = await repo().list({ state: 'open' }, { limit: 20 });
      const closed = await repo().list({ state: 'closed' }, { limit: 20 });
      expect(open.items.map((r) => r.id)).toEqual([open2.id, open1.id]);
      expect(closed.items.map((r) => r.id)).toEqual([late.id, early.id]);
      expect(closed.items[0]).toMatchObject({ closedBy: { id: user.id }, endedAt: at(20) });
      expect(await repo().count({ state: 'open' })).toBe(2);
      expect(await repo().count({ state: 'closed' })).toBe(2);
    });

    it('pages through runs with the same moment without gaps or repeats', async () => {
      const user = await insertUser(t().app);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const location = await insertLocation(t().app, { name: `Lokalita ${i}` });
        const run = await insertInventory(t().app, {
          locationId: location.id,
          createdBy: user.id,
          createdAt: at(0),
          status: 'finished',
          endedAt: at(i < 3 ? 10 : 20),
          endedBy: user.id,
        });
        ids.push(run.id);
      }

      for (const state of ['open', 'closed'] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await repo().list({ state }, { limit: 2, cursor });
          seen.push(...page.items.map((r) => r.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(seen, state).toHaveLength(state === 'open' ? 0 : 5);
        expect(new Set(seen), state).toEqual(new Set(state === 'open' ? [] : ids));
      }
    });

    it('rejects a cursor it did not issue', async () => {
      await expect(repo().list({ state: 'closed' }, { limit: 2, cursor: '%%%' })).rejects.toThrow(InvalidCursorError);
    });

    it('searches the root by name, code and the names above it', async () => {
      const { zasedacka, brno } = await tree();
      const user = await insertUser(t().app);
      for (const location of [zasedacka, brno]) {
        await repo().insert({ locationId: location.id, createdBy: user.id, createdAt: at(1) });
      }
      const found = async (q: string) =>
        (await repo().list({ state: 'open', q }, { limit: 20 })).items.map((r) => r.location.name);
      expect(await found('zasedacka')).toEqual(['Zasedačka']);
      expect(await found('zasedacka praha')).toEqual(['Zasedačka']);
      expect(await found('zasedacka brno')).toEqual([]);
      expect(await found('PRAHA')).toEqual([]); // the words must also be in the location itself
      expect(await found(brno.code)).toEqual(['Centrála Brno']);
      expect(await found('')).toHaveLength(2);
    });
  });

  describe('lock and update', () => {
    it('updates only with the current version', async () => {
      const user = await insertUser(t().app);
      const run = await insertInventory(t().app, { createdBy: user.id });
      const done = { status: 'cancelled', endedAt: at(1), endedBy: user.id, updatedBy: user.id };
      expect(await repo().update(run.id, 5, done)).toBeUndefined();
      expect(await repo().update(run.id, 1, done)).toMatchObject({ status: 'cancelled', version: 2, endedAt: at(1) });
    });

    it('locks the row for the rest of the transaction', async () => {
      const run = await insertInventory(t().app);
      const order: string[] = [];
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = t().app.transaction(async (tx) => {
        await createInventoryRepository(tx).lock(run.id);
        order.push('first locked');
        await hold;
        order.push('first done');
      });
      await expect.poll(() => order).toEqual(['first locked']);
      const second = createInventoryRepository(t().app)
        .lock(run.id)
        .then(() => order.push('second locked'));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(order).toEqual(['first locked']);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(['first locked', 'first done', 'second locked']);
    });
  });
});
