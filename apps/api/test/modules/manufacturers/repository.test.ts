import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createManufacturerRepository } from '../../../src/modules/manufacturers/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertProvider, insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

describe('manufacturer repository', () => {
  const t = useTestDb();
  const repo = () => createManufacturerRepository(t().app);

  async function setup() {
    const user = await insertUser(t().app);
    const add = (name: string) => repo().insert({ name, createdBy: user.id });
    return { user, add };
  }

  it('inserts, finds and updates with optimistic locking', async () => {
    const { user, add } = await setup();
    const m = await add('Rational');
    expect(m).toMatchObject({ createdBy: user.id, updatedBy: user.id, version: 1 });
    expect(await repo().findById(m.id)).toMatchObject({ name: 'Rational' });
    expect(await repo().update(m.id, 1, { note: 'Konvektomaty', updatedBy: user.id })).toMatchObject({ version: 2 });
    expect(await repo().update(m.id, 1, { note: 'stale', updatedBy: user.id })).toBeUndefined();
    expect(await repo().findById(randomUUID())).toBeUndefined();
  });

  it('finds by name ignoring case, archived included', async () => {
    const { user, add } = await setup();
    const m = await add('Kärcher');
    await repo().setArchived(m.id, 1, true, user.id);
    expect((await repo().findByName('KÄRCHER'))?.id).toBe(m.id);
    expect(await repo().findByName('Karcher')).toBeUndefined();
  });

  it('lists active manufacturers in Czech order and searches without diacritics', async () => {
    const { user, add } = await setup();
    for (const name of ['Škoda', 'Siemens', 'Bosch', 'Electrolux']) await add(name);
    const archived = await add('Archivní');
    await repo().setArchived(archived.id, 1, true, user.id);

    const first = await repo().list({}, { limit: 2 });
    const second = await repo().list({}, { limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map((m) => m.name)).toEqual(['Bosch', 'Electrolux', 'Siemens', 'Škoda']);
    expect((await repo().list({ q: 'skoda' }, { limit: 50 })).items.map((m) => m.name)).toEqual(['Škoda']);
    expect(await repo().count({})).toBe(4);
  });

  it('replaces and lists the provider order', async () => {
    const { user, add } = await setup();
    const m = await add('Daikin');
    const a = await insertProvider(t().app, { name: 'A' });
    const b = await insertProvider(t().app, { name: 'B' });
    const c = await insertProvider(t().app, { name: 'C' });
    const replace = (ids: string[]) =>
      t().app.transaction((tx) => createManufacturerRepository(tx).replaceProviders(m.id, ids, user.id));

    await replace([a.id, b.id, c.id]);
    expect((await repo().listProviders(m.id)).map((p) => [p.name, p.priority])).toEqual([['A', 1], ['B', 2], ['C', 3]]);

    // Moving C up one step sends the whole new order.
    await replace([a.id, c.id, b.id]);
    expect((await repo().listProviders(m.id)).map((p) => p.name)).toEqual(['A', 'C', 'B']);

    await repo().replaceProviders(m.id, [], user.id);
    expect(await repo().listProviders(m.id)).toEqual([]);
  });

  it('rejects the same provider twice in one order', async () => {
    const { user, add } = await setup();
    const m = await add('Hobart');
    const p = await insertProvider(t().app);
    await expectPgError(repo().replaceProviders(m.id, [p.id, p.id], user.id), {
      code: PG.uniqueViolation,
      constraint: 'manufacturer_service_providers_pkey',
    });
  });

  it('keeps other manufacturers\' orders untouched', async () => {
    const { user, add } = await setup();
    const [m1, m2] = [await add('M1'), await add('M2')];
    const p = await insertProvider(t().app);
    await repo().replaceProviders(m1.id, [p.id], user.id);
    await repo().replaceProviders(m2.id, [p.id], user.id);
    await repo().replaceProviders(m1.id, [], user.id);
    expect(await repo().listProviders(m2.id)).toHaveLength(1);
  });
});
