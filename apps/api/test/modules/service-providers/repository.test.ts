import { describe, expect, it } from 'vitest';
import { createManufacturerRepository } from '../../../src/modules/manufacturers/repository.ts';
import { createServiceProviderRepository } from '../../../src/modules/service-providers/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertManufacturer, insertUser } from '../../helpers/factories.ts';

describe('service provider repository', () => {
  const t = useTestDb();
  const repo = () => createServiceProviderRepository(t().app);

  async function setup() {
    const user = await insertUser(t().app);
    const add = (name: string) => repo().insert({ name, createdBy: user.id });
    return { user, add };
  }

  it('inserts with a generated code, finds and updates with optimistic locking', async () => {
    const { user, add } = await setup();
    const p = await add('Servis Novák s.r.o.');
    expect(p).toMatchObject({ code: 'SUP-001', createdBy: user.id, updatedBy: user.id });
    const updated = await repo().update(p.id, 1, { phone: '+420 601 234 567', updatedBy: user.id });
    expect(updated).toMatchObject({ phone: '+420 601 234 567', version: 2 });
    expect(await repo().update(p.id, 1, { phone: 'stale', updatedBy: user.id })).toBeUndefined();
    expect(await repo().findById(p.id)).toMatchObject({ version: 2 });
  });

  it('keeps an imported code', async () => {
    const { user } = await setup();
    expect(await repo().insert({ name: 'Import', code: 'SUP-900', createdBy: user.id })).toMatchObject({ code: 'SUP-900' });
  });

  it('lists active providers in Czech order and searches without diacritics', async () => {
    const { user, add } = await setup();
    for (const name of ['Čistírna Kolín', 'Chladservis', 'Elektro Dvořák']) await add(name);
    const archived = await add('Zrušený');
    await repo().setArchived(archived.id, 1, true, user.id);

    expect((await repo().list({}, { limit: 50 })).items.map((p) => p.name)).toEqual([
      'Čistírna Kolín',
      'Elektro Dvořák',
      'Chladservis',
    ]);
    expect((await repo().list({ q: 'dvorak' }, { limit: 50 })).items.map((p) => p.name)).toEqual(['Elektro Dvořák']);
    expect(await repo().count({})).toBe(3);
  });

  it('searches the code and the phone ignoring spaces, and lists the archived ones on request', async () => {
    const { user, add } = await setup();
    const alfa = await add('Alfa');
    await repo().update(alfa.id, 1, { phone: '+420 601 123 456', updatedBy: user.id });
    const beta = await add('Beta');
    await repo().setArchived(beta.id, 1, true, user.id);

    const names = async (filter: { q?: string; archived?: boolean }) =>
      (await repo().list(filter, { limit: 50 })).items.map((p) => p.name);
    expect(await names({ q: 'sup-001' })).toEqual(['Alfa']);
    expect(await names({ q: '601123' })).toEqual(['Alfa']);
    expect(await names({ q: '601 123' })).toEqual(['Alfa']);
    // A number pasted from a web page often has non-breaking spaces, which go the same way.
    const gama = await add('Gama');
    await repo().update(gama.id, 1, { phone: '+420\u00a0777\u00a0234\u00a0111', updatedBy: user.id });
    expect(await names({ q: '777234' })).toEqual(['Gama']);
    expect(await names({ q: 'sup-002' })).toEqual([]);
    expect(await names({ archived: true })).toEqual(['Beta']);
    expect(await names({ archived: true, q: 'sup-002' })).toEqual(['Beta']);
    expect(await repo().count({ archived: true })).toBe(1);
  });

  it('finds a provider by the name of a brand it services, once, whatever else matches', async () => {
    const { user, add } = await setup();
    const first = await add('Rational servis');
    const second = await add('Druhý');
    await add('Třetí');
    const rational = await insertManufacturer(t().app, { name: 'Rational' });
    const unox = await insertManufacturer(t().app, { name: 'Unox' });
    const manufacturers = createManufacturerRepository(t().app);
    await manufacturers.replaceProviders(rational.id, [first.id, second.id], user.id);
    await manufacturers.replaceProviders(unox.id, [second.id], user.id);

    const names = async (q: string) => (await repo().list({ q }, { limit: 50 })).items.map((p) => p.name);
    // "Rational servis" matches by its name and by its brand: listed once.
    expect(await names('rational')).toEqual(['Druhý', 'Rational servis']);
    expect(await names('uno')).toEqual(['Druhý']);
    expect(await repo().count({ q: 'rational' })).toBe(2);
  });

  it('lists the brands it services with its priority for each', async () => {
    const { user, add } = await setup();
    const first = await add('První');
    const second = await add('Druhý');
    const rational = await insertManufacturer(t().app, { name: 'Rational' });
    const daikin = await insertManufacturer(t().app, { name: 'Daikin' });
    const manufacturers = createManufacturerRepository(t().app);
    await manufacturers.replaceProviders(rational.id, [first.id, second.id], user.id);
    await manufacturers.replaceProviders(daikin.id, [second.id], user.id);

    expect(await repo().listManufacturers(second.id)).toEqual([
      { id: daikin.id, name: 'Daikin', archivedAt: null, priority: 1 },
      { id: rational.id, name: 'Rational', archivedAt: null, priority: 2 },
    ]);
  });
});
