import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { InvalidCursorError } from '../../../src/db/pagination.ts';
import { createServiceRecordRepository } from '../../../src/modules/service-records/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertLocation, insertUser } from '../../helpers/factories.ts';

describe('service record repository', () => {
  const t = useTestDb();
  const repo = () => createServiceRecordRepository(t().app);

  async function setup() {
    const user = await insertUser(t().app);
    const item = await insertItem(t().app);
    const add = (title: string, performedOn: string, itemId = item.id) =>
      repo().insert({ itemId, title, performedOn, createdBy: user.id });
    return { user, item, add };
  }

  it('inserts, finds and updates with optimistic locking', async () => {
    const { user, item, add } = await setup();
    const record = await add('Výměna filtru', '2026-04-15');
    expect(record).toMatchObject({ itemId: item.id, createdBy: user.id, updatedBy: user.id, performedBy: null, version: 1 });
    const updated = await repo().update(record.id, 1, { performedBy: 'Servis Novák', updatedBy: user.id });
    expect(updated).toMatchObject({ performedBy: 'Servis Novák', version: 2 });
    expect(await repo().update(record.id, 1, { title: 'stale', updatedBy: user.id })).toBeUndefined();
    expect(await repo().findById(record.id)).toMatchObject({ version: 2, title: 'Výměna filtru' });
  });

  it('lists an item newest first, pages through ties on the same day and ignores other items', async () => {
    const { item, add } = await setup();
    const other = await insertItem(t().app);
    await add('Starší', '2025-06-20');
    const a = await add('Stejný den A', '2026-04-15');
    const b = await add('Stejný den B', '2026-04-15');
    await add('Cizí', '2026-05-01', other.id);

    const all = await repo().listByItem(item.id, { limit: 50 });
    expect(all.items.map((r) => r.title).at(-1)).toBe('Starší');
    expect(all.items).toHaveLength(3);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo().listByItem(item.id, { limit: 1, cursor });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(all.items.map((r) => r.id)));
    expect(seen.slice(0, 2).sort()).toEqual([a.id, b.id].sort());
    expect(await repo().countByItem(item.id)).toBe(3);
  });

  it('leaves archived records out of the list and the count, and restores them', async () => {
    const { user, item, add } = await setup();
    const record = await add('Smazaný', '2026-01-10');
    await add('Zůstává', '2026-02-10');

    expect(await repo().setArchived(record.id, 1, true, user.id)).toMatchObject({ version: 2, updatedBy: user.id });
    expect((await repo().listByItem(item.id, { limit: 50 })).items.map((r) => r.title)).toEqual(['Zůstává']);
    expect(await repo().countByItem(item.id)).toBe(1);
    expect(await repo().findById(record.id)).toMatchObject({ archivedAt: expect.any(Date) });
    expect(await repo().setArchived(record.id, 1, false, user.id)).toBeUndefined();

    await repo().setArchived(record.id, 2, false, user.id);
    expect(await repo().countByItem(item.id)).toBe(2);
  });

  it('rejects a cursor this API did not issue', async () => {
    const { item } = await setup();
    await expect(repo().listByItem(item.id, { limit: 5, cursor: 'garbage' })).rejects.toThrow(InvalidCursorError);
  });

  describe('listing all records', () => {
    /** Kávovar in Centrála Praha › Teplá kuchyně, Židle without a location, Myčka in its own location. */
    async function history() {
      const { user, add } = await setup();
      const top = await insertLocation(t().app, { name: 'Centrála Praha' });
      const kitchen = await insertLocation(t().app, { name: 'Teplá kuchyně', parentId: top.id });
      const coffee = await insertItem(t().app, { name: 'Kávovar Linea', locationId: kitchen.id });
      const chair = await insertItem(t().app, { name: 'Židle', locationId: null });
      const washer = await insertItem(t().app, {
        name: 'Myčka',
        locationId: (await insertLocation(t().app, { name: 'Sklad Brno' })).id,
      });
      return {
        user,
        add,
        coffee,
        chair,
        washer,
        kitchen,
        old: await add('Roční prohlídka', '2025-11-02', coffee.id),
        filter: await add('Výměna filtru', '2026-04-15', coffee.id),
        leg: await add('Oprava nohy', '2026-02-01', chair.id),
        rinse: await add('Oplach', '2026-01-10', washer.id),
      };
    }
    const titles = async (filter: Parameters<ReturnType<typeof repo>['list']>[0], limit = 50) =>
      (await repo().list(filter, { limit })).items.map((r) => r.title);

    it('lists records of all items newest first with the item and its location', async () => {
      const { coffee, kitchen, chair } = await history();
      const page = await repo().list({}, { limit: 50 });
      expect(page.items.map((r) => r.title)).toEqual(['Výměna filtru', 'Oprava nohy', 'Oplach', 'Roční prohlídka']);
      expect(page.items[0]).toMatchObject({
        item: { id: coffee.id, code: coffee.code, name: 'Kávovar Linea' },
        location: { id: kitchen.id, name: 'Teplá kuchyně' },
      });
      expect(page.items[1]).toMatchObject({ item: { id: chair.id }, location: null });
      expect(await repo().count({})).toBe(4);
    });

    it('pages through ties on the same day', async () => {
      const { add, coffee } = await history();
      await add('Stejný den A', '2026-04-15', coffee.id);
      await add('Stejný den B', '2026-04-15', coffee.id);
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repo().list({}, { limit: 2, cursor });
        seen.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
    });

    it('searches the title, the item name and code and every location on the path, ignoring diacritics and case', async () => {
      const { coffee } = await history();
      const found = ['Výměna filtru', 'Roční prohlídka'];
      expect(await titles({ q: 'PROHLIDKA' })).toEqual(['Roční prohlídka']);
      expect(await titles({ q: 'kavovar' })).toEqual(found);
      expect(await titles({ q: coffee.code.toLowerCase() })).toEqual(found);
      expect(await titles({ q: 'tepla kuchyne' })).toEqual(found);
      expect(await titles({ q: 'kuchyne' })).toEqual(found);
      expect(await titles({ q: 'centrala' })).toEqual(found);
      expect(await titles({ q: 'nic takového' })).toEqual([]);
      expect(await repo().count({ q: 'centrala' })).toBe(2);
    });

    it('keeps the records of an archived location out of a path search, but finds them when looking for archived ones', async () => {
      const { user, kitchen, filter } = await history();
      await t().app.execute(sql`UPDATE locations SET archived_at = now() WHERE id = ${kitchen.id}`);
      expect(await titles({ q: 'kuchyne' })).toEqual([]);
      await repo().setArchived(filter.id, 1, true, user.id);
      expect(await titles({ q: 'kuchyne', archived: true })).toEqual(['Výměna filtru']);
    });

    it('lists the archived records instead of the active ones, whatever their item', async () => {
      const { user, filter, rinse, washer } = await history();
      await repo().setArchived(filter.id, 1, true, user.id);
      expect(await titles({})).toEqual(['Oprava nohy', 'Oplach', 'Roční prohlídka']);
      expect(await titles({ archived: true })).toEqual(['Výměna filtru']);
      expect(await repo().count({ archived: true })).toBe(1);
      await t().app.execute(sql`UPDATE items SET archived_at = now() WHERE id = ${washer.id}`);
      expect(await titles({})).toContain(rinse.title);
    });

    it('rejects a cursor this API did not issue', async () => {
      await expect(repo().list({}, { limit: 5, cursor: 'garbage' })).rejects.toThrow(InvalidCursorError);
    });
  });
});
