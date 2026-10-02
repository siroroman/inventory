import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { createServiceRecordService } from '../../../src/modules/service-records/service.ts';
import { createFakeServiceRecordStore } from '../../fakes/service-records.ts';
import { expectCode } from '../../helpers/service-errors.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

async function setup() {
  const store = createFakeServiceRecordStore();
  const service = createServiceRecordService(store);
  const item = await store.addItem();
  return { store, service, item };
}

describe('service record service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id);
      const auditBefore = store.state.audit.length;

      await expect(service.get(reader, record.id)).resolves.toMatchObject({ title: 'Výměna filtru' });
      await expect(service.listByItem(reader, item.id, { limit: 50 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.create(reader, item.id, { performedOn: '2026-05-01', title: 'X' }), 'forbidden');
      await expectCode(service.update(reader, record.id, { version: 1, title: 'X' }), 'forbidden');
      await expectCode(service.archive(reader, record.id, 1), 'forbidden');
      await expectCode(service.restore(reader, record.id, 1), 'forbidden');

      expect(store.state.records).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('lets writers and admins add records', async () => {
      const { service, item } = await setup();
      await expect(service.create(writer, item.id, { performedOn: '2026-05-01', title: 'A' })).resolves.toBeDefined();
      await expect(service.create(admin, item.id, { performedOn: '2026-05-02', title: 'B' })).resolves.toBeDefined();
    });
  });

  describe('create', () => {
    it('stores the record under the item and audits every set field', async () => {
      const { store, service, item } = await setup();
      const row = await service.create(writer, item.id, {
        performedOn: '2026-04-15',
        title: 'Výměna filtru',
        performedBy: 'Servis Novák s.r.o.',
      });
      expect(row).toMatchObject({
        itemId: item.id,
        createdBy: writer.id,
        responsiblePerson: null,
        description: null,
        item: { id: item.id, name: 'Kávovar' },
      });
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: writer.id,
          entityType: 'service_record',
          entityId: row.id,
          action: 'create',
          changes: {
            itemId: { from: null, to: item.id },
            performedOn: { from: null, to: '2026-04-15' },
            title: { from: null, to: 'Výměna filtru' },
            performedBy: { from: null, to: 'Servis Novák s.r.o.' },
          },
        }),
      ]);
    });

    it('refuses an unknown or archived item and leaves nothing behind', async () => {
      const { store, service, item } = await setup();
      await expectCode(
        service.create(writer, '00000000-0000-4000-8000-000000000000', { performedOn: '2026-05-01', title: 'X' }),
        'not_found',
      );
      await store.itemStore.repos.items.setArchived(item.id, 1, true, 'setup');
      await expectCode(service.create(writer, item.id, { performedOn: '2026-05-01', title: 'X' }), 'archived');
      expect(store.state.records).toEqual([]);
      expect(store.state.audit).toEqual([]);
    });
  });

  describe('update', () => {
    it('changes only the fields sent, clears with null, and audits the difference', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id, { performedBy: 'Servis Novák', description: 'Poznámka' });

      const updated = await service.update(writer, record.id, { version: 1, title: 'Roční prohlídka', description: null });
      expect(updated).toMatchObject({
        title: 'Roční prohlídka',
        description: null,
        performedBy: 'Servis Novák',
        performedOn: '2026-04-15',
        version: 2,
        updatedBy: writer.id,
      });
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'update',
        entityType: 'service_record',
        changes: {
          title: { from: 'Výměna filtru', to: 'Roční prohlídka' },
          description: { from: 'Poznámka', to: null },
        },
      });
    });

    it('answers a stale version with a conflict and an unknown record with not_found', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id);
      await service.update(writer, record.id, { version: 1, title: 'Nové' });
      await expectCode(service.update(writer, record.id, { version: 1, title: 'Starší' }), 'conflict');
      await expectCode(
        service.update(writer, '00000000-0000-4000-8000-000000000000', { version: 1, title: 'X' }),
        'not_found',
      );
    });

    it('refuses to change an archived record or a record of an archived item', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id);
      await service.archive(writer, record.id, 1);
      await expectCode(service.update(writer, record.id, { version: 2, title: 'X' }), 'archived');

      const other = await store.addRecord(item.id, { title: 'Druhý' });
      await store.itemStore.repos.items.setArchived(item.id, 1, true, 'setup');
      await expectCode(service.update(writer, other.id, { version: 1, title: 'X' }), 'archived');
    });
  });

  describe('archive and restore', () => {
    it('archives, hides the record from the item list and audits it', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id);

      await expect(service.archive(writer, record.id, 1)).resolves.toMatchObject({ version: 2 });
      expect(store.state.audit.at(-1)).toMatchObject({ action: 'archive', entityType: 'service_record', entityId: record.id });
      await expect(service.listByItem(writer, item.id, { limit: 50 })).resolves.toMatchObject({ items: [], total: 0 });
      // The detail stays readable, so a link to it keeps working.
      await expect(service.get(reader, record.id)).resolves.toMatchObject({ archivedAt: expect.any(Date) });
    });

    it('refuses to archive twice, to restore an active record, and a stale version', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id);
      await expectCode(service.restore(writer, record.id, 1), 'not_archived');
      await expectCode(service.archive(writer, record.id, 5), 'conflict');
      await service.archive(writer, record.id, 1);
      await expectCode(service.archive(writer, record.id, 2), 'archived');
    });

    it('restores an archived record', async () => {
      const { store, service, item } = await setup();
      const record = await store.addRecord(item.id);
      await service.archive(writer, record.id, 1);
      await expect(service.restore(writer, record.id, 2)).resolves.toMatchObject({ archivedAt: null, version: 3 });
      await expect(service.listByItem(writer, item.id, { limit: 50 })).resolves.toMatchObject({ total: 1 });
    });
  });

  describe('listing an item', () => {
    it('lists newest first with a total and pages by date', async () => {
      const { store, service, item } = await setup();
      await store.addRecord(item.id, { performedOn: '2025-11-02', title: 'Roční prohlídka' });
      await store.addRecord(item.id, { performedOn: '2026-04-15', title: 'Výměna filtru' });
      await store.addRecord(item.id, { performedOn: '2025-06-20', title: 'Oprava ventilu' });
      const other = await store.addItem('Myčka');
      await store.addRecord(other.id, { title: 'Cizí' });

      const first = await service.listByItem(reader, item.id, { limit: 2 });
      expect(first.items.map((r) => r.title)).toEqual(['Výměna filtru', 'Roční prohlídka']);
      expect(first.total).toBe(3);
      const second = await service.listByItem(reader, item.id, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((r) => r.title)).toEqual(['Oprava ventilu']);
      expect(second.nextCursor).toBeNull();
    });

    it('lists the records of an archived item and refuses an unknown one', async () => {
      const { store, service, item } = await setup();
      await store.addRecord(item.id);
      await store.itemStore.repos.items.setArchived(item.id, 1, true, 'setup');
      await expect(service.listByItem(reader, item.id, { limit: 50 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.listByItem(reader, '00000000-0000-4000-8000-000000000000', { limit: 50 }), 'not_found');
    });
  });
});
