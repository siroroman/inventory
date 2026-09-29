import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createManufacturerService, manufacturerRepos } from '../../../src/modules/manufacturers/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertProvider, insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database.
describe('manufacturer service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const service = createManufacturerService({
      repos: manufacturerRepos(t().app),
      transact: transactor(t().app, manufacturerRepos),
    });
    return { actor, service, repos: manufacturerRepos(t().app) };
  }

  it('saves a reordered provider list and audits it', async () => {
    const { actor, service, repos } = await setup();
    const rational = await service.create(actor, { name: 'Rational' });
    const a = await insertProvider(t().app, { name: 'Servis A' });
    const b = await insertProvider(t().app, { name: 'Servis B' });

    await service.setProviders(actor, rational.id, [a.id, b.id]);
    const ranked = await service.setProviders(actor, rational.id, [b.id, a.id]);

    expect(ranked.map((p) => [p.name, p.priority])).toEqual([
      ['Servis B', 1],
      ['Servis A', 2],
    ]);
    const history = await repos.audit.list({ entityType: 'manufacturer', entityId: rational.id }, { limit: 10 });
    expect(history.items.map((e) => e.action)).toEqual(['update', 'update', 'create']);
    expect(history.items[0]!.changes).toEqual({ providers: { from: [a.id, b.id], to: [b.id, a.id] } });
  });

  it('leaves nothing behind when the database rejects a write', async () => {
    const { actor, service, repos } = await setup();
    await service.create(actor, { name: 'Rational' });
    await expectPgError(service.create(actor, { name: 'RATIONAL' }), {
      code: PG.uniqueViolation,
      constraint: 'manufacturers_name_lower_key',
    });
    expect(await repos.manufacturers.count({})).toBe(1);
  });
});
