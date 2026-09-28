import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPhotoRepository } from '../../../src/modules/photos/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertUser } from '../../helpers/factories.ts';

describe('photo repository', () => {
  const t = useTestDb();
  const repo = () => createPhotoRepository(t().app);

  async function setup() {
    const user = await insertUser(t().app);
    const item = await insertItem(t().app);
    const add = (storageKey: string, itemId = item.id) =>
      repo().insert({ itemId, storageKey, contentType: 'image/webp', width: 2048, height: 1536, createdBy: user.id });
    const keys = async (itemId = item.id) => (await repo().list(itemId)).map((p) => p.storageKey);
    return { user, item, add, keys };
  }

  it('appends new photos at the end of the gallery', async () => {
    const { item, add, keys } = await setup();
    expect((await add('a.webp')).sortOrder).toBe(1);
    expect((await add('b.webp')).sortOrder).toBe(2);
    await add('c.webp');
    expect(await keys()).toEqual(['a.webp', 'b.webp', 'c.webp']);
    expect(await repo().count(item.id)).toBe(3);
  });

  it('reorders the gallery', async () => {
    const { item, add, keys } = await setup();
    const [a, b, c] = [await add('a.webp'), await add('b.webp'), await add('c.webp')];
    expect(await repo().reorder(item.id, [c.id, a.id, b.id])).toBe(3);
    expect(await keys()).toEqual(['c.webp', 'a.webp', 'b.webp']);
  });

  it('ignores photos of other items when reordering', async () => {
    const { item, add, keys } = await setup();
    const other = await insertItem(t().app, { locationId: item.locationId });
    const mine = await add('mine.webp');
    const theirs = await add('theirs.webp', other.id);
    expect(await repo().reorder(item.id, [theirs.id, mine.id])).toBe(1);
    expect(await keys(other.id)).toEqual(['theirs.webp']);
    expect((await repo().list(other.id))[0]?.sortOrder).toBe(1);
  });

  it('deletes a photo of the given item and returns it', async () => {
    const { item, add, keys } = await setup();
    const a = await add('a.webp');
    await add('b.webp');
    expect(await repo().delete(item.id, a.id)).toMatchObject({ storageKey: 'a.webp' });
    expect(await keys()).toEqual(['b.webp']);
    expect(await repo().delete(item.id, a.id)).toBeUndefined();
    expect(await repo().delete(randomUUID(), (await repo().list(item.id))[0]!.id)).toBeUndefined();
    expect(await keys()).toEqual(['b.webp']);
  });
});
