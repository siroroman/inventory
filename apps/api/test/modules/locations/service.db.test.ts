import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createLocationService, locationRepos } from '../../../src/modules/locations/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertUser, locationTypeId } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database.
describe('location service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const service = createLocationService({ repos: locationRepos(t().app), transact: transactor(t().app, locationRepos) });
    return { actor, service, repos: locationRepos(t().app), hq: await locationTypeId(t().app) };
  }

  it('writes each change together with its audit entry', async () => {
    const { actor, service, repos, hq } = await setup();
    const praha = await service.create(actor, { name: 'Centrála Praha', locationTypeId: hq });
    const brno = await service.create(actor, { name: 'Prodejna Brno', locationTypeId: hq });
    await service.update(actor, brno.id, { version: 1, parentId: praha.id });
    await service.archive(actor, brno.id, 2);
    await service.restore(actor, brno.id, 3);

    const history = await repos.audit.list({ entityType: 'location', entityId: brno.id }, { limit: 10 });
    expect(history.items.map((e) => e.action)).toEqual(['restore', 'archive', 'update', 'create']);
    expect(await service.get(actor, brno.id)).toMatchObject({
      version: 4,
      locationTypeId: null,
      path: [{ name: 'Centrála Praha' }, { name: 'Prodejna Brno' }],
    });
  });

  it('leaves nothing behind when the database rejects a write', async () => {
    const { actor, service, repos, hq } = await setup();
    await expectPgError(service.create(actor, { name: '   ', locationTypeId: hq }), {
      code: PG.checkViolation,
      constraint: 'locations_name_not_blank',
    });
    expect(await repos.locations.count({})).toBe(0);
  });
});

describe('location contacts with the database', () => {
  const t = useTestDb();

  it('are replaced in the order sent, inherited by a sub-location, and audited with the location', async () => {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const repos = locationRepos(t().app);
    const service = createLocationService({ repos, transact: transactor(t().app, locationRepos) });
    const hq = await locationTypeId(t().app);

    const brno = await service.create(actor, {
      name: 'Centrála Brno',
      locationTypeId: hq,
      contacts: [{ role: 'Správce', phone: '601 123 456' }, { role: 'Majitel', email: 'majitel@example.cz' }],
    });
    const updated = await service.update(actor, brno.id, {
      version: 1,
      contacts: [{ role: 'Majitel', email: 'majitel@example.cz' }, { role: 'Prodejna', name: 'Pokladna', phone: '495 111 222' }],
    });
    expect(updated.contacts.map((c) => [c.sortOrder, c.role])).toEqual([[0, 'Majitel'], [1, 'Prodejna']]);

    const floor = await service.create(actor, { name: 'Přízemí', parentId: brno.id });
    expect((await service.get(actor, floor.id)).inheritedContacts).toMatchObject([
      { location: { id: brno.id }, contacts: [{ role: 'Majitel' }, { role: 'Prodejna' }] },
    ]);

    const history = await repos.audit.list({ entityType: 'location', entityId: brno.id }, { limit: 10 });
    expect(history.items[0]?.changes).toEqual({
      contacts: {
        from: ['Správce · 601 123 456', 'Majitel · majitel@example.cz'],
        to: ['Majitel · majitel@example.cz', 'Prodejna · Pokladna · 495 111 222'],
      },
    });
  });
});
