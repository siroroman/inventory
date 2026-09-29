import { describe, expect, it } from 'vitest';
import type { Actor } from '../src/auth/roles.ts';
import { createServices } from '../src/services.ts';
import { useTestDb } from './helpers/db.ts';
import { insertUser, locationTypeId } from './helpers/factories.ts';

// Each service is unit-tested with fakes; this checks that the composition root wires all of them
// to the real repositories, so a write in one is visible (and audited) through another.
describe('createServices', () => {
  const t = useTestDb();

  it('wires the services to one database', async () => {
    const services = createServices({ db: t().app });
    const user = await insertUser(t().app, { role: 'admin' });
    const actor: Actor = { id: user.id, role: 'admin' };

    const location = await services.locations.create(actor, {
      name: 'Centrála Praha',
      locationTypeId: await locationTypeId(t().app),
    });
    const manufacturer = await services.manufacturers.create(actor, { name: 'Bosch' });
    const provider = await services.serviceProviders.create(actor, { name: 'Elektrikář s.r.o.' });
    const item = await services.items.create(actor, {
      name: 'Vrtačka',
      locationId: location.id,
      manufacturerId: manufacturer.id,
    });

    expect((await services.items.get(actor, item.id)).path.map((p) => p.name)).toEqual(['Centrála Praha']);
    expect((await services.locationTypes.list(actor)).map((type) => type.code)).toContain('HQ');
    expect((await services.serviceProviders.get(actor, provider.id)).name).toBe('Elektrikář s.r.o.');
    const history = await services.audit.history(actor, { entityType: 'item', entityId: item.id }, { limit: 10 });
    expect(history.items.map((entry) => entry.action)).toEqual(['create']);
  });
});
