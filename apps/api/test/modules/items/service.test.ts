import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError, type ErrorCode } from '../../../src/errors.ts';
import { createItemService } from '../../../src/modules/items/service.ts';
import { createFakeItemStore } from '../../fakes/items.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}

async function setup() {
  const store = createFakeItemStore();
  const service = createItemService(store);
  const praha = await store.addLocation('Centrála Praha');
  const kuchyne = await store.addLocation('Kuchyně', praha.id);
  const sklad = await store.addLocation('Sklad Brno');
  const rational = await store.catalog.addManufacturer('Rational');
  const create = (name: string, extra: Partial<Parameters<typeof service.create>[1]> = {}) =>
    service.create(writer, { name, locationId: kuchyne.id, ...extra });
  return { store, service, praha, kuchyne, sklad, rational, create };
}

describe('item service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, service, kuchyne, create } = await setup();
      const item = await create('Konvektomat');
      const auditBefore = store.state.audit.length;

      await expect(service.get(reader, item.id)).resolves.toMatchObject({ name: 'Konvektomat' });
      await expect(service.list(reader, {}, { limit: 50 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.create(reader, { name: 'X', locationId: kuchyne.id }), 'forbidden');
      await expectCode(service.update(reader, item.id, { version: 1, name: 'X' }), 'forbidden');
      await expectCode(service.archive(reader, item.id, 1), 'forbidden');
      await expectCode(service.restore(reader, item.id, 1), 'forbidden');

      expect(store.state.items).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('lets writers and admins change items', async () => {
      const { service, kuchyne } = await setup();
      await expect(service.create(writer, { name: 'A', locationId: kuchyne.id })).resolves.toBeDefined();
      await expect(service.create(admin, { name: 'B', locationId: kuchyne.id })).resolves.toBeDefined();
    });
  });

  describe('create', () => {
    it('creates with the ID it is given and leaves the generated one otherwise', async () => {
      const { create } = await setup();
      await expect(create('A', { code: 'MY-1' })).resolves.toMatchObject({ code: 'MY-1' });
      await expect(create('B')).resolves.toMatchObject({ code: expect.stringMatching(/^INV-/) });
    });

    it('creates an item, saves its external IDs and audits every set field', async () => {
      const { store, kuchyne, rational, create } = await setup();
      const item = await create('Konvektomat', {
        manufacturerId: rational.id,
        model: 'iCombi Pro',
        externalIds: [
          { source: 'Elektrikář', value: 'EL-4821' },
          { source: 'Servis', value: 'A-1' },
        ],
      });

      expect(item).toMatchObject({ code: 'INV-00001', locationId: kuchyne.id, createdBy: writer.id, version: 1 });
      expect(store.state.externalIds.map((e) => [e.source, e.value])).toEqual([
        ['Elektrikář', 'EL-4821'],
        ['Servis', 'A-1'],
      ]);
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: writer.id,
          entityType: 'item',
          entityId: item.id,
          action: 'create',
          changes: {
            code: { from: null, to: 'INV-00001' },
            name: { from: null, to: 'Konvektomat' },
            locationId: { from: null, to: kuchyne.id },
            manufacturerId: { from: null, to: rational.id },
            model: { from: null, to: 'iCombi Pro' },
            externalIds: { from: null, to: ['Elektrikář: EL-4821', 'Servis: A-1'] },
          },
        }),
      ]);
    });

    it('rejects an unknown or archived location', async () => {
      const { store, service, kuchyne, create } = await setup();
      await expectCode(create('X', { locationId: randomUUID() }), 'location_not_found');
      store.locationStore.state.locations.find((l) => l.id === kuchyne.id)!.archivedAt = new Date();
      await expectCode(service.create(writer, { name: 'X', locationId: kuchyne.id }), 'location_archived');
      expect(store.state.items).toEqual([]);
    });

    it('rejects an unknown or archived manufacturer', async () => {
      const { store, rational, create } = await setup();
      await expectCode(create('X', { manufacturerId: randomUUID() }), 'manufacturer_not_found');
      store.catalog.state.manufacturers.find((m) => m.id === rational.id)!.archivedAt = new Date();
      await expectCode(create('X', { manufacturerId: rational.id }), 'manufacturer_archived');
      expect(store.state.items).toEqual([]);
    });

    it('rejects the same external ID twice in one item, ignoring case', async () => {
      const { store, create } = await setup();
      await expect(
        create('X', {
          externalIds: [
            { source: 'Elektrikář', value: 'EL-1' },
            { source: 'elektrikář', value: 'el-1' },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'duplicate_external_id',
        details: { conflicts: [{ source: 'elektrikář', value: 'el-1', itemCode: null }] },
      });
      expect(store.state.items).toEqual([]);
    });

    it('names the external ID another item has, and that item, before writing anything', async () => {
      const { store, create } = await setup();
      const first = await create('Konvektomat', { externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }] });
      const itemsBefore = store.state.items.length;
      const auditBefore = store.state.audit.length;

      await expect(
        create('Sporák', {
          externalIds: [
            { source: 'Servis', value: 'A-1' },
            { source: 'ELEKTRIKÁŘ', value: 'el-4821' },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'duplicate_external_id',
        details: { conflicts: [{ source: 'Elektrikář', value: 'EL-4821', itemCode: first.code }] },
      });

      expect(store.state.items).toHaveLength(itemsBefore);
      expect(store.state.externalIds).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('allows the same value under another source', async () => {
      const { store, create } = await setup();
      await create('A', { externalIds: [{ source: 'Elektrikář', value: 'X-1' }] });
      await create('B', { externalIds: [{ source: 'Servis', value: 'X-1' }] });
      expect(store.state.externalIds).toHaveLength(2);
    });
  });

  describe('create for an inventory run', () => {
    const startRun = (
      store: Awaited<ReturnType<typeof setup>>['store'],
      locationId: string,
      status: 'in_progress' | 'finished' | 'cancelled' = 'in_progress',
    ) => {
      const run = { id: randomUUID(), locationId, status };
      store.state.runs.push(run);
      return run;
    };

    it('adds the item to the run as a checked new row in its location, and audits it on the run', async () => {
      const { store, praha, kuchyne, create } = await setup();
      const run = startRun(store, praha.id);

      const item = await create('Nová police', { inventoryId: run.id });

      expect(item.addedToInventory).toBe(true);
      expect(store.state.addedToRuns).toEqual([
        {
          inventoryId: run.id,
          itemId: item.id,
          locationId: kuchyne.id,
          checkedAt: expect.any(Date),
          checkedBy: writer.id,
          method: 'manual',
        },
      ]);
      expect(store.state.audit.map((e) => [e.entityType, e.action])).toEqual([
        ['item', 'create'],
        ['inventory', 'check'],
      ]);
      expect(store.state.audit[1]).toMatchObject({
        userId: writer.id,
        entityId: run.id,
        changes: {
          itemId: { from: null, to: item.id },
          kind: { from: null, to: 'new' },
          method: { from: null, to: 'manual' },
          locationId: { from: null, to: kuchyne.id },
        },
      });
    });

    it('adds an item placed in the root of the run itself', async () => {
      const { store, praha, service } = await setup();
      const run = startRun(store, praha.id);
      const item = await service.create(writer, { name: 'Recepce', locationId: praha.id, inventoryId: run.id });
      expect(item.addedToInventory).toBe(true);
    });

    it('only creates the item when the run is no longer in progress', async () => {
      const { store, praha, create } = await setup();
      for (const status of ['finished', 'cancelled'] as const) {
        const item = await create(`Po ${status}`, { inventoryId: startRun(store, praha.id, status).id });
        expect(item.addedToInventory).toBe(false);
      }
      expect(store.state.addedToRuns).toEqual([]);
      expect(store.state.items).toHaveLength(2);
      expect(store.state.audit.map((e) => e.entityType)).toEqual(['item', 'item']);
    });

    it('only creates the item when its location is not in the run, or when it has none', async () => {
      const { store, sklad, kuchyne, service, create } = await setup();
      const elsewhere = startRun(store, sklad.id);
      expect((await create('Jinde', { inventoryId: elsewhere.id })).addedToInventory).toBe(false);

      const here = startRun(store, kuchyne.id);
      const nowhere = await service.create(writer, { name: 'Bez lokality', inventoryId: here.id });
      expect(nowhere.addedToInventory).toBe(false);
      expect(store.state.addedToRuns).toEqual([]);
    });

    it('only creates the item for a run that does not exist', async () => {
      const { store, create } = await setup();
      const item = await create('Nikam', { inventoryId: randomUUID() });
      expect(item.addedToInventory).toBe(false);
      expect(store.state.items).toHaveLength(1);
    });

    it('reports that nothing was added when no run is named', async () => {
      const { create } = await setup();
      await expect(create('Obyčejná')).resolves.toMatchObject({ addedToInventory: false });
    });

    it('adds nothing when the item cannot be created at all', async () => {
      const { store, praha, create } = await setup();
      const run = startRun(store, praha.id);
      await expectCode(create('X', { inventoryId: run.id, locationId: randomUUID() }), 'location_not_found');
      expect(store.state.addedToRuns).toEqual([]);
    });
  });

  describe('get and list', () => {
    it('returns the item with manufacturer, external IDs and the location path', async () => {
      const { praha, kuchyne, rational, service, create } = await setup();
      const item = await create('Konvektomat', {
        manufacturerId: rational.id,
        externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
      });
      const detail = await service.get(reader, item.id);
      expect(detail).toMatchObject({
        manufacturer: { id: rational.id, name: 'Rational' },
        externalIds: [expect.objectContaining({ source: 'Elektrikář', value: 'EL-4821' })],
        path: [
          { id: praha.id, name: 'Centrála Praha' },
          { id: kuchyne.id, name: 'Kuchyně' },
        ],
      });
    });

    it('answers every write with the full item, as get does', async () => {
      const { service, praha, kuchyne, rational, sklad, create } = await setup();
      const path = [
        { id: praha.id, name: 'Centrála Praha' },
        { id: kuchyne.id, name: 'Kuchyně' },
      ];
      const created = await create('Konvektomat', {
        manufacturerId: rational.id,
        externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
      });
      expect(created).toMatchObject({ version: 1, manufacturer: { name: 'Rational' }, path });
      expect(created.externalIds).toEqual([expect.objectContaining({ source: 'Elektrikář', value: 'EL-4821' })]);

      const moved = await service.update(writer, created.id, { version: 1, locationId: sklad.id, externalIds: [] });
      expect(moved).toMatchObject({ version: 2, externalIds: [], path: [{ id: sklad.id, name: 'Sklad Brno' }] });

      const archived = await service.archive(writer, created.id, 2);
      expect(archived).toMatchObject({ version: 3, archivedAt: expect.any(Date), manufacturer: { name: 'Rational' } });
      expect(await service.restore(writer, created.id, 3)).toMatchObject({ version: 4, archivedAt: null });
    });

    it('reports an unknown item as not found and still returns an archived one', async () => {
      const { service, create } = await setup();
      await expectCode(service.get(reader, randomUUID()), 'not_found');
      const item = await create('Konvektomat');
      await service.archive(writer, item.id, 1);
      await expect(service.get(reader, item.id)).resolves.toMatchObject({ archivedAt: expect.any(Date) });
    });

    it('lists active items with the path of their location and the total', async () => {
      const { service, praha, kuchyne, sklad, create } = await setup();
      await create('Konvektomat');
      await create('Regál', { locationId: sklad.id });
      const archived = await create('Starý sporák');
      await service.archive(writer, archived.id, 1);

      const result = await service.list(reader, {}, { limit: 50 });
      expect(result.total).toBe(2);
      expect(result.items.map((i) => [i.name, i.path.map((p) => p.id)])).toEqual([
        ['Konvektomat', [praha.id, kuchyne.id]],
        ['Regál', [sklad.id]],
      ]);
    });

    it('lists only the archived items when asked, and a reader may', async () => {
      const { service, create } = await setup();
      await create('Konvektomat');
      const archived = await create('Starý sporák');
      await service.archive(writer, archived.id, 1);

      const result = await service.list(reader, { archived: true }, { limit: 50 });
      expect(result.items.map((i) => i.name)).toEqual(['Starý sporák']);
      expect(result.total).toBe(1);
      expect((await service.list(reader, { archived: true, q: 'konv' }, { limit: 50 })).total).toBe(0);
    });

    it('filters by location including its sub-locations, by manufacturer and by search', async () => {
      const { service, praha, sklad, rational, create } = await setup();
      await create('Konvektomat', { manufacturerId: rational.id, externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }] });
      await create('Regál', { locationId: sklad.id });
      const names = async (filter: Parameters<typeof service.list>[1]) =>
        (await service.list(reader, filter, { limit: 50 })).items.map((i) => i.name);

      expect(await names({ locationId: praha.id })).toEqual(['Konvektomat']);
      expect(await names({ manufacturerId: rational.id })).toEqual(['Konvektomat']);
      expect(await names({ q: 'el-4821' })).toEqual(['Konvektomat']);
      expect(await names({ q: 'REGAL' })).toEqual(['Regál']);
      expect(await service.list(reader, { q: 'nic' }, { limit: 50 })).toMatchObject({ total: 0, items: [] });
    });
  });

  describe('listInLocation', () => {
    it('lists the items of a location and its sub-locations, narrowed by a search', async () => {
      const { service, praha, sklad, create } = await setup();
      await create('Konvektomat');
      await create('Váha', { locationId: praha.id });
      await create('Regál', { locationId: sklad.id });

      const all = await service.listInLocation(reader, praha.id, {}, { limit: 50 });
      expect(all.items.map((i) => i.name)).toEqual(['Konvektomat', 'Váha']);
      expect(all.total).toBe(2);
      const found = await service.listInLocation(reader, praha.id, { q: 'vaha' }, { limit: 50 });
      expect(found.items.map((i) => i.name)).toEqual(['Váha']);
    });

    it('reports an unknown location as not found instead of an empty list', async () => {
      const { service, sklad, create } = await setup();
      await expectCode(service.listInLocation(reader, randomUUID(), {}, { limit: 50 }), 'not_found');
      await create('Regál', { locationId: sklad.id });
      await expect(service.listInLocation(reader, sklad.id, {}, { limit: 50 })).resolves.toMatchObject({ total: 1 });
    });
  });

  describe('update', () => {
    it('changes only the sent fields, can clear a field, and audits the difference', async () => {
      const { store, service, rational, create } = await setup();
      const item = await create('Konvektomat', { manufacturerId: rational.id, model: 'A', note: 'Stará' });
      const updated = await service.update(writer, item.id, { version: 1, model: 'B', note: null });

      expect(updated).toMatchObject({ name: 'Konvektomat', model: 'B', note: null, manufacturerId: rational.id, version: 2, updatedBy: writer.id });
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'update',
        changes: { model: { from: 'A', to: 'B' }, note: { from: 'Stará', to: null } },
      });
    });

    it('moves an item to another location and audits it', async () => {
      const { store, service, kuchyne, sklad, create } = await setup();
      const item = await create('Konvektomat');
      await service.update(writer, item.id, { version: 1, locationId: sklad.id });
      expect(store.state.items[0]!.locationId).toBe(sklad.id);
      expect(store.state.audit.at(-1)).toMatchObject({
        changes: { locationId: { from: kuchyne.id, to: sklad.id } },
      });
    });

    it('rejects a move to an unknown or archived location and a link to a bad manufacturer', async () => {
      const { store, service, sklad, create } = await setup();
      const item = await create('Konvektomat');
      await expectCode(service.update(writer, item.id, { version: 1, locationId: randomUUID() }), 'location_not_found');
      store.locationStore.state.locations.find((l) => l.id === sklad.id)!.archivedAt = new Date();
      await expectCode(service.update(writer, item.id, { version: 1, locationId: sklad.id }), 'location_archived');
      await expectCode(service.update(writer, item.id, { version: 1, manufacturerId: randomUUID() }), 'manufacturer_not_found');
      expect(store.state.items[0]!.version).toBe(1);
    });

    it('creates without a location, then places it and clears it again', async () => {
      const { service, sklad } = await setup();
      const item = await service.create(writer, { name: 'Váha' });
      expect(item).toMatchObject({ locationId: null, path: [] });
      const placed = await service.update(writer, item.id, { version: 1, locationId: sklad.id });
      expect(placed.path.at(-1)?.id).toBe(sklad.id);
      const cleared = await service.update(writer, item.id, { version: 2, locationId: null });
      expect(cleared).toMatchObject({ locationId: null, path: [] });
      const listed = await service.list(writer, {}, { limit: 50 });
      expect(listed.items.find((i) => i.id === item.id)).toMatchObject({ location: null, path: [] });
    });

    it('keeps working on an item whose location was archived later', async () => {
      const { store, service, kuchyne, create } = await setup();
      const item = await create('Konvektomat');
      store.locationStore.state.locations.find((l) => l.id === kuchyne.id)!.archivedAt = new Date();
      await expect(service.update(writer, item.id, { version: 1, name: 'Nový název' })).resolves.toMatchObject({ name: 'Nový název' });
    });

    it('replaces external IDs, audits the change and bumps the version', async () => {
      const { store, service, create } = await setup();
      const item = await create('Konvektomat', { externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] });
      const updated = await service.update(writer, item.id, {
        version: 1,
        externalIds: [
          { source: 'Elektrikář', value: 'EL-2' },
          { source: 'Servis', value: 'S-1' },
        ],
      });

      expect(updated.version).toBe(2);
      expect(store.state.externalIds.map((e) => `${e.source}: ${e.value}`)).toEqual(['Elektrikář: EL-2', 'Servis: S-1']);
      expect(store.state.audit.at(-1)).toMatchObject({
        changes: { externalIds: { from: ['Elektrikář: EL-1'], to: ['Elektrikář: EL-2', 'Servis: S-1'] } },
      });
    });

    it('leaves external IDs alone when the field is missing and audits nothing when they are unchanged', async () => {
      const { store, service, create } = await setup();
      const item = await create('Konvektomat', { externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] });
      await service.update(writer, item.id, { version: 1, name: 'Nový název' });
      expect(store.state.externalIds).toHaveLength(1);
      await service.update(writer, item.id, { version: 2, externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] });
      expect(store.state.audit.at(-1)!.changes).toEqual({});
      await service.update(writer, item.id, { version: 3, externalIds: [] });
      expect(store.state.externalIds).toEqual([]);
    });

    it('lets an item keep its own external ID when it is saved again', async () => {
      const { service, create } = await setup();
      const item = await create('Konvektomat', { externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] });
      await expect(
        service.update(writer, item.id, { version: 1, externalIds: [{ source: 'ELEKTRIKÁŘ', value: 'el-1' }] }),
      ).resolves.toBeDefined();
    });

    it('writes nothing when an external ID belongs to another item, and names it', async () => {
      const { store, service, create } = await setup();
      const other = await create('Sporák', { externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] });
      const item = await create('Konvektomat');
      const auditBefore = store.state.audit.length;

      await expect(
        service.update(writer, item.id, { version: 1, name: 'Nový název', externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] }),
      ).rejects.toMatchObject({
        code: 'duplicate_external_id',
        details: { conflicts: [{ source: 'Elektrikář', value: 'EL-1', itemCode: other.code }] },
      });

      expect(store.state.items.find((i) => i.id === item.id)).toMatchObject({ name: 'Konvektomat', version: 1 });
      expect(store.state.externalIds).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('reports a stale version as a conflict and writes nothing', async () => {
      const { store, service, create } = await setup();
      const item = await create('Konvektomat');
      await service.update(writer, item.id, { version: 1, name: 'První' });
      const auditBefore = store.state.audit.length;
      await expectCode(service.update(writer, item.id, { version: 1, name: 'Druhý' }), 'conflict');
      expect(store.state.items[0]!.name).toBe('První');
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('reports an unknown item as not found and does not edit an archived one', async () => {
      const { service, create } = await setup();
      await expectCode(service.update(writer, randomUUID(), { version: 1, name: 'X' }), 'not_found');
      const item = await create('Konvektomat');
      await service.archive(writer, item.id, 1);
      await expectCode(service.update(writer, item.id, { version: 2, name: 'X' }), 'archived');
    });
  });

  describe('archive and restore', () => {
    it('archives and restores with audit entries and hides archived items from the list', async () => {
      const { store, service, create } = await setup();
      const item = await create('Konvektomat');
      await service.archive(writer, item.id, 1);
      expect(await service.list(reader, {}, { limit: 50 })).toMatchObject({ total: 0, items: [] });
      await service.restore(writer, item.id, 2);
      expect(await service.list(reader, {}, { limit: 50 })).toMatchObject({ total: 1 });
      expect(store.state.audit.map((e) => e.action)).toEqual(['create', 'archive', 'restore']);
    });

    it('keeps the external IDs of an archived item reserved', async () => {
      const { store, service, create } = await setup();
      const item = await create('Konvektomat', { externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] });
      await service.archive(writer, item.id, 1);
      await expectCode(create('Sporák', { externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] }), 'duplicate_external_id');
      expect(store.state.externalIds).toHaveLength(1);
    });

    it('rejects archiving twice, restoring an active item and stale versions', async () => {
      const { service, create } = await setup();
      const item = await create('Konvektomat');
      await expectCode(service.restore(writer, item.id, 1), 'not_archived');
      await expectCode(service.archive(writer, item.id, 7), 'conflict');
      await service.archive(writer, item.id, 1);
      await expectCode(service.archive(writer, item.id, 2), 'archived');
    });
  });
});
