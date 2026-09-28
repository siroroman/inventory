import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { itemPhotos } from '../../../src/db/schema/index.ts';
import { createItemRepository, type ItemFilter, type NewItem } from '../../../src/modules/items/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertLocation, insertManufacturer, insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

describe('item repository', () => {
  const t = useTestDb();
  const repo = () => createItemRepository(t().app);

  /** Centrála Praha › Přízemí výroba › Kuchyně, with Prodejna Brno beside it. */
  async function setup() {
    const user = await insertUser(t().app);
    const praha = await insertLocation(t().app, { name: 'Centrála Praha' });
    const prizemi = await insertLocation(t().app, { name: 'Přízemí výroba', parentId: praha.id });
    const kuchyne = await insertLocation(t().app, { name: 'Kuchyně', parentId: prizemi.id });
    const brno = await insertLocation(t().app, { name: 'Prodejna Brno' });
    const add = (name: string, locationId: string, extra: Partial<NewItem> = {}) =>
      repo().insert({ name, locationId, createdBy: user.id, ...extra });
    return { user, praha, prizemi, kuchyne, brno, add };
  }

  const names = async (filter: ItemFilter) =>
    (await repo().list(filter, { limit: 50 })).items.map((i) => i.name);

  it('inserts with a generated code and finds the item with its manufacturer', async () => {
    const { user, kuchyne, add } = await setup();
    const rational = await insertManufacturer(t().app, { name: 'Rational' });
    const item = await add('Konvektomat', kuchyne.id, { manufacturerId: rational.id, nextServiceOn: '2026-10-15' });
    expect(item).toMatchObject({ code: 'INV-00001', createdBy: user.id, updatedBy: user.id, nextServiceOn: '2026-10-15' });
    expect(await repo().findById(item.id)).toMatchObject({ manufacturer: { id: rational.id, name: 'Rational' } });
    expect((await repo().findById((await add('Stůl', kuchyne.id)).id))?.manufacturer).toBeNull();
    expect(await repo().findById(randomUUID())).toBeUndefined();
  });

  it('lists rows with location, manufacturer and the first photo as thumbnail', async () => {
    const { kuchyne, add } = await setup();
    const item = await add('Konvektomat', kuchyne.id);
    await t().app.insert(itemPhotos).values([
      { itemId: item.id, storageKey: 'b.jpg', contentType: 'image/jpeg', width: 1, height: 1, sortOrder: 2 },
      { itemId: item.id, storageKey: 'a.jpg', contentType: 'image/jpeg', width: 1, height: 1, sortOrder: 1 },
    ]);
    await add('Bez fotky', kuchyne.id);
    const { items } = await repo().list({}, { limit: 50 });
    expect(items.map((i) => [i.name, i.thumbnailKey, i.location.name, i.manufacturer])).toEqual([
      ['Bez fotky', null, 'Kuchyně', null],
      ['Konvektomat', 'a.jpg', 'Kuchyně', null],
    ]);
  });

  it.each([
    ['name', 'konvektomat'],
    ['code', 'inv-00001'],
    ['serial number', 'sn-77'],
    ['model', 'icombi'],
    ['external ID', 'el-4821'],
    ['manufacturer', 'RATIONAL'],
    ['location', 'kuchyne'],
    ['location two levels up', 'prizemi vyroba'],
  ])('finds an item by its %s', async (_, q) => {
    const { user, kuchyne, brno, add } = await setup();
    const rational = await insertManufacturer(t().app, { name: 'Rational' });
    const item = await add('Konvektomat', kuchyne.id, {
      manufacturerId: rational.id,
      model: 'iCombi Pro',
      serialNumber: 'SN-7781',
    });
    await repo().replaceExternalIds(item.id, [{ source: 'Elektrikář', value: 'EL-4821' }], user.id);
    await add('Žehlič prádla', brno.id);
    expect(await names({ q })).toEqual(['Konvektomat']);
  });

  it('matches diacritics-free queries and treats wildcards literally', async () => {
    const { kuchyne, add } = await setup();
    await add('Žehlič prádla', kuchyne.id);
    await add('Sleva 50%', kuchyne.id);
    await add('Sleva 500', kuchyne.id);
    expect(await names({ q: 'zehlic' })).toEqual(['Žehlič prádla']);
    expect(await names({ q: '50%' })).toEqual(['Sleva 50%']);
  });

  it('filters by location including its whole subtree', async () => {
    const { praha, prizemi, kuchyne, brno, add } = await setup();
    await add('V Praze', praha.id);
    await add('V přízemí', prizemi.id);
    await add('V kuchyni', kuchyne.id);
    await add('V Brně', brno.id);
    expect(await names({ locationId: prizemi.id })).toEqual(['V kuchyni', 'V přízemí']);
    expect(await repo().count({ locationId: praha.id })).toBe(3);
    expect(await names({ locationId: praha.id, q: 'kuchyni' })).toEqual(['V kuchyni']);
  });

  it('filters by manufacturer', async () => {
    const { kuchyne, add } = await setup();
    const daikin = await insertManufacturer(t().app, { name: 'Daikin' });
    await add('Klimatizace', kuchyne.id, { manufacturerId: daikin.id });
    await add('Stůl', kuchyne.id);
    expect(await names({ manufacturerId: daikin.id })).toEqual(['Klimatizace']);
  });

  it('hides archived items and pages in Czech order', async () => {
    const { user, kuchyne, add } = await setup();
    for (const name of ['Chladnička', 'Cedník', 'Čistič', 'Hrnec']) await add(name, kuchyne.id);
    const archived = await add('Archivní', kuchyne.id);
    await repo().setArchived(archived.id, 1, true, user.id);

    const first = await repo().list({}, { limit: 2 });
    const second = await repo().list({}, { limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map((i) => i.name)).toEqual(['Cedník', 'Čistič', 'Hrnec', 'Chladnička']);
    expect(second.nextCursor).toBeNull();
    expect(await repo().count({})).toBe(4);
  });

  it('updates with optimistic locking', async () => {
    const { user, kuchyne, brno, add } = await setup();
    const item = await add('Konvektomat', kuchyne.id);
    expect(await repo().update(item.id, 1, { locationId: brno.id, updatedBy: user.id })).toMatchObject({ locationId: brno.id, version: 2 });
    expect(await repo().update(item.id, 1, { name: 'stale', updatedBy: user.id })).toBeUndefined();
  });

  it('replaces external IDs and lists them by source', async () => {
    const { user, kuchyne, add } = await setup();
    const item = await add('Konvektomat', kuchyne.id);
    await repo().replaceExternalIds(item.id, [{ source: 'Vzduchotechnika', value: 'VZT-1' }, { source: 'Elektrikář', value: 'EL-1' }], user.id);
    // Saving the form again with the same IDs must not collide with the rows it replaces.
    await t().app.transaction((tx) =>
      createItemRepository(tx).replaceExternalIds(item.id, [{ source: 'Elektrikář', value: 'EL-1' }, { source: 'Revize', value: 'R-9' }], user.id),
    );
    expect((await repo().listExternalIds(item.id)).map((e) => `${e.source}: ${e.value}`)).toEqual(['Elektrikář: EL-1', 'Revize: R-9']);
    await repo().replaceExternalIds(item.id, [], user.id);
    expect(await repo().listExternalIds(item.id)).toEqual([]);
  });

  it('rejects an external ID another item already has', async () => {
    const { user, kuchyne, add } = await setup();
    const first = await add('První', kuchyne.id);
    const second = await add('Druhý', kuchyne.id);
    await repo().replaceExternalIds(first.id, [{ source: 'Elektrikář', value: 'EL-4821' }], user.id);
    await expectPgError(repo().replaceExternalIds(second.id, [{ source: 'elektrikář', value: 'EL-4821' }], user.id), {
      code: PG.uniqueViolation,
      constraint: 'item_external_ids_source_value_key',
    });
  });
});
