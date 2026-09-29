import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createItemService, itemRepos } from '../../../src/modules/items/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertLocation, insertManufacturer, insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database.
describe('item service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const service = createItemService({ repos: itemRepos(t().app), transact: transactor(t().app, itemRepos) });
    const praha = await insertLocation(t().app, { name: 'Centrála Praha' });
    const kuchyne = await insertLocation(t().app, { name: 'Kuchyně', parentId: praha.id });
    return { actor, service, repos: itemRepos(t().app), praha, kuchyne };
  }

  it('writes each change together with its audit entry', async () => {
    const { actor, service, repos, praha, kuchyne } = await setup();
    const rational = await insertManufacturer(t().app, { name: 'Rational' });
    const item = await service.create(actor, {
      name: 'Konvektomat',
      locationId: kuchyne.id,
      manufacturerId: rational.id,
      externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
    });
    await service.update(actor, item.id, { version: 1, locationId: praha.id, externalIds: [{ source: 'Servis', value: 'S-1' }] });
    await service.archive(actor, item.id, 2);
    await service.restore(actor, item.id, 3);

    const history = await repos.audit.list({ entityType: 'item', entityId: item.id }, { limit: 10 });
    expect(history.items.map((e) => e.action)).toEqual(['restore', 'archive', 'update', 'create']);
    expect(await service.get(actor, item.id)).toMatchObject({
      code: 'INV-00001',
      version: 4,
      manufacturer: { name: 'Rational' },
      externalIds: [expect.objectContaining({ source: 'Servis', value: 'S-1' })],
      path: [{ name: 'Centrála Praha' }],
    });
  });

  it('rejects an external ID that any item already uses, archived ones included, ignoring case', async () => {
    const { actor, service, repos, kuchyne } = await setup();
    const first = await service.create(actor, {
      name: 'Konvektomat',
      locationId: kuchyne.id,
      externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
    });
    await service.archive(actor, first.id, 1);

    await expectPgError(
      service.create(actor, {
        name: 'Sporák',
        locationId: kuchyne.id,
        externalIds: [{ source: 'ELEKTRIKÁŘ', value: 'el-4821' }],
      }),
      { code: PG.uniqueViolation, constraint: 'item_external_ids_source_value_key' },
    );
    expect(await repos.items.count({})).toBe(0);

    await expect(
      service.create(actor, { name: 'Sporák', locationId: kuchyne.id, externalIds: [{ source: 'Servis', value: 'EL-4821' }] }),
    ).resolves.toBeDefined();
  });
});
