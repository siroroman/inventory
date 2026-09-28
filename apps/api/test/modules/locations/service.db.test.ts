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
