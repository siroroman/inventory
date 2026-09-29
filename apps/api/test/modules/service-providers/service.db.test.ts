import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createManufacturerService, manufacturerRepos } from '../../../src/modules/manufacturers/service.ts';
import { createServiceProviderService, serviceProviderRepos } from '../../../src/modules/service-providers/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertManufacturer, insertProvider, insertUser } from '../../helpers/factories.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database.
describe('service provider service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const service = createServiceProviderService({
      repos: serviceProviderRepos(t().app),
      transact: transactor(t().app, serviceProviderRepos),
    });
    const manufacturers = createManufacturerService({
      repos: manufacturerRepos(t().app),
      transact: transactor(t().app, manufacturerRepos),
    });
    return { actor, service, manufacturers, repos: serviceProviderRepos(t().app) };
  }

  it('links and unlinks brands with compact priorities and audit entries', async () => {
    const { actor, service, manufacturers, repos } = await setup();
    const rational = await insertManufacturer(t().app, { name: 'Rational' });
    const other = await insertProvider(t().app, { name: 'Jiný servis' });
    const novak = await service.create(actor, { name: 'Servis Novák' });
    await manufacturers.setProviders(actor, rational.id, [other.id]);

    await service.setManufacturers(actor, novak.id, [rational.id]);
    expect((await manufacturers.get(actor, rational.id)).providers.map((p) => p.priority)).toEqual([1, 2]);

    await service.setManufacturers(actor, novak.id, []);
    expect((await manufacturers.get(actor, rational.id)).providers.map((p) => [p.id, p.priority])).toEqual([[other.id, 1]]);

    const history = await repos.audit.list({ entityType: 'service_provider', entityId: novak.id }, { limit: 10 });
    expect(history.items.map((e) => e.action)).toEqual(['update', 'update', 'create']);
  });
});
