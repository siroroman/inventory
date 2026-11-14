import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError, type ErrorCode } from '../../../src/errors.ts';
import { createLocationService, createLocationTypeService } from '../../../src/modules/locations/service.ts';
import { createFakeLocationStore } from '../../fakes/locations.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}

function setup() {
  const store = createFakeLocationStore();
  const service = createLocationService(store);
  const hq = store.typeId('HQ');
  const top = (name: string) => service.create(writer, { name, locationTypeId: hq });
  const sub = (name: string, parentId: string) => service.create(writer, { name, parentId });
  return { store, service, hq, top, sub };
}

describe('location service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, service, top } = setup();
      const praha = await top('Centrála Praha');
      const auditBefore = store.state.audit.length;

      await expect(service.get(reader, praha.id)).resolves.toMatchObject({ name: 'Centrála Praha' });
      await expect(service.list(reader, {}, { limit: 50 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.create(reader, { name: 'X', locationTypeId: store.typeId('HQ') }), 'forbidden');
      await expectCode(service.update(reader, praha.id, { version: 1, name: 'X' }), 'forbidden');
      await expectCode(service.archive(reader, praha.id, 1), 'forbidden');
      await expectCode(service.restore(reader, praha.id, 1), 'forbidden');

      expect(store.state.locations).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('creates with the ID it is given and leaves the generated one otherwise', async () => {
      const { service, hq } = setup();
      await expect(service.create(writer, { name: 'A', locationTypeId: hq, code: 'MY-1' })).resolves.toMatchObject({ code: 'MY-1' });
      await expect(service.create(writer, { name: 'B', locationTypeId: hq })).resolves.toMatchObject({ code: expect.stringMatching(/^LOC-/) });
    });

    it('lets writers and admins change locations', async () => {
      const { service, hq } = setup();
      await expect(service.create(writer, { name: 'A', locationTypeId: hq })).resolves.toBeDefined();
      await expect(service.create(admin, { name: 'B', locationTypeId: hq })).resolves.toBeDefined();
    });
  });

  describe('sub-locations', () => {
    it('are allowed by the type of the top-level location, whichever level asks', async () => {
      const { store, service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const floor = await sub('Přízemí', praha.id);
      const brno = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: store.typeId('STORE') });
      const lahovice = await service.create(writer, { name: 'Láhovice', locationTypeId: store.typeId('SITE') });
      const sklad = await service.create(writer, { name: 'Sklad Kolín', locationTypeId: store.typeId('WAREHOUSE') });

      const allows = async (id: string) => (await service.get(reader, id)).allowsSubLocations;
      expect(await Promise.all([praha.id, floor.id, lahovice.id].map(allows))).toEqual([true, true, true]);
      expect(await Promise.all([brno.id, sklad.id].map(allows))).toEqual([false, false]);

      // The same flag comes with a list, one answer per row.
      const listed = await service.list(reader, {}, { limit: 50 });
      expect(Object.fromEntries(listed.items.map((l) => [l.name, l.allowsSubLocations]))).toEqual({
        'Centrála Praha': true,
        Láhovice: true,
        'Prodejna Brno': false,
        'Sklad Kolín': false,
      });
    });

    it('follow the type when an admin changes its rule', async () => {
      const { store, service } = setup();
      const brno = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: store.typeId('STORE') });
      expect((await service.get(reader, brno.id)).allowsSubLocations).toBe(false);

      await createLocationTypeService(store).update(admin, store.typeId('STORE'), { version: 1, allowsSubLocations: true });
      expect((await service.get(reader, brno.id)).allowsSubLocations).toBe(true);
    });
  });

  describe('what a write returns', () => {
    it('is the location as get shows it: type, path and counts', async () => {
      const { store, service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const floor = await sub('Přízemí', praha.id);
      expect(floor).toMatchObject({ type: null, path: [{ name: 'Centrála Praha' }, { name: 'Přízemí' }], itemCount: 0, childCount: 0 });
      expect(await service.get(reader, praha.id)).toMatchObject({ childCount: 1 });

      store.addItem(floor.id);
      const moved = await service.update(writer, floor.id, { version: 1, parentId: null, locationTypeId: store.typeId('STORE') });
      expect(moved).toMatchObject({ version: 2, type: { code: 'STORE' }, path: [{ name: 'Přízemí' }], itemCount: 1 });

      const archived = await service.archive(writer, floor.id, 2);
      expect(archived).toEqual(await service.get(reader, floor.id));
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(await service.restore(writer, floor.id, 3)).toMatchObject({ version: 4, archivedAt: null });
    });
  });

  describe('create', () => {
    it('creates a top-level location with its type and audits every set field', async () => {
      const { store, service, hq } = setup();
      const row = await service.create(writer, { name: 'Centrála Praha', locationTypeId: hq, address: 'Vinohradská 1' });
      expect(row).toMatchObject({ code: 'LOC-001', parentId: null, locationTypeId: hq, createdBy: writer.id });
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: writer.id,
          entityType: 'location',
          entityId: row.id,
          action: 'create',
          changes: {
            code: { from: null, to: 'LOC-001' },
            name: { from: null, to: 'Centrála Praha' },
            locationTypeId: { from: null, to: hq },
            address: { from: null, to: 'Vinohradská 1' },
          },
        }),
      ]);
    });

    it('requires a type at the top level', async () => {
      const { store, service } = setup();
      await expectCode(service.create(writer, { name: 'Bez typu' }), 'location_type_required');
      expect(store.state.locations).toEqual([]);
      expect(store.state.audit).toEqual([]);
    });

    it('rejects an unknown or archived type', async () => {
      const { store, service } = setup();
      await expectCode(service.create(writer, { name: 'X', locationTypeId: randomUUID() }), 'location_type_not_found');
      store.state.types[0]!.archivedAt = new Date();
      await expectCode(service.create(writer, { name: 'X', locationTypeId: store.state.types[0]!.id }), 'location_type_not_found');
    });

    it('creates a sub-location without a type', async () => {
      const { top, sub } = setup();
      const praha = await top('Centrála Praha');
      expect(await sub('Přízemí', praha.id)).toMatchObject({ parentId: praha.id, locationTypeId: null });
    });

    it('does not allow a type on a sub-location', async () => {
      const { service, hq, top } = setup();
      const praha = await top('Centrála Praha');
      await expectCode(service.create(writer, { name: 'Přízemí', parentId: praha.id, locationTypeId: hq }), 'location_type_not_allowed');
    });

    it('rejects an unknown or archived parent', async () => {
      const { service, top, sub } = setup();
      await expectCode(sub('X', randomUUID()), 'parent_not_found');
      const praha = await top('Centrála Praha');
      await service.archive(writer, praha.id, 1);
      await expectCode(sub('Přízemí', praha.id), 'parent_archived');
    });
  });

  describe('update', () => {
    it('changes only the sent fields and audits the difference', async () => {
      const { store, service, top } = setup();
      const praha = await top('Centrála Praha');
      const updated = await service.update(writer, praha.id, { version: 1, name: 'Centrála Praha 10', note: 'Recepce' });
      expect(updated).toMatchObject({ name: 'Centrála Praha 10', note: 'Recepce', locationTypeId: praha.locationTypeId, version: 2, updatedBy: writer.id });
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'update',
        changes: { name: { from: 'Centrála Praha', to: 'Centrála Praha 10' }, note: { from: null, to: 'Recepce' } },
      });
    });

    it('reports a stale version as a conflict and writes nothing', async () => {
      const { store, service, top } = setup();
      const praha = await top('Centrála Praha');
      await service.update(writer, praha.id, { version: 1, name: 'První' });
      const auditBefore = store.state.audit.length;
      await expectCode(service.update(writer, praha.id, { version: 1, name: 'Druhý' }), 'conflict');
      expect(store.state.locations[0]!.name).toBe('První');
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('reports an unknown location as not found', async () => {
      const { service } = setup();
      await expectCode(service.update(writer, randomUUID(), { version: 1, name: 'X' }), 'not_found');
    });

    it('does not edit an archived location', async () => {
      const { service, top } = setup();
      const praha = await top('Centrála Praha');
      await service.archive(writer, praha.id, 1);
      await expectCode(service.update(writer, praha.id, { version: 2, name: 'X' }), 'archived');
    });

    it('drops the type when a top-level location moves under a parent', async () => {
      const { store, service, top } = setup();
      const praha = await top('Centrála Praha');
      const brno = await top('Prodejna Brno');
      const moved = await service.update(writer, brno.id, { version: 1, parentId: praha.id });
      expect(moved).toMatchObject({ parentId: praha.id, locationTypeId: null });
      expect(store.state.audit.at(-1)?.changes).toEqual({
        parentId: { from: null, to: praha.id },
        locationTypeId: { from: brno.locationTypeId, to: null },
      });
    });

    it('requires a type when a sub-location becomes top-level', async () => {
      const { service, hq, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const prizemi = await sub('Přízemí', praha.id);
      await expectCode(service.update(writer, prizemi.id, { version: 1, parentId: null }), 'location_type_required');
      expect(await service.update(writer, prizemi.id, { version: 1, parentId: null, locationTypeId: hq })).toMatchObject({
        parentId: null,
        locationTypeId: hq,
      });
    });

    it('moves a sub-location to another branch', async () => {
      const { service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const brno = await top('Prodejna Brno');
      const sklad = await sub('Sklad', praha.id);
      expect(await service.update(writer, sklad.id, { version: 1, parentId: brno.id })).toMatchObject({ parentId: brno.id });
    });

    it('never makes a location its own ancestor', async () => {
      const { store, service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const prizemi = await sub('Přízemí', praha.id);
      const kuchyne = await sub('Kuchyně', prizemi.id);
      await expectCode(service.update(writer, praha.id, { version: 1, parentId: praha.id }), 'location_cycle');
      await expectCode(service.update(writer, praha.id, { version: 1, parentId: prizemi.id }), 'location_cycle');
      await expectCode(service.update(writer, praha.id, { version: 1, parentId: kuchyne.id }), 'location_cycle');
      expect(store.state.locations.find((l) => l.id === praha.id)?.parentId).toBeNull();
    });

    it('rejects moving under an archived or unknown parent', async () => {
      const { service, top } = setup();
      const praha = await top('Centrála Praha');
      const brno = await top('Prodejna Brno');
      await service.archive(writer, praha.id, 1);
      await expectCode(service.update(writer, brno.id, { version: 1, parentId: praha.id }), 'parent_archived');
      await expectCode(service.update(writer, brno.id, { version: 1, parentId: randomUUID() }), 'parent_not_found');
    });

    it('still edits a location whose parent was archived later, as long as it stays there', async () => {
      const { service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const prizemi = await sub('Přízemí', praha.id);
      await service.archive(writer, praha.id, 1);
      expect(await service.update(writer, prizemi.id, { version: 1, name: 'Přízemí výroba' })).toMatchObject({ version: 2 });
    });
  });

  describe('archive and restore', () => {
    it('archives and restores with audit entries', async () => {
      const { store, service, top } = setup();
      const praha = await top('Centrála Praha');
      expect((await service.archive(writer, praha.id, 1)).archivedAt).toBeInstanceOf(Date);
      expect((await service.restore(writer, praha.id, 2)).archivedAt).toBeNull();
      expect(store.state.audit.map((e) => e.action)).toEqual(['create', 'archive', 'restore']);
    });

    it('rejects archiving twice, restoring an active location and stale versions', async () => {
      const { service, top } = setup();
      const praha = await top('Centrála Praha');
      await expectCode(service.restore(writer, praha.id, 1), 'not_archived');
      await expectCode(service.archive(writer, praha.id, 5), 'conflict');
      await service.archive(writer, praha.id, 1);
      await expectCode(service.archive(writer, praha.id, 2), 'archived');
      await expectCode(service.archive(writer, randomUUID(), 1), 'not_found');
    });

    // SPEC.md open question 6: no rule yet for locations that still have active children.
    it('archives a location that still has sub-locations and items', async () => {
      const { store, service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      await sub('Přízemí', praha.id);
      store.addItem(praha.id);
      await expect(service.archive(writer, praha.id, 1)).resolves.toBeDefined();
    });
  });

  describe('reads', () => {
    it('returns the detail with path and subtree counts, archived included', async () => {
      const { store, service, top, sub } = setup();
      const praha = await top('Centrála Praha');
      const prizemi = await sub('Přízemí', praha.id);
      const kuchyne = await sub('Kuchyně', prizemi.id);
      store.addItem(praha.id);
      store.addItem(kuchyne.id);
      store.addItem(kuchyne.id, true);

      expect(await service.get(reader, kuchyne.id)).toMatchObject({
        path: [{ name: 'Centrála Praha' }, { name: 'Přízemí' }, { name: 'Kuchyně' }],
        itemCount: 1,
        childCount: 0,
      });
      expect(await service.get(reader, praha.id)).toMatchObject({ type: { code: 'HQ' }, itemCount: 2, childCount: 1 });

      await service.archive(writer, kuchyne.id, 1);
      expect((await service.get(reader, kuchyne.id)).archivedAt).toBeInstanceOf(Date);
      await expectCode(service.get(reader, randomUUID()), 'not_found');
    });

    it('lists with counts, paths and the total, in pages', async () => {
      const { store, service, top, sub } = setup();
      for (const name of ['Žatec', 'Brno', 'Cheb']) await top(name);
      const brno = store.state.locations.find((l) => l.name === 'Brno')!;
      await sub('Sklad', brno.id);
      store.addItem(brno.id);

      const first = await service.list(reader, {}, { limit: 2 });
      expect(first.total).toBe(3);
      expect(first.items.map((l) => [l.name, l.itemCount, l.childCount])).toEqual([['Brno', 1, 1], ['Cheb', 0, 0]]);
      const second = await service.list(reader, {}, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((l) => l.name)).toEqual(['Žatec']);

      // A search without a parent looks at every level; a parent lists its direct children only.
      const search = await service.list(reader, { q: 'sklad' }, { limit: 50 });
      expect(search.items[0]?.path.map((p) => p.name)).toEqual(['Brno', 'Sklad']);
      const children = await service.list(reader, { parentId: brno.id }, { limit: 50 });
      expect(children.items.map((l) => l.name)).toEqual(['Sklad']);
      expect((await service.list(reader, { parentId: brno.id, q: 'xyz' }, { limit: 50 })).total).toBe(0);
    });

    it('adds the sub-locations of each match to a search when asked, and only to a search', async () => {
      const { store, service, top, sub } = setup();
      await top('Brno');
      await top('Cheb');
      const brno = store.state.locations.find((l) => l.name === 'Brno')!;
      await sub('Sklad', brno.id);

      const search = await service.list(reader, { q: 'brno', withSubLocations: true }, { limit: 50 });
      expect(search.items.map((l) => l.name)).toEqual(['Brno', 'Sklad']);
      expect(search.total).toBe(2);
      const all = await service.list(reader, { withSubLocations: true }, { limit: 50 });
      expect(all.items.map((l) => l.name)).toEqual(['Brno', 'Cheb']);
    });

    it('lists the archived locations at every level, and only those, when asked', async () => {
      const { service, top, sub } = setup();
      const brno = await top('Brno');
      const sklad = await sub('Sklad', brno.id);
      await top('Cheb');
      await service.archive(writer, sklad.id, 1);
      await service.archive(writer, (await top('Zlín')).id, 1);

      const archived = await service.list(reader, { archived: true }, { limit: 50 });
      expect(archived.items.map((l) => l.name)).toEqual(['Sklad', 'Zlín']);
      expect(archived.total).toBe(2);
      expect(archived.items[0]?.path.map((p) => p.name)).toEqual(['Brno', 'Sklad']);
      expect((await service.list(reader, { archived: true, q: 'zl' }, { limit: 50 })).items.map((l) => l.name)).toEqual(['Zlín']);
      expect((await service.list(reader, {}, { limit: 50 })).items.map((l) => l.name)).toEqual(['Brno', 'Cheb']);
    });
  });

  describe('contacts', () => {
    const spravce = { role: 'Správce', name: 'Jan Novák', phone: '+420 601 123 456' };
    const prodejna = { role: 'Prodejna', phone: '495 111 222', email: 'prodejna@example.cz' };

    it('creates a location with its contacts in their order and audits them', async () => {
      const { store, service, hq } = setup();
      const row = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: hq, contacts: [spravce, prodejna] });
      expect(row.contacts).toMatchObject([
        { role: 'Správce', name: 'Jan Novák', phone: '+420 601 123 456', email: null },
        { role: 'Prodejna', name: null, phone: '495 111 222', email: 'prodejna@example.cz' },
      ]);
      expect(row.inheritedContacts).toEqual([]);
      expect(store.state.audit.at(-1)?.changes).toMatchObject({
        contacts: { from: null, to: ['Správce · Jan Novák · +420 601 123 456', 'Prodejna · 495 111 222 · prodejna@example.cz'] },
      });
    });

    it('creates a location without contacts and audits none', async () => {
      const { store, top } = setup();
      const row = await top('Centrála Praha');
      expect(row.contacts).toEqual([]);
      expect(store.state.audit.at(-1)?.changes).not.toHaveProperty('contacts');
    });

    it('replaces the whole list on an update, bumps the version and audits the difference', async () => {
      const { store, service, hq } = setup();
      const row = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: hq, contacts: [spravce] });
      const updated = await service.update(writer, row.id, { version: 1, contacts: [prodejna, spravce] });
      expect(updated.version).toBe(2);
      expect(updated.contacts.map((c) => c.role)).toEqual(['Prodejna', 'Správce']);
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'update',
        changes: {
          contacts: {
            from: ['Správce · Jan Novák · +420 601 123 456'],
            to: ['Prodejna · 495 111 222 · prodejna@example.cz', 'Správce · Jan Novák · +420 601 123 456'],
          },
        },
      });

      const cleared = await service.update(writer, row.id, { version: 2, contacts: [] });
      expect(cleared.contacts).toEqual([]);
      expect(store.state.contacts).toEqual([]);
    });

    it('leaves the contacts alone when the update does not send them, and audits an unchanged list as nothing', async () => {
      const { store, service, hq } = setup();
      const row = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: hq, contacts: [spravce] });
      const renamed = await service.update(writer, row.id, { version: 1, name: 'Prodejna Brno 2' });
      expect(renamed.contacts.map((c) => c.role)).toEqual(['Správce']);
      await service.update(writer, row.id, { version: 2, contacts: [spravce] });
      expect(store.state.audit.at(-1)?.changes).toEqual({});
    });

    it('keeps the old contacts when the update conflicts', async () => {
      const { store, service, hq } = setup();
      const row = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: hq, contacts: [spravce] });
      await service.update(writer, row.id, { version: 1, name: 'Nový název' });
      await expectCode(service.update(writer, row.id, { version: 1, contacts: [] }), 'conflict');
      expect(store.state.contacts.map((c) => c.role)).toEqual(['Správce']);
    });

    it('does not change the contacts of an archived location', async () => {
      const { service, hq } = setup();
      const row = await service.create(writer, { name: 'Prodejna Brno', locationTypeId: hq, contacts: [spravce] });
      await service.archive(writer, row.id, 1);
      await expectCode(service.update(writer, row.id, { version: 2, contacts: [] }), 'archived');
      expect((await service.get(reader, row.id)).contacts).toHaveLength(1);
    });

    it('shows the contacts of the locations above, nearest first, leaving out the ones without any', async () => {
      const { service, hq, sub } = setup();
      const brno = await service.create(writer, { name: 'Centrála Brno', locationTypeId: hq, contacts: [spravce] });
      const patro = await sub('2. patro', brno.id);
      const sklad = await service.create(writer, { name: 'Sklad', parentId: patro.id, contacts: [prodejna] });
      const regal = await service.create(writer, { name: 'Regál A', parentId: sklad.id });

      const detail = await service.get(reader, regal.id);
      expect(detail.contacts).toEqual([]);
      expect(detail.inheritedContacts.map((group) => [group.location.name, group.contacts.map((c) => c.role)])).toEqual([
        ['Sklad', ['Prodejna']],
        ['Centrála Brno', ['Správce']],
      ]);
      // The location's own contacts are not inherited from itself.
      expect((await service.get(reader, sklad.id)).inheritedContacts.map((group) => group.location.name)).toEqual(['Centrála Brno']);
    });
  });
});

describe('location type service', () => {
  function setupTypes() {
    const store = createFakeLocationStore();
    return { store, service: createLocationTypeService(store) };
  }

  it('lists types for every role', async () => {
    const { service } = setupTypes();
    expect((await service.list(reader)).map((t) => t.code)).toEqual(['HQ', 'STORE', 'SITE', 'WAREHOUSE']);
  });

  it('lets only admins add and edit types, with audit entries', async () => {
    const { store, service } = setupTypes();
    await expectCode(service.create(writer, { code: 'OFFICE', name: 'Kancelář' }), 'forbidden');
    const office = await service.create(admin, { code: 'OFFICE', name: 'Kancelář', sortOrder: 5 });
    await expectCode(service.update(writer, office.id, { version: 1, name: 'Pobočka' }), 'forbidden');
    expect(await service.update(admin, office.id, { version: 1, name: 'Pobočka' })).toMatchObject({ name: 'Pobočka', version: 2 });
    expect(store.state.audit.map((e) => [e.entityType, e.action, e.changes])).toEqual([
      [
        'location_type',
        'create',
        {
          code: { from: null, to: 'OFFICE' },
          name: { from: null, to: 'Kancelář' },
          sortOrder: { from: null, to: 5 },
          allowsSubLocations: { from: null, to: false },
        },
      ],
      ['location_type', 'update', { name: { from: 'Kancelář', to: 'Pobočka' } }],
    ]);
  });

  it('does not allow sub-locations unless the type says so, and audits a change of the rule', async () => {
    const { store, service } = setupTypes();
    const plain = await service.create(admin, { code: 'OFFICE', name: 'Kancelář' });
    const divided = await service.create(admin, { code: 'PLANT', name: 'Závod', allowsSubLocations: true });
    expect([plain.allowsSubLocations, divided.allowsSubLocations]).toEqual([false, true]);

    await service.update(admin, plain.id, { version: 1, allowsSubLocations: true });
    expect(store.state.audit.at(-1)?.changes).toEqual({ allowsSubLocations: { from: false, to: true } });
  });

  it('reports unknown types and stale versions', async () => {
    const { store, service } = setupTypes();
    await expectCode(service.update(admin, randomUUID(), { version: 1, name: 'X' }), 'not_found');
    await expectCode(service.update(admin, store.typeId('HQ'), { version: 7, name: 'X' }), 'conflict');
  });
});
