import { describe, expect, it } from 'vitest';
import type { Actor } from '../src/auth/roles.ts';
import { createServices } from '../src/services.ts';
import { createFakeInvites } from './fakes/invites.ts';
import { createFakeStorage } from './fakes/storage.ts';
import { useTestDb } from './helpers/db.ts';
import { insertUser, locationTypeId } from './helpers/factories.ts';

// Each service is unit-tested with fakes; this checks that the composition root wires all of them
// to the real repositories, so a write in one is visible (and audited) through another.
describe('createServices', () => {
  const t = useTestDb();

  it('wires the services to one database', async () => {
    const bucket = createFakeStorage();
    const invitations = createFakeInvites(t().app);
    const services = createServices({ db: t().app, storage: bucket.storage, invites: invitations.invites });
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
    const { key } = await services.photos.requestUpload(actor, item.id, { contentType: 'image/png' });
    bucket.upload(key, { contentType: 'image/png' });
    const photo = await services.photos.confirm(actor, item.id, { key, width: 800, height: 600 });
    expect((await services.photos.list(actor, item.id)).map((p) => p.id)).toEqual([photo.id]);
    const invited = await services.users.invite(actor, { email: 'jana@example.test', name: 'Jana', role: 'write' });
    expect((await services.users.list(actor)).map((u) => u.id)).toContain(invited.id);
    const history = await services.audit.history(actor, { entityType: 'item', entityId: item.id }, { limit: 10 });
    expect(history.items.map((entry) => entry.action)).toEqual(['create']);
    const photoHistory = await services.audit.history(actor, { entityType: 'photo', entityId: photo.id }, { limit: 10 });
    expect(photoHistory.items.map((entry) => entry.action)).toEqual(['create']);
    const userHistory = await services.audit.history(actor, { entityType: 'user', entityId: invited.id }, { limit: 10 });
    expect(userHistory.items.map((entry) => entry.action)).toEqual(['create']);
  });
});
