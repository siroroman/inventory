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
      const gone = await row(patro.id, { outcome: 'missing' });
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, gone.itemId));

      const counts = (await repo().counts([inventory.id])).get(inventory.id);
      expect(counts).toEqual({ expected: 4, checked: 2, elsewhere: 1, new: 1, missing: 1 });
      expect((await repo().counts([crypto.randomUUID()])).size).toBe(0);
      expect((await repo().counts([])).size).toBe(0);
    });

    it('sums each location by the list, with the items found or added there apart', async () => {
      const { inventory, praha, patro, zasedacka, a, row, check } = await run();
      await row(praha.id, check(a.id, 1));
      await row(patro.id);
      await row(patro.id, check(a.id, 2));
      await row(patro.id, { outcome: 'missing' });
      const archived = await row(patro.id);
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archived.itemId));
      await row(patro.id, { kind: 'elsewhere', ...check(a.id, 3) });
      await row(praha.id, { kind: 'new', ...check(a.id, 4) });
      await row(zasedacka.id, { kind: 'elsewhere' }); // unticked: no row, so no location

      const progress = new Map((await repo().locationProgress(inventory.id)).map((p) => [p.locationId, p]));
      expect(progress.size).toBe(2);
      expect(progress.get(patro.id)).toEqual({ locationId: patro.id, total: 3, checked: 1, extra: 1, missing: 1 });
      expect(progress.get(praha.id)).toEqual({ locationId: praha.id, total: 1, checked: 1, extra: 1, missing: 0 });
    });

    it('keeps a location that holds only found items, with nothing on its list', async () => {
      const { inventory, zasedacka, a, row, check } = await run();
      await row(zasedacka.id, { kind: 'elsewhere', ...check(a.id, 1) });

      expect(await repo().locationProgress(inventory.id)).toEqual([
        { locationId: zasedacka.id, total: 0, checked: 0, extra: 1, missing: 0 },
      ]);
    });

    it('settles the unchecked rows of the list at the finish: flagged ones stay missing, archived ones are skipped, the rest has no outcome', async () => {
      const { inventory, praha, patro, a, row, check } = await run();
      const checked = await row(praha.id, check(a.id, 1));
      const flagged = await row(patro.id, { outcome: 'missing' });
      const plain = await row(patro.id);
      const archived = await row(patro.id);
      const archivedFlagged = await row(patro.id, { outcome: 'missing' });
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archived.itemId));
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archivedFlagged.itemId));
      const found = await row(patro.id, { kind: 'elsewhere', ...check(a.id, 2) });
      const unticked = await row(patro.id, { kind: 'elsewhere' });

      expect(await repo().settleUnchecked(inventory.id)).toBe(1);
      expect(await repo().settleUnchecked(inventory.id)).toBe(1); // idempotent

      const rows = await t().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, inventory.id));
      const outcome = (itemId: string) => rows.find((r) => r.itemId === itemId)!.outcome;
      expect(outcome(checked.itemId)).toBeNull();
      expect(outcome(flagged.itemId)).toBe('missing');
      expect(outcome(plain.itemId)).toBeNull();
      expect(outcome(archived.itemId)).toBe('skipped');
      expect(outcome(archivedFlagged.itemId)).toBe('skipped');
      expect(outcome(found.itemId)).toBeNull();
      expect(outcome(unticked.itemId)).toBeNull();
      // The skipped rows are not counted as missing, nor are the archived items on the list.
      expect((await repo().counts([inventory.id])).get(inventory.id)).toMatchObject({ expected: 3, checked: 1, missing: 1 });
    });

    it('takes back what a finish set, and leaves the flags people set', async () => {
      const { inventory, praha, a, row, check } = await run();
      const flagged = await row(praha.id, { outcome: 'missing' });
      const archived = await row(praha.id, { outcome: 'skipped' });
      const checked = await row(praha.id, check(a.id, 1));

      expect(await repo().clearSkipped(inventory.id)).toBe(1);
      expect(await repo().clearSkipped(inventory.id)).toBe(0);

      const rows = await t().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, inventory.id));
      const outcome = (itemId: string) => rows.find((r) => r.itemId === itemId)!.outcome;
      expect(outcome(flagged.itemId)).toBe('missing');
      expect(outcome(archived.itemId)).toBeNull();
      expect(outcome(checked.itemId)).toBeNull();
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

  describe('run items', () => {
    async function run() {
      const { praha, patro, zasedacka, brno } = await tree();
      const [anna, boris] = [await insertUser(t().app, { name: 'Anna' }), await insertUser(t().app, { name: 'Boris' })];
      const inventory = await insertInventory(t().app, { locationId: praha.id, createdBy: anna.id, createdAt: at(0) });
      /** A row for a new item with this name, in the run's location `locationId`. */
      const row = async (name: string, locationId: string, overrides: Partial<typeof inventoryItems.$inferInsert> = {}) => {
        const item = await insertItem(t().app, { name, locationId });
        return insertInventoryItem(t().app, { inventoryId: inventory.id, itemId: item.id, locationId, ...overrides });
      };
      const check = (by: string, minutes: number) => ({ checkedAt: at(minutes), checkedBy: by, method: 'manual' as const });
      return { inventory, praha, patro, zasedacka, brno, anna, boris, row, check };
    }

    it('lists the rows a person sees by item name in Czech order, with who checked them', async () => {
      const { inventory, praha, patro, anna, row, check } = await run();
      await row('Žebřík', praha.id);
      await row('Mixér', praha.id, { ...check(anna.id, 3), method: 'scan' });
      await row('Čepice', patro.id);
      await row('Cukřenka', patro.id);

      const rows = await repo().runItems(inventory.id);

      expect(rows.map((r) => r.name)).toEqual(['Cukřenka', 'Čepice', 'Mixér', 'Žebřík']);
      expect(rows.find((r) => r.name === 'Mixér')).toMatchObject({
        code: expect.stringMatching(/^INV-/),
        kind: 'expected',
        locationId: praha.id,
        checkedAt: at(3),
        checkedBy: { id: anna.id, name: 'Anna' },
        method: 'scan',
        itemArchived: false,
        moved: false,
        registeredLocationId: null,
      });
      expect(rows.find((r) => r.name === 'Žebřík')).toMatchObject({ checkedAt: null, checkedBy: null, method: null });
    });

    it('can be limited to one location of the run', async () => {
      const { inventory, praha, patro, row } = await run();
      await row('Tiskárna', praha.id);
      await row('Projektor', patro.id);
      expect((await repo().runItems(inventory.id, patro.id)).map((r) => r.name)).toEqual(['Projektor']);
      expect((await repo().runItems(inventory.id, praha.id)).map((r) => r.name)).toEqual(['Tiskárna']);
      expect(await repo().runItems(inventory.id, crypto.randomUUID())).toEqual([]);
    });

    it('leaves out archived items and found or added items that are not checked, and rows of other runs', async () => {
      const { inventory, praha, brno, anna, row, check } = await run();
      await row('Zůstává', praha.id);
      const archived = await row('Vyřazeno', praha.id, check(anna.id, 1));
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archived.itemId));
      await row('Nalezeno jinde', praha.id, { kind: 'elsewhere', registeredLocationId: brno.id, ...check(anna.id, 2) });
      await row('Odškrtnuto', praha.id, { kind: 'elsewhere' });
      await row('Nová věc', praha.id, { kind: 'new', ...check(anna.id, 3) });
      await row('Nová neodškrtnutá', praha.id, { kind: 'new' });
      await insertInventoryItem(t().app, { locationId: praha.id }); // another run

      const rows = await repo().runItems(inventory.id);
      expect(rows.map((r) => [r.name, r.kind])).toEqual([
        ['Nalezeno jinde', 'elsewhere'],
        ['Nová věc', 'new'],
        ['Zůstává', 'expected'],
      ]);
      expect(rows[0]!.registeredLocationId).toBe(brno.id);
    });

    it('tells a moved item from one that stayed', async () => {
      const { inventory, praha, anna, row, check } = await run();
      await row('Přesunuto', praha.id, { kind: 'elsewhere', movedAt: at(4), movedBy: anna.id, ...check(anna.id, 4) });
      expect((await repo().runItems(inventory.id))[0]).toMatchObject({ moved: true });
    });

    it('finds the row of an item even when a person would not see it', async () => {
      const { inventory, praha, row } = await run();
      const hidden = await row('Odškrtnuto', praha.id, { kind: 'new' });
      const archived = await row('Vyřazeno', praha.id);
      await t().owner.update(items).set({ archivedAt: new Date() }).where(eq(items.id, archived.itemId));

      expect(await repo().findRunItem(inventory.id, hidden.itemId)).toMatchObject({ name: 'Odškrtnuto', kind: 'new' });
      expect(await repo().findRunItem(inventory.id, archived.itemId)).toMatchObject({ itemArchived: true });
      expect(await repo().findRunItem(inventory.id, crypto.randomUUID())).toBeUndefined();
      expect(await repo().findRunItem(crypto.randomUUID(), hidden.itemId)).toBeUndefined();
    });

    it('lets the first check win and only a check be cleared', async () => {
      const { inventory, praha, anna, boris, row } = await run();
      const { itemId } = await row('Mixér', praha.id);
      const tick = (by: string, minutes: number) =>
        repo().markChecked(inventory.id, itemId, { checkedAt: at(minutes), checkedBy: by, method: 'manual' });

      expect(await repo().markUnchecked(inventory.id, itemId)).toBe(false);
      expect(await tick(anna.id, 1)).toBe(true);
      expect(await tick(boris.id, 2)).toBe(false);
      expect(await repo().findRunItem(inventory.id, itemId)).toMatchObject({
        checkedAt: at(1),
        checkedBy: { id: anna.id },
        method: 'manual',
      });

      expect(await repo().markUnchecked(inventory.id, itemId)).toBe(true);
      expect(await repo().markUnchecked(inventory.id, itemId)).toBe(false);
      expect(await repo().findRunItem(inventory.id, itemId)).toMatchObject({ checkedAt: null, checkedBy: null, method: null });
      expect(await tick(boris.id, 3)).toBe(true);
    });

    it('flags an unchecked item of the list as missing, and takes the flag back', async () => {
      const { inventory, praha, row } = await run();
      const { itemId } = await row('Mixér', praha.id);
      const find = async () => (await repo().findRunItem(inventory.id, itemId))!;

      expect(await repo().unmarkMissing(inventory.id, itemId)).toBe(false);
      expect(await repo().markMissing(inventory.id, itemId)).toBe(true);
      expect(await find()).toMatchObject({ missing: true, checkedAt: null });
      expect(await repo().markMissing(inventory.id, itemId)).toBe(false);
      // The flagged row is still listed, and counted as missing.
      expect((await repo().runItems(inventory.id)).map((r) => [r.name, r.missing])).toEqual([['Mixér', true]]);
      expect((await repo().counts([inventory.id])).get(inventory.id)).toMatchObject({ expected: 1, checked: 0, missing: 1 });

      expect(await repo().unmarkMissing(inventory.id, itemId)).toBe(true);
      expect(await find()).toMatchObject({ missing: false });
      expect(await repo().unmarkMissing(inventory.id, itemId)).toBe(false);
    });

    it('does not flag a checked row or a row that is not on the list', async () => {
      const { inventory, praha, anna, row, check } = await run();
      const checked = await row('Zkontrolováno', praha.id, check(anna.id, 1));
      const found = await row('Nalezeno jinde', praha.id, { kind: 'elsewhere', ...check(anna.id, 2) });
      const added = await row('Nová', praha.id, { kind: 'new', ...check(anna.id, 3) });

      for (const { itemId } of [checked, found, added]) {
        expect(await repo().markMissing(inventory.id, itemId)).toBe(false);
      }
      expect(await repo().markMissing(inventory.id, crypto.randomUUID())).toBe(false);
      expect((await repo().runItems(inventory.id)).some((r) => r.missing)).toBe(false);
    });

    it('takes the flag back with a check', async () => {
      const { inventory, praha, anna, row } = await run();
      const { itemId } = await row('Mixér', praha.id, { outcome: 'missing' });

      expect(await repo().markChecked(inventory.id, itemId, { checkedAt: at(1), checkedBy: anna.id, method: 'scan' })).toBe(true);

      expect(await repo().findRunItem(inventory.id, itemId)).toMatchObject({ missing: false, checkedAt: at(1) });
      expect((await repo().counts([inventory.id])).get(inventory.id)).toMatchObject({ checked: 1, missing: 0 });
    });

    it('leaves the version of the run alone', async () => {
      const { inventory, praha, anna, row } = await run();
      const { itemId } = await row('Mixér', praha.id);
      await repo().markChecked(inventory.id, itemId, { checkedAt: at(1), checkedBy: anna.id, method: 'manual' });
      expect(await repo().findById(inventory.id)).toMatchObject({ version: 1 });
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

    it('lets checks share the row, but makes a finish or cancel wait for them', async () => {
      const run = await insertInventory(t().app);
      const order: string[] = [];
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = t().app.transaction(async (tx) => {
        await createInventoryRepository(tx).lockShared(run.id);
        order.push('first shared');
        await hold;
        order.push('first done');
      });
      await expect.poll(() => order).toEqual(['first shared']);
      // Another check goes on at once.
      await t().app.transaction(async (tx) => {
        await createInventoryRepository(tx).lockShared(run.id);
        order.push('second shared');
      });
      const exclusive = createInventoryRepository(t().app)
        .lock(run.id)
        .then(() => order.push('exclusive'));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(order).toEqual(['first shared', 'second shared']);
      release();
      await Promise.all([first, exclusive]);
      expect(order).toEqual(['first shared', 'second shared', 'first done', 'exclusive']);
    });
  });
});
