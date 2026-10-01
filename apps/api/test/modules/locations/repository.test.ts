import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createLocationRepository,
  createLocationTypeRepository,
} from '../../../src/modules/locations/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertUser, locationTypeId } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

describe('location repository', () => {
  const t = useTestDb();
  const repo = () => createLocationRepository(t().app);

  async function setup() {
    const user = await insertUser(t().app);
    const hq = await locationTypeId(t().app, 'HQ');
    const add = (name: string, parentId: string | null = null) =>
      repo().insert({ name, parentId, locationTypeId: parentId ? null : hq, createdBy: user.id });
    return { user, add };
  }

  /** Centrála Praha › Přízemí › Kuchyně, plus Prodejna Brno. */
  async function tree() {
    const s = await setup();
    const praha = await s.add('Centrála Praha');
    const prizemi = await s.add('Přízemí', praha.id);
    const kuchyne = await s.add('Kuchyně', prizemi.id);
    const brno = await s.add('Prodejna Brno');
    return { ...s, praha, prizemi, kuchyne, brno };
  }

  it('inserts with a generated code and the author as both creator and last editor', async () => {
    const { user, add } = await setup();
    const row = await add('Centrála Praha');
    expect(row).toMatchObject({ code: 'LOC-001', createdBy: user.id, updatedBy: user.id, version: 1 });
  });

  it('finds a location with its type', async () => {
    const { praha, prizemi } = await tree();
    expect(await repo().findById(praha.id)).toMatchObject({ name: 'Centrála Praha', type: { code: 'HQ' } });
    expect(await repo().findById(prizemi.id)).toMatchObject({ name: 'Přízemí', type: null });
    expect(await repo().findById(randomUUID())).toBeUndefined();
  });

  it('lists top-level locations, or the direct children of one', async () => {
    const { praha, prizemi } = await tree();
    const names = async (parentId: string | null) =>
      (await repo().list({ parentId }, { limit: 50 })).items.map((l) => l.name);
    expect(await names(null)).toEqual(['Centrála Praha', 'Prodejna Brno']);
    expect(await names(praha.id)).toEqual(['Přízemí']);
    expect(await names(prizemi.id)).toEqual(['Kuchyně']);
  });

  it('searches every level when no parent is given, ignoring diacritics', async () => {
    await tree();
    const found = await repo().list({ q: 'KUCHYNE' }, { limit: 50 });
    expect(found.items.map((l) => l.name)).toEqual(['Kuchyně']);
    expect(await repo().count({ q: 'PRI' })).toBe(1); // Přízemí
  });

  it('pages in Czech order and hides archived locations', async () => {
    const { user, add } = await setup();
    for (const name of ['Žatec', 'Cheb', 'Čáslav', 'Brno', 'Říčany']) await add(name);
    const archived = await add('Archiv');
    await repo().setArchived(archived.id, 1, true, user.id);

    const first = await repo().list({ parentId: null }, { limit: 3 });
    const second = await repo().list({ parentId: null }, { limit: 3, cursor: first.nextCursor! });
    expect(first.items.map((l) => l.name)).toEqual(['Brno', 'Čáslav', 'Cheb']);
    expect(second.items.map((l) => l.name)).toEqual(['Říčany', 'Žatec']);
    expect(second.nextCursor).toBeNull();
    expect(await repo().count({ parentId: null })).toBe(5);
  });

  it('lists archived locations at every level when asked, and no active ones', async () => {
    const { user, add } = await setup();
    const brno = await add('Brno');
    await add('Cheb');
    await repo().setArchived(brno.id, 1, true, user.id);

    const archived = await repo().list({ archived: true }, { limit: 50 });
    expect(archived.items.map((l) => l.name)).toEqual(['Brno']);
    expect(await repo().count({ archived: true })).toBe(1);
    expect(await repo().count({ archived: true, q: 'cheb' })).toBe(0);
    expect(await repo().count({ parentId: null })).toBe(1);
  });

  it('returns the path from the top down for several locations at once', async () => {
    const { praha, prizemi, kuchyne, brno } = await tree();
    const paths = await repo().findPaths([kuchyne.id, brno.id]);
    expect(paths.get(kuchyne.id)?.map((p) => p.name)).toEqual(['Centrála Praha', 'Přízemí', 'Kuchyně']);
    expect(paths.get(kuchyne.id)?.map((p) => p.id)).toEqual([praha.id, prizemi.id, kuchyne.id]);
    expect(paths.get(brno.id)).toEqual([{ id: brno.id, code: brno.code, name: 'Prodejna Brno' }]);
    expect((await repo().findPaths([])).size).toBe(0);
  });

  it('counts active items in the whole subtree and active direct children', async () => {
    const { user, add, praha, prizemi, kuchyne, brno } = await tree();
    await add('Sklad', praha.id);
    await insertItem(t().app, { locationId: praha.id });
    await insertItem(t().app, { locationId: kuchyne.id });
    await insertItem(t().app, { locationId: kuchyne.id });
    await insertItem(t().app, { locationId: kuchyne.id, archivedAt: new Date() });

    const counts = await repo().countSubtree([praha.id, prizemi.id, brno.id]);
    expect(counts.get(praha.id)).toEqual({ itemCount: 3, childCount: 2 });
    expect(counts.get(prizemi.id)).toEqual({ itemCount: 2, childCount: 1 });
    expect(counts.get(brno.id)).toEqual({ itemCount: 0, childCount: 0 });

    // An archived sub-location hides its whole subtree from the counts above it.
    await repo().setArchived(prizemi.id, 1, true, user.id);
    expect((await repo().countSubtree([praha.id])).get(praha.id)).toEqual({ itemCount: 1, childCount: 1 });
  });

  it('updates with optimistic locking', async () => {
    const { user, praha, brno } = await tree();
    const moved = await repo().update(brno.id, 1, { parentId: praha.id, locationTypeId: null, updatedBy: user.id });
    expect(moved).toMatchObject({ parentId: praha.id, version: 2 });
    expect(await repo().update(brno.id, 1, { name: 'Stale', updatedBy: user.id })).toBeUndefined();
  });

  it('still refuses to move a location under its own descendant', async () => {
    const { user, praha, kuchyne } = await tree();
    await expectPgError(
      repo().update(praha.id, 1, { parentId: kuchyne.id, locationTypeId: null, updatedBy: user.id }),
      { code: PG.checkViolation, constraint: 'locations_no_cycle' },
    );
  });

  it('runs inside a caller transaction', async () => {
    const { user } = await setup();
    const hq = await locationTypeId(t().app);
    await expect(
      t().app.transaction(async (tx) => {
        await createLocationRepository(tx).insert({ name: 'Rolled back', locationTypeId: hq, createdBy: user.id });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repo().count({})).toBe(0);
  });
});

describe('location type repository', () => {
  const t = useTestDb();
  const repo = () => createLocationTypeRepository(t().app);

  it('lists the seeded types in display order', async () => {
    expect((await repo().list()).map((lt) => lt.code)).toEqual(['HQ', 'STORE', 'SITE', 'WAREHOUSE']);
  });

  it('adds, renames and finds a type', async () => {
    const user = await insertUser(t().app);
    const office = await repo().insert({ code: 'OFFICE', name: 'Kancelář', sortOrder: 50, createdBy: user.id });
    const renamed = await repo().update(office.id, 1, { name: 'Pobočka', updatedBy: user.id });
    expect(renamed).toMatchObject({ name: 'Pobočka', version: 2 });
    expect(await repo().findById(office.id)).toMatchObject({ code: 'OFFICE', name: 'Pobočka' });
    expect((await repo().list()).at(-1)?.code).toBe('OFFICE');
  });
});
