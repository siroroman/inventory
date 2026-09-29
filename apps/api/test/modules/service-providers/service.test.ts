import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError, type ErrorCode } from '../../../src/errors.ts';
import { createManufacturerService } from '../../../src/modules/manufacturers/service.ts';
import { createServiceProviderService } from '../../../src/modules/service-providers/service.ts';
import { createFakeCatalogStore } from '../../fakes/catalog.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}

/** Saves the brands on top of the provider's current version, as a form that just loaded would. */
async function setBrands(service: ReturnType<typeof createServiceProviderService>, id: string, ids: string[]) {
  return service.setManufacturers(writer, id, (await service.get(writer, id)).version, ids);
}

function setup() {
  const store = createFakeCatalogStore();
  const service = createServiceProviderService(store);
  const manufacturers = createManufacturerService(store);
  return { store, service, manufacturers };
}

describe('service provider service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, service } = setup();
      const provider = await store.addProvider('Servis Novák');
      const rational = await store.addManufacturer('Rational');
      const auditBefore = store.state.audit.length;

      await expect(service.get(reader, provider.id)).resolves.toMatchObject({ name: 'Servis Novák', manufacturers: [] });
      await expect(service.list(reader, {}, { limit: 50 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.create(reader, { name: 'X' }), 'forbidden');
      await expectCode(service.update(reader, provider.id, { version: 1, name: 'X' }), 'forbidden');
      await expectCode(service.setManufacturers(reader, provider.id, 1, [rational.id]), 'forbidden');
      await expectCode(service.archive(reader, provider.id, 1), 'forbidden');
      await expectCode(service.restore(reader, provider.id, 1), 'forbidden');

      expect(store.state.providers).toHaveLength(1);
      expect(store.state.links).toEqual([]);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('lets writers and admins change providers', async () => {
      const { service } = setup();
      await expect(service.create(writer, { name: 'A' })).resolves.toBeDefined();
      await expect(service.create(admin, { name: 'B' })).resolves.toBeDefined();
    });
  });

  describe('create and update', () => {
    it('creates a provider with a code and audits every set field', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Servis Novák', phone: '+420 777 123 456' });
      expect(row).toMatchObject({ code: 'SUP-001', createdBy: writer.id, email: null });
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: writer.id,
          entityType: 'service_provider',
          entityId: row.id,
          action: 'create',
          changes: {
            code: { from: null, to: 'SUP-001' },
            name: { from: null, to: 'Servis Novák' },
            phone: { from: null, to: '+420 777 123 456' },
          },
        }),
      ]);
    });

    it('changes only the sent fields, can clear a field, and audits the difference', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Servis Novák', phone: '123', email: 'a@b.cz' });
      const updated = await service.update(writer, row.id, { version: 1, phone: null, contactPerson: 'Jan Novák' });
      expect(updated).toMatchObject({ name: 'Servis Novák', phone: null, email: 'a@b.cz', contactPerson: 'Jan Novák', version: 2 });
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'update',
        changes: { phone: { from: '123', to: null }, contactPerson: { from: null, to: 'Jan Novák' } },
      });
    });

    it('reports a stale version as a conflict and writes nothing', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Servis Novák' });
      await service.update(writer, row.id, { version: 1, name: 'První' });
      const auditBefore = store.state.audit.length;
      await expectCode(service.update(writer, row.id, { version: 1, name: 'Druhý' }), 'conflict');
      expect(store.state.providers[0]!.name).toBe('První');
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('reports an unknown provider as not found and does not edit an archived one', async () => {
      const { service } = setup();
      await expectCode(service.update(writer, randomUUID(), { version: 1, name: 'X' }), 'not_found');
      await expectCode(service.get(reader, randomUUID()), 'not_found');
      const row = await service.create(writer, { name: 'Servis Novák' });
      await service.archive(writer, row.id, 1);
      await expectCode(service.update(writer, row.id, { version: 2, name: 'X' }), 'archived');
    });
  });

  describe('archive and restore', () => {
    it('archives and restores with audit entries and hides archived rows from the list', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Servis Novák' });
      await service.archive(writer, row.id, 1);
      expect(await service.list(reader, {}, { limit: 50 })).toMatchObject({ total: 0, items: [] });
      expect(await service.get(reader, row.id)).toMatchObject({ name: 'Servis Novák' });
      await service.restore(writer, row.id, 2);
      expect(await service.list(reader, {}, { limit: 50 })).toMatchObject({ total: 1 });
      expect(store.state.audit.map((e) => e.action)).toEqual(['create', 'archive', 'restore']);
    });

    it('rejects archiving twice, restoring an active row and stale versions', async () => {
      const { service } = setup();
      const row = await service.create(writer, { name: 'Servis Novák' });
      await expectCode(service.restore(writer, row.id, 1), 'not_archived');
      await expectCode(service.archive(writer, row.id, 7), 'conflict');
      await service.archive(writer, row.id, 1);
      await expectCode(service.archive(writer, row.id, 2), 'archived');
    });
  });

  describe('setManufacturers', () => {
    async function withBrands() {
      const { store, service, manufacturers } = setup();
      const novak = await service.create(writer, { name: 'Servis Novák' });
      const other = await store.addProvider('Jiný servis');
      const rational = await store.addManufacturer('Rational');
      const unox = await store.addManufacturer('Unox');
      return { store, service, manufacturers, novak, other, rational, unox };
    }

    it('ranks the provider last for a new brand', async () => {
      const { service, manufacturers, novak, other, rational, unox } = await withBrands();
      await manufacturers.setProviders(writer, rational.id, [other.id]);

      const { manufacturers: brands } = await setBrands(service, novak.id, [rational.id, unox.id]);

      expect(brands.map((b) => [b.name, b.priority])).toEqual([
        ['Rational', 2],
        ['Unox', 1],
      ]);
      expect((await manufacturers.get(reader, rational.id)).providers.map((p) => p.id)).toEqual([other.id, novak.id]);
    });

    it('closes the gap in the order of a dropped brand and keeps the other brands', async () => {
      const { service, manufacturers, novak, other, rational, unox } = await withBrands();
      await manufacturers.setProviders(writer, rational.id, [other.id, novak.id]);
      await manufacturers.setProviders(writer, unox.id, [novak.id, other.id]);

      const { manufacturers: brands } = await setBrands(service, novak.id, [unox.id]);

      expect(brands.map((b) => b.name)).toEqual(['Unox']);
      expect((await manufacturers.get(reader, rational.id)).providers.map((p) => [p.id, p.priority])).toEqual([[other.id, 1]]);
      expect((await manufacturers.get(reader, unox.id)).providers.map((p) => [p.id, p.priority])).toEqual([
        [novak.id, 1],
        [other.id, 2],
      ]);
    });

    it('audits the provider and every manufacturer whose order changed', async () => {
      const { store, service, novak, rational, unox } = await withBrands();
      await setBrands(service, novak.id, [rational.id]);
      const before = store.state.audit.length;

      await setBrands(service, novak.id, [unox.id]);

      const entries = store.state.audit.slice(before);
      expect(entries).toHaveLength(3);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityType: 'manufacturer',
            entityId: unox.id,
            changes: { providers: { from: [], to: [novak.id] } },
          }),
          expect.objectContaining({
            entityType: 'manufacturer',
            entityId: rational.id,
            changes: { providers: { from: [novak.id], to: [] } },
          }),
          expect.objectContaining({
            entityType: 'service_provider',
            entityId: novak.id,
            changes: { manufacturers: { from: [rational.id], to: [unox.id] } },
          }),
        ]),
      );
    });

    it('writes nothing when the brands are unchanged', async () => {
      const { store, service, novak, rational } = await withBrands();
      await setBrands(service, novak.id, [rational.id]);
      const before = store.state.audit.length;
      await setBrands(service, novak.id, [rational.id]);
      expect(store.state.audit).toHaveLength(before);
    });

    it('rejects a repeated brand, an unknown brand and an archived brand, leaving the links as they were', async () => {
      const { store, service, manufacturers, novak, rational, unox } = await withBrands();
      await setBrands(service, novak.id, [rational.id]);
      const auditBefore = store.state.audit.length;

      await expectCode(setBrands(service, novak.id, [unox.id, unox.id]), 'duplicate_manufacturer');
      await expectCode(setBrands(service, novak.id, [unox.id, randomUUID()]), 'manufacturer_not_found');
      await manufacturers.archive(writer, unox.id, 1);
      const archivedBefore = store.state.audit.length;
      await expectCode(setBrands(service, novak.id, [unox.id]), 'manufacturer_archived');

      expect(store.state.links).toEqual([{ manufacturerId: rational.id, providerId: novak.id, priority: 1 }]);
      expect(store.state.audit).toHaveLength(archivedBefore);
      expect(archivedBefore).toBe(auditBefore + 1);
    });

    it('lets a provider leave an archived brand', async () => {
      const { service, manufacturers, novak, rational } = await withBrands();
      await setBrands(service, novak.id, [rational.id]);
      await manufacturers.archive(writer, rational.id, 1);
      expect((await setBrands(service, novak.id, [])).manufacturers).toEqual([]);
    });

    it('bumps the provider version only when the brands change', async () => {
      const { service, novak, rational, unox } = await withBrands();
      expect(await setBrands(service, novak.id, [rational.id])).toMatchObject({ version: 2 });
      expect(await setBrands(service, novak.id, [rational.id])).toMatchObject({ version: 2 });
      expect(await setBrands(service, novak.id, [unox.id])).toMatchObject({ version: 3 });
    });

    it('rejects a stale version without changing anything', async () => {
      const { store, service, manufacturers, novak, rational, unox } = await withBrands();
      await service.setManufacturers(writer, novak.id, 1, [rational.id]);
      const auditBefore = store.state.audit.length;

      await expectCode(service.setManufacturers(writer, novak.id, 1, [unox.id]), 'conflict');
      await expectCode(service.setManufacturers(writer, novak.id, 1, [rational.id]), 'conflict');

      expect((await service.get(reader, novak.id)).manufacturers.map((b) => b.id)).toEqual([rational.id]);
      expect((await manufacturers.get(reader, unox.id)).providers).toEqual([]);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('conflicts with an edit made after the form was loaded', async () => {
      const { service, novak, rational } = await withBrands();
      await service.update(writer, novak.id, { version: 1, phone: '123' });
      await expectCode(service.setManufacturers(writer, novak.id, 1, [rational.id]), 'conflict');
    });

    it('rejects an unknown or archived provider', async () => {
      const { service, novak, rational } = await withBrands();
      await expectCode(service.setManufacturers(writer, randomUUID(), 1, [rational.id]), 'not_found');
      await service.archive(writer, novak.id, 1);
      await expectCode(setBrands(service, novak.id, [rational.id]), 'archived');
    });
  });
});
