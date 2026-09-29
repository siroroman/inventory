import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError, type ErrorCode } from '../../../src/errors.ts';
import { createManufacturerService } from '../../../src/modules/manufacturers/service.ts';
import { createFakeCatalogStore } from '../../fakes/catalog.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}

function setup() {
  const store = createFakeCatalogStore();
  const service = createManufacturerService(store);
  return { store, service };
}

describe('manufacturer service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, service } = setup();
      const rational = await store.addManufacturer('Rational');
      const provider = await store.addProvider('Servis Novák');
      const auditBefore = store.state.audit.length;

      await expect(service.get(reader, rational.id)).resolves.toMatchObject({ name: 'Rational', providers: [] });
      await expect(service.list(reader, {}, { limit: 50 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.create(reader, { name: 'X' }), 'forbidden');
      await expectCode(service.findOrCreateByName(reader, 'X'), 'forbidden');
      await expectCode(service.update(reader, rational.id, { version: 1, name: 'X' }), 'forbidden');
      await expectCode(service.setProviders(reader, rational.id, [provider.id]), 'forbidden');
      await expectCode(service.archive(reader, rational.id, 1), 'forbidden');
      await expectCode(service.restore(reader, rational.id, 1), 'forbidden');

      expect(store.state.manufacturers).toHaveLength(1);
      expect(store.state.links).toEqual([]);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('lets writers and admins change manufacturers', async () => {
      const { service } = setup();
      await expect(service.create(writer, { name: 'A' })).resolves.toBeDefined();
      await expect(service.create(admin, { name: 'B' })).resolves.toBeDefined();
    });
  });

  describe('create and update', () => {
    it('creates a manufacturer and audits its fields', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Rational', note: 'Konvektomaty' });
      expect(row).toMatchObject({ name: 'Rational', note: 'Konvektomaty', createdBy: writer.id });
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: writer.id,
          entityType: 'manufacturer',
          entityId: row.id,
          action: 'create',
          changes: { name: { from: null, to: 'Rational' }, note: { from: null, to: 'Konvektomaty' } },
        }),
      ]);
    });

    it('changes only the sent fields and audits the difference', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Rational' });
      const updated = await service.update(writer, row.id, { version: 1, note: 'Německo' });
      expect(updated).toMatchObject({ name: 'Rational', note: 'Německo', version: 2, updatedBy: writer.id });
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'update',
        changes: { note: { from: null, to: 'Německo' } },
      });
    });

    it('reports a stale version as a conflict and writes nothing', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Rational' });
      await service.update(writer, row.id, { version: 1, name: 'První' });
      const auditBefore = store.state.audit.length;
      await expectCode(service.update(writer, row.id, { version: 1, name: 'Druhý' }), 'conflict');
      expect(store.state.manufacturers[0]!.name).toBe('První');
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('reports an unknown manufacturer as not found', async () => {
      const { service } = setup();
      await expectCode(service.update(writer, randomUUID(), { version: 1, name: 'X' }), 'not_found');
      await expectCode(service.get(reader, randomUUID()), 'not_found');
    });

    it('does not edit an archived manufacturer', async () => {
      const { service } = setup();
      const row = await service.create(writer, { name: 'Rational' });
      await service.archive(writer, row.id, 1);
      await expectCode(service.update(writer, row.id, { version: 2, name: 'X' }), 'archived');
    });
  });

  describe('archive and restore', () => {
    it('archives and restores with audit entries and hides archived rows from the list', async () => {
      const { store, service } = setup();
      const row = await service.create(writer, { name: 'Rational' });

      const archived = await service.archive(writer, row.id, 1);
      expect(archived.archivedAt).not.toBeNull();
      expect(await service.list(reader, {}, { limit: 50 })).toMatchObject({ total: 0, items: [] });
      expect(await service.get(reader, row.id)).toMatchObject({ name: 'Rational' });

      await service.restore(writer, row.id, 2);
      expect(await service.list(reader, {}, { limit: 50 })).toMatchObject({ total: 1 });
      expect(store.state.audit.map((e) => e.action)).toEqual(['create', 'archive', 'restore']);
    });

    it('rejects archiving twice, restoring an active row and stale versions', async () => {
      const { service } = setup();
      const row = await service.create(writer, { name: 'Rational' });
      await expectCode(service.restore(writer, row.id, 1), 'not_archived');
      await expectCode(service.archive(writer, row.id, 7), 'conflict');
      await service.archive(writer, row.id, 1);
      await expectCode(service.archive(writer, row.id, 2), 'archived');
    });
  });

  describe('findOrCreateByName', () => {
    it('creates a manufacturer that does not exist', async () => {
      const { store, service } = setup();
      const row = await service.findOrCreateByName(writer, 'Rational');
      expect(row).toMatchObject({ name: 'Rational', createdBy: writer.id });
      expect(store.state.audit.map((e) => e.action)).toEqual(['create']);
    });

    it('returns an existing manufacturer regardless of case, without a new audit entry', async () => {
      const { store, service } = setup();
      const existing = await service.create(writer, { name: 'Rational' });
      const found = await service.findOrCreateByName(writer, 'RATIONAL');
      expect(found.id).toBe(existing.id);
      expect(store.state.manufacturers).toHaveLength(1);
      expect(store.state.audit).toHaveLength(1);
    });

    it('restores an archived manufacturer', async () => {
      const { store, service } = setup();
      const existing = await service.create(writer, { name: 'Rational' });
      await service.archive(writer, existing.id, 1);
      const found = await service.findOrCreateByName(writer, 'rational');
      expect(found).toMatchObject({ id: existing.id, archivedAt: null });
      expect(store.state.audit.map((e) => e.action)).toEqual(['create', 'archive', 'restore']);
    });
  });

  describe('setProviders', () => {
    async function withProviders() {
      const { store, service } = setup();
      const rational = await service.create(writer, { name: 'Rational' });
      const [a, b, c] = await Promise.all([
        store.addProvider('Servis A'),
        store.addProvider('Servis B'),
        store.addProvider('Servis C'),
      ]);
      return { store, service, rational, a: a.id, b: b.id, c: c.id };
    }

    it('saves the order as given and returns it ranked', async () => {
      const { service, rational, a, b, c } = await withProviders();
      const ranked = await service.setProviders(writer, rational.id, [c, a, b]);
      expect(ranked.map((p) => [p.name, p.priority])).toEqual([
        ['Servis C', 1],
        ['Servis A', 2],
        ['Servis B', 3],
      ]);
      expect((await service.get(reader, rational.id)).providers.map((p) => p.id)).toEqual([c, a, b]);
    });

    it('audits the change of order, and skips the audit when nothing changed', async () => {
      const { store, service, rational, a, b } = await withProviders();
      await service.setProviders(writer, rational.id, [a, b]);
      await service.setProviders(writer, rational.id, [b, a]);
      const before = store.state.audit.length;
      await service.setProviders(writer, rational.id, [b, a]);

      expect(store.state.audit).toHaveLength(before);
      expect(store.state.audit.at(-1)).toMatchObject({
        entityType: 'manufacturer',
        entityId: rational.id,
        action: 'update',
        changes: { providers: { from: [a, b], to: [b, a] } },
      });
    });

    it('removes providers with a shorter list and clears the order with an empty one', async () => {
      const { service, rational, a, b } = await withProviders();
      await service.setProviders(writer, rational.id, [a, b]);
      expect((await service.setProviders(writer, rational.id, [b])).map((p) => p.priority)).toEqual([1]);
      expect(await service.setProviders(writer, rational.id, [])).toEqual([]);
    });

    it('rejects a repeated provider', async () => {
      const { store, service, rational, a } = await withProviders();
      await expectCode(service.setProviders(writer, rational.id, [a, a]), 'duplicate_provider');
      expect(store.state.links).toEqual([]);
    });

    it('rejects an unknown provider and keeps the previous order', async () => {
      const { store, service, rational, a, b } = await withProviders();
      await service.setProviders(writer, rational.id, [a, b]);
      const auditBefore = store.state.audit.length;
      await expectCode(service.setProviders(writer, rational.id, [b, randomUUID()]), 'provider_not_found');
      expect(store.state.links.map((l) => l.providerId)).toEqual([a, b]);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('does not add an archived provider but keeps one that was archived after it was ranked', async () => {
      const { store, service, rational, a, b } = await withProviders();
      const archived = await store.addProvider('Zrušený servis', true);
      await expectCode(service.setProviders(writer, rational.id, [a, archived.id]), 'provider_archived');

      await service.setProviders(writer, rational.id, [a, b]);
      store.state.providers.find((p) => p.id === a)!.archivedAt = new Date();
      const ranked = await service.setProviders(writer, rational.id, [b, a]);
      expect(ranked.map((p) => p.id)).toEqual([b, a]);
    });

    it('rejects an unknown or archived manufacturer', async () => {
      const { service, rational, a } = await withProviders();
      await expectCode(service.setProviders(writer, randomUUID(), [a]), 'not_found');
      await service.archive(writer, rational.id, 1);
      await expectCode(service.setProviders(writer, rational.id, [a]), 'archived');
    });
  });
});
