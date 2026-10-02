import { describe, expect, it } from 'vitest';
import { InvalidCursorError } from '../../../src/db/pagination.ts';
import { createServiceRecordRepository } from '../../../src/modules/service-records/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertUser } from '../../helpers/factories.ts';

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
});
