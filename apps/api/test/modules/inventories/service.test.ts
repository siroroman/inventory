import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError } from '../../../src/errors.ts';
import { createInventoryService } from '../../../src/modules/inventories/service.ts';
import { createFakeInventoryStore } from '../../fakes/inventories.ts';
import { expectCode } from '../../helpers/service-errors.ts';

const MINUTE = 60_000;

async function setup() {
  const store = createFakeInventoryStore();
  let time = new Date('2026-10-03T07:15:00.000Z');
  const clock = {
    now: () => new Date(time),
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
  };
  const service = createInventoryService({ repos: store.repos, transact: store.transact, now: clock.now });
  const users = { read: store.addUser('Petra Čtenářová'), write: store.addUser('Roman Siro'), other: store.addUser('Jan Novák') };
  const actor = (role: Role, user = users.write): Actor => ({ id: user.id, role });
  const praha = await store.itemStore.addLocation('Centrála Praha');
  return { store, service, clock, users, actor, praha };
}

describe('inventory service', () => {
  describe('roles', () => {
    it('lets readers view runs but not start, preview or cancel them', async () => {
      const { store, service, users, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      const reader = actor('read', users.read);
      const auditBefore = store.state.audit.length;

      await expect(service.get(reader, run.id)).resolves.toMatchObject({ id: run.id });
      await expect(service.list(reader, { state: 'open' }, { limit: 20 })).resolves.toMatchObject({ total: 1 });
      await expectCode(service.preview(reader, praha.id), 'forbidden');
      await expectCode(service.start(reader, { locationId: praha.id }), 'forbidden');
      await expectCode(service.cancel(reader, run.id, run.version), 'forbidden');

      expect(store.state.audit).toHaveLength(auditBefore);
      expect(store.state.inventories[0]!.status).toBe('in_progress');
    });

    it('lets readers see the rows of a run but not tick or untick them', async () => {
      const { store, service, users, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, item.id, users.write.id);
      const reader = actor('read', users.read);
      const auditBefore = store.state.audit.length;

      await expect(service.listItems(reader, run.id)).resolves.toHaveLength(1);
      await expectCode(service.check(reader, run.id, item.id), 'forbidden');
      await expectCode(service.uncheck(reader, run.id, item.id), 'forbidden');
      await expectCode(service.markMissing(reader, run.id, item.id), 'forbidden');
      await expectCode(service.unmarkMissing(reader, run.id, item.id), 'forbidden');
      await expectCode(service.scan(reader, run.id, { code: item.code }), 'forbidden');

      expect(store.state.audit).toHaveLength(auditBefore);
      expect(store.state.rows[0]!.checkedBy).toBe(users.write.id);
    });

    it('lets writers and admins start and cancel runs', async () => {
      const { store, service, actor, praha, users } = await setup();
      const brno = await store.itemStore.addLocation('Centrála Brno');
      const first = await service.start(actor('write'), { locationId: praha.id });
      const second = await service.start(actor('admin', users.other), { locationId: brno.id });
      await expect(service.cancel(actor('admin', users.other), first.id, first.version)).resolves.toMatchObject({
        status: 'cancelled',
      });
      await expect(service.cancel(actor('write'), second.id, second.version)).resolves.toMatchObject({
        status: 'cancelled',
      });
    });
  });

  describe('start', () => {
    it('takes the list of active items in the root and its active sub-locations', async () => {
      const { store, service, actor, praha } = await setup();
      const { addLocation } = store.itemStore;
      const patro = await addLocation('Patro', praha.id);
      const zasedacka = await addLocation('Zasedačka', patro.id);
      const archivedRoom = await addLocation('Stará dílna', praha.id);
      const elsewhere = await addLocation('Centrála Brno');
      const inRoot = await store.addItem(praha.id, 'Tiskárna');
      const inRoom = await store.addItem(zasedacka.id, 'Projektor');
      const archivedItem = await store.addItem(patro.id, 'Vyřazený stůl');
      const inArchivedRoom = await store.addItem(archivedRoom.id, 'Soustruh');
      await store.addItem(null, 'Bez lokality');
      await store.addItem(elsewhere.id, 'V Brně');
      store.itemStore.state.items.find((i) => i.id === archivedItem.id)!.archivedAt = new Date();
      store.itemStore.locationStore.state.locations.find((l) => l.id === archivedRoom.id)!.archivedAt = new Date();

      const run = await service.start(actor('write'), { locationId: praha.id });

      expect(store.state.rows.map((r) => r.itemId).sort()).toEqual([inRoot.id, inRoom.id].sort());
      expect(store.state.rows.map((r) => r.itemId)).not.toContain(inArchivedRoom.id);
      expect(store.state.rows.every((r) => r.kind === 'expected' && r.checkedAt === null)).toBe(true);
      expect(run.counts).toEqual({ expected: 2, checked: 0, elsewhere: 0, new: 0, missing: 0 });
      expect(run.locations.map((l) => [l.name, l.total, l.checked])).toEqual([
        ['Centrála Praha', 1, 0],
        ['Zasedačka', 1, 0],
      ]);
    });

    it('starts the run for the user at the time of the clock, in progress', async () => {
      const { service, actor, praha, users, clock } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      expect(run).toMatchObject({
        status: 'in_progress',
        version: 1,
        createdAt: clock.now(),
        endedAt: null,
        location: { id: praha.id, name: 'Centrála Praha' },
        path: [{ id: praha.id, name: 'Centrála Praha' }],
        startedBy: users.write,
        closedBy: null,
        participants: [users.write],
        activeNow: [],
      });
    });

    it('can inventory a location without items', async () => {
      const { service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      expect(run.counts.expected).toBe(0);
      expect(run.locations).toEqual([]);
    });

    it('audits the start with the location and the number of items', async () => {
      const { store, service, actor, praha, users } = await setup();
      await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: users.write.id,
          entityType: 'inventory',
          entityId: run.id,
          action: 'start',
          changes: { locationId: { from: null, to: praha.id }, items: { from: null, to: 1 } },
        }),
      ]);
    });

    it('refuses a location that does not exist or is archived', async () => {
      const { store, service, actor, praha } = await setup();
      await expectCode(service.start(actor('write'), { locationId: crypto.randomUUID() }), 'location_not_found');
      store.itemStore.locationStore.state.locations.find((l) => l.id === praha.id)!.archivedAt = new Date();
      await expectCode(service.start(actor('write'), { locationId: praha.id }), 'location_archived');
      expect(store.state.inventories).toEqual([]);
    });

    describe('overlap', () => {
      it('refuses the same location, naming the run in progress', async () => {
        const { store, service, actor, praha } = await setup();
        const first = await service.start(actor('write'), { locationId: praha.id });
        const error = await service.start(actor('write'), { locationId: praha.id }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DomainError);
        expect(error).toMatchObject({ code: 'inventory_overlap', details: { inventoryId: first.id } });
        expect(store.state.inventories).toHaveLength(1);
        expect(store.state.rows).toHaveLength(0);
        expect(store.state.audit).toHaveLength(1);
      });

      it('refuses a location below a run in progress and a location above it', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const zasedacka = await store.itemStore.addLocation('Zasedačka', patro.id);
        await service.start(actor('write'), { locationId: patro.id });
        await expectCode(service.start(actor('write'), { locationId: zasedacka.id }), 'inventory_overlap');
        await expectCode(service.start(actor('write'), { locationId: praha.id }), 'inventory_overlap');
      });

      it('allows a sibling, another tree, and the same location again once the run is cancelled', async () => {
        const { store, service, actor, praha } = await setup();
        const patro1 = await store.itemStore.addLocation('Patro 1', praha.id);
        const patro2 = await store.itemStore.addLocation('Patro 2', praha.id);
        const brno = await store.itemStore.addLocation('Centrála Brno');
        const run = await service.start(actor('write'), { locationId: patro1.id });
        await service.start(actor('write'), { locationId: patro2.id });
        await service.start(actor('write'), { locationId: brno.id });

        await service.cancel(actor('write'), run.id, run.version);
        await expect(service.start(actor('write'), { locationId: patro1.id })).resolves.toBeDefined();
      });

      it('still counts a run whose location was archived since', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        await service.start(actor('write'), { locationId: patro.id });
        store.itemStore.locationStore.state.locations.find((l) => l.id === patro.id)!.archivedAt = new Date();
        await expectCode(service.start(actor('write'), { locationId: praha.id }), 'inventory_overlap');
      });
    });
  });

  describe('preview', () => {
    it('counts the items and the locations that hold them, without starting anything', async () => {
      const { store, service, actor, praha } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      await store.itemStore.addLocation('Prázdná', praha.id);
      await store.addItem(praha.id);
      await store.addItem(patro.id);
      await store.addItem(patro.id);

      await expect(service.preview(actor('write'), praha.id)).resolves.toEqual({
        itemCount: 3,
        locationCount: 2,
        overlap: null,
      });
      expect(store.state.inventories).toEqual([]);
      expect(store.state.audit).toEqual([]);
    });

    it('reports the run it would clash with', async () => {
      const { store, service, actor, praha, users, clock } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      const preview = await service.preview(actor('write'), patro.id);
      expect(preview.overlap).toEqual({
        id: run.id,
        location: { id: praha.id, code: praha.code, name: 'Centrála Praha' },
        startedBy: users.write,
        startedAt: clock.now(),
      });
    });

    it('refuses a location that does not exist or is archived', async () => {
      const { store, service, actor, praha } = await setup();
      await expectCode(service.preview(actor('write'), crypto.randomUUID()), 'location_not_found');
      store.itemStore.locationStore.state.locations.find((l) => l.id === praha.id)!.archivedAt = new Date();
      await expectCode(service.preview(actor('write'), praha.id), 'location_archived');
    });
  });

  describe('cancel', () => {
    it('ends the run for good, keeps what was checked and audits it', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, item.id, users.write.id, clock.now());
      clock.advance(30 * MINUTE);

      const cancelled = await service.cancel(actor('write', users.other), run.id, run.version);

      expect(cancelled).toMatchObject({
        status: 'cancelled',
        version: 2,
        endedAt: clock.now(),
        closedBy: users.other,
        counts: { expected: 1, checked: 1 },
        activeNow: [],
      });
      expect(store.state.rows).toHaveLength(1);
      expect(store.state.rows[0]!.checkedAt).not.toBeNull();
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: users.other.id,
        entityType: 'inventory',
        entityId: run.id,
        action: 'cancel',
        changes: { status: { from: 'in_progress', to: 'cancelled' } },
      });
    });

    it('cannot end a run twice', async () => {
      const { service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.cancel(actor('write'), run.id, run.version);
      // Even with the version it had, or the one it has now.
      await expectCode(service.cancel(actor('write'), run.id, run.version), 'inventory_closed');
      await expectCode(service.cancel(actor('write'), run.id, run.version + 1), 'inventory_closed');
    });

    it('refuses a stale version and an unknown run', async () => {
      const { store, service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      await expectCode(service.cancel(actor('write'), run.id, 7), 'conflict');
      await expectCode(service.cancel(actor('write'), crypto.randomUUID(), 1), 'not_found');
      expect(store.state.inventories[0]!.status).toBe('in_progress');
    });
  });

  describe('finish', () => {
    it('ends the run, counts the flagged items as missing, leaves the other unchecked ones and audits it', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const checked = await store.addItem(praha.id, 'Tiskárna');
      const lost = await store.addItem(praha.id, 'Kávovar');
      await store.addItem(praha.id, 'Lednice');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, checked.id, users.write.id, clock.now());
      await service.markMissing(actor('write'), run.id, lost.id);
      clock.advance(30 * MINUTE);

      const finished = await service.finish(actor('write', users.other), run.id, run.version);

      expect(finished).toMatchObject({
        status: 'finished',
        version: 2,
        endedAt: clock.now(),
        closedBy: users.other,
        counts: { expected: 3, checked: 1, missing: 1 },
      });
      expect(finished.locations).toMatchObject([{ total: 3, checked: 1, missing: 1 }]);
      // The unflagged unchecked item is not checked, not missing.
      const outcomes = new Map(store.state.rows.map((r) => [r.itemId, r.outcome]));
      expect([...outcomes.values()].filter((o) => o === 'missing')).toHaveLength(1);
      expect(outcomes.get(lost.id)).toBe('missing');
      expect([...outcomes.values()].filter((o) => o === null)).toHaveLength(2);
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: users.other.id,
        entityType: 'inventory',
        entityId: run.id,
        action: 'finish',
        changes: { status: { from: 'in_progress', to: 'finished' }, missing: { from: null, to: 1 } },
      });
    });

    it('marks nothing missing by itself: with no flags every unchecked item stays not checked', async () => {
      const { store, service, actor, praha } = await setup();
      await store.addItem(praha.id, 'Kávovar');
      await store.addItem(praha.id, 'Lednice');
      const run = await service.start(actor('write'), { locationId: praha.id });

      const finished = await service.finish(actor('write'), run.id, run.version);

      expect(finished.counts).toMatchObject({ expected: 2, checked: 0, missing: 0 });
      expect(store.state.rows.every((r) => r.outcome === null)).toBe(true);
    });

    it('does not offer an item archived since the start as missing, even if it was flagged, nor touch found or added rows', async () => {
      const { store, service, actor, praha, users } = await setup();
      const kept = await store.addItem(praha.id, 'Zůstává');
      const gone = await store.addItem(praha.id, 'Vyřazeno');
      const stranger = await store.addItem(null, 'Pokladní systém');
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.markMissing(actor('write'), run.id, kept.id);
      await service.markMissing(actor('write'), run.id, gone.id);
      store.itemStore.state.items.find((i) => i.id === gone.id)!.archivedAt = new Date();
      store.addRow(run.id, stranger.id, praha.id, { checkedAt: new Date(), checkedBy: users.write.id, method: 'scan' });

      const finished = await service.finish(actor('write'), run.id, run.version);

      expect(finished.counts).toMatchObject({ expected: 1, checked: 0, elsewhere: 1, missing: 1 });
      const outcomes = new Map(store.state.rows.map((r) => [r.itemId, r.outcome]));
      expect(outcomes.get(kept.id)).toBe('missing');
      expect(outcomes.get(gone.id)).toBe('skipped');
      expect(outcomes.get(stranger.id)).toBeNull();
    });

    it('cancelling marks nothing more missing, and keeps the flags people set', async () => {
      const { store, service, actor, praha } = await setup();
      const lost = await store.addItem(praha.id);
      await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.markMissing(actor('write'), run.id, lost.id);

      await service.cancel(actor('write'), run.id, run.version);

      expect(store.state.rows.filter((r) => r.outcome === 'missing').map((r) => r.itemId)).toEqual([lost.id]);
      expect(store.state.rows.filter((r) => r.outcome === null)).toHaveLength(1);
    });

    it('cannot end a run twice, or finish a cancelled one', async () => {
      const { service, actor, praha } = await setup();
      const first = await service.start(actor('write'), { locationId: praha.id });
      await service.finish(actor('write'), first.id, first.version);
      await expectCode(service.finish(actor('write'), first.id, first.version), 'inventory_closed');
      await expectCode(service.cancel(actor('write'), first.id, first.version + 1), 'inventory_closed');

      const second = await service.start(actor('write'), { locationId: praha.id });
      await service.cancel(actor('write'), second.id, second.version);
      await expectCode(service.finish(actor('write'), second.id, second.version + 1), 'inventory_closed');
    });

    it('refuses a stale version, an unknown run and a reader', async () => {
      const { store, service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      await expectCode(service.finish(actor('write'), run.id, 7), 'conflict');
      await expectCode(service.finish(actor('write'), crypto.randomUUID(), 1), 'not_found');
      await expectCode(service.finish(actor('read'), run.id, run.version), 'forbidden');
      expect(store.state.inventories[0]!.status).toBe('in_progress');
    });

    it('refuses ticks and scans afterwards', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.finish(actor('write'), run.id, run.version);

      await expectCode(service.check(actor('write'), run.id, item.id), 'inventory_closed');
      await expectCode(service.markMissing(actor('write'), run.id, item.id), 'inventory_closed');
      await expectCode(service.unmarkMissing(actor('write'), run.id, item.id), 'inventory_closed');
      await expectCode(service.scan(actor('write'), run.id, { code: item.code }), 'inventory_closed');
    });
  });

  describe('reopen', () => {
    it('takes a finished run back into progress; checks and flags stay, what the finish set on archived items goes', async () => {
      const { store, service, actor, praha, users } = await setup();
      const checked = await store.addItem(praha.id, 'Tiskárna');
      const lost = await store.addItem(praha.id, 'Kávovar');
      await store.addItem(praha.id, 'Lednice');
      const gone = await store.addItem(praha.id, 'Vyřazeno');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, checked.id, users.write.id);
      await service.markMissing(actor('write'), run.id, lost.id);
      store.itemStore.state.items.find((i) => i.id === gone.id)!.archivedAt = new Date();
      const finished = await service.finish(actor('write'), run.id, run.version);
      expect(finished.counts).toMatchObject({ expected: 3, checked: 1, missing: 1 });
      expect(store.state.rows.find((r) => r.itemId === gone.id)!.outcome).toBe('skipped');

      const reopened = await service.reopen(actor('write', users.other), run.id, finished.version);

      expect(reopened).toMatchObject({
        status: 'in_progress',
        version: finished.version + 1,
        endedAt: null,
        endedBy: null,
        closedBy: null,
        counts: { expected: 3, checked: 1, missing: 1 },
      });
      const outcomes = new Map(store.state.rows.map((r) => [r.itemId, r.outcome]));
      expect(outcomes.get(lost.id)).toBe('missing');
      expect(outcomes.get(gone.id)).toBeNull();
      // Checked rows stay checked, and the run takes ticks again.
      expect(store.state.rows.find((r) => r.itemId === checked.id)!.checkedAt).not.toBeNull();
      const open = store.state.rows.find((r) => r.itemId === lost.id)!;
      await expect(service.check(actor('write'), run.id, open.itemId)).resolves.toMatchObject({
        checkedAt: expect.any(Date),
        missing: false,
      });
      expect(store.state.audit.filter((e) => e.action === 'reopen')).toEqual([
        expect.objectContaining({
          userId: users.other.id,
          entityType: 'inventory',
          entityId: run.id,
          changes: { status: { from: 'finished', to: 'in_progress' } },
        }),
      ]);
    });

    it('can be finished again, and then counts what is flagged', async () => {
      const { store, service, actor, praha } = await setup();
      const first = await store.addItem(praha.id, 'Tiskárna');
      const second = await store.addItem(praha.id, 'Kávovar');
      const run = await service.start(actor('write'), { locationId: praha.id });
      const finished = await service.finish(actor('write'), run.id, run.version);
      const reopened = await service.reopen(actor('write'), run.id, finished.version);
      await service.check(actor('write'), run.id, first.id);
      await service.markMissing(actor('write'), run.id, second.id);

      const again = await service.finish(actor('write'), run.id, reopened.version);

      expect(again).toMatchObject({ status: 'finished', counts: { checked: 1, missing: 1 } });
    });

    it('is refused while another run is in progress on the location, one above it or one below it', async () => {
      const { store, service, actor, praha } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      const finished = await service.finish(actor('write'), run.id, run.version);
      const other = await service.start(actor('write'), { locationId: patro.id });

      await expect(service.reopen(actor('write'), run.id, finished.version)).rejects.toMatchObject({
        code: 'inventory_overlap',
        details: { inventoryId: other.id },
      });
      expect(store.state.inventories.find((r) => r.id === run.id)!.status).toBe('finished');

      // Once that one has ended, the finished run can be taken back.
      await service.cancel(actor('write'), other.id, other.version);
      await expect(service.reopen(actor('write'), run.id, finished.version)).resolves.toMatchObject({ status: 'in_progress' });
    });

    it('takes a cancelled run back into progress too, keeping its checks and flags', async () => {
      const { store, service, actor, praha, users } = await setup();
      const checked = await store.addItem(praha.id, 'Tiskárna');
      const lost = await store.addItem(praha.id, 'Kávovar');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, checked.id, users.write.id);
      await service.markMissing(actor('write'), run.id, lost.id);
      const cancelled = await service.cancel(actor('write'), run.id, run.version);
      expect(cancelled).toMatchObject({ status: 'cancelled', endedAt: expect.any(Date) });

      const reopened = await service.reopen(actor('write', users.other), run.id, cancelled.version);

      expect(reopened).toMatchObject({
        status: 'in_progress',
        version: cancelled.version + 1,
        endedAt: null,
        endedBy: null,
        counts: { expected: 2, checked: 1, missing: 1 },
      });
      expect(store.state.audit.filter((e) => e.action === 'reopen')).toEqual([
        expect.objectContaining({
          userId: users.other.id,
          entityId: run.id,
          changes: { status: { from: 'cancelled', to: 'in_progress' } },
        }),
      ]);
      // It takes ticks again (finding what was flagged), and can be finished.
      await service.check(actor('write'), run.id, lost.id);
      const again = await service.finish(actor('write'), run.id, reopened.version);
      expect(again).toMatchObject({ status: 'finished', counts: { checked: 2, missing: 0 } });
    });

    it('keeps a record of the cancel, the reopen and the finish, oldest first, with who did each', async () => {
      const { service, actor, praha, users } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      expect(run.history).toEqual([]);
      const cancelled = await service.cancel(actor('write', users.write), run.id, run.version);
      // Nothing of the end is on the run once it is reopened; the record still has it.
      const reopened = await service.reopen(actor('write', users.other), run.id, cancelled.version);
      expect(reopened).toMatchObject({ endedAt: null, endedBy: null });
      const finished = await service.finish(actor('write', users.write), run.id, reopened.version);

      expect(finished.history.map((e) => [e.action, e.by?.id])).toEqual([
        ['cancel', users.write.id],
        ['reopen', users.other.id],
        ['finish', users.write.id],
      ]);
      expect(finished.history.every((e) => e.at instanceof Date)).toBe(true);
    });

    it('is refused for a cancelled run while another run is in progress on the location', async () => {
      const { service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      const cancelled = await service.cancel(actor('write'), run.id, run.version);
      const other = await service.start(actor('write'), { locationId: praha.id });

      await expect(service.reopen(actor('write'), run.id, cancelled.version)).rejects.toMatchObject({
        code: 'inventory_overlap',
        details: { inventoryId: other.id },
      });
    });

    it('refuses a run in progress and an archived one', async () => {
      const { service, actor, praha } = await setup();
      const open = await service.start(actor('write'), { locationId: praha.id });
      await expectCode(service.reopen(actor('write'), open.id, open.version), 'inventory_in_progress');

      const cancelledRun = await service.cancel(actor('write'), open.id, open.version);
      const archivedCancelled = await service.archive(actor('write'), open.id, cancelledRun.version);
      await expectCode(service.reopen(actor('write'), open.id, archivedCancelled.version), 'archived');

      const second = await service.start(actor('write'), { locationId: praha.id });
      const finished = await service.finish(actor('write'), second.id, second.version);
      const archived = await service.archive(actor('write'), second.id, finished.version);
      await expectCode(service.reopen(actor('write'), second.id, archived.version), 'archived');
    });

    it('refuses a stale version, an unknown run and a reader', async () => {
      const { service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      const finished = await service.finish(actor('write'), run.id, run.version);
      await expectCode(service.reopen(actor('write'), run.id, 99), 'conflict');
      await expectCode(service.reopen(actor('write'), crypto.randomUUID(), 1), 'not_found');
      await expectCode(service.reopen(actor('read'), run.id, finished.version), 'forbidden');
    });
  });

  describe('archive and restore', () => {
    async function endedRun() {
      const ctx = await setup();
      const run = await ctx.service.start(ctx.actor('write'), { locationId: ctx.praha.id });
      const finished = await ctx.service.finish(ctx.actor('write'), run.id, run.version);
      return { ...ctx, run: finished };
    }

    it('takes an ended run out of the lists and brings it back, auditing both', async () => {
      const { store, service, actor, run, users } = await endedRun();
      const active = { state: 'closed' as const };
      const archivedOnly = { state: 'closed' as const, archived: true };

      const archived = await service.archive(actor('write', users.other), run.id, run.version);

      expect(archived).toMatchObject({ status: 'finished', archivedAt: expect.any(Date), version: run.version + 1 });
      expect((await service.list(actor('read'), active, { limit: 20 })).items).toEqual([]);
      expect((await service.list(actor('read'), archivedOnly, { limit: 20 })).items.map((r) => r.id)).toEqual([run.id]);
      expect(store.state.audit.at(-1)).toMatchObject({ userId: users.other.id, entityId: run.id, action: 'archive' });

      const restored = await service.restore(actor('write'), run.id, archived.version);

      expect(restored.archivedAt).toBeNull();
      expect((await service.list(actor('read'), active, { limit: 20 })).items.map((r) => r.id)).toEqual([run.id]);
      expect((await service.list(actor('read'), archivedOnly, { limit: 20 })).items).toEqual([]);
      expect(store.state.audit.at(-1)).toMatchObject({ action: 'restore' });
    });

    it('archives a cancelled run too, and an archived run can still be read', async () => {
      const { service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      const cancelled = await service.cancel(actor('write'), run.id, run.version);

      await service.archive(actor('write'), run.id, cancelled.version);

      expect(await service.get(actor('read'), run.id)).toMatchObject({ status: 'cancelled', archivedAt: expect.any(Date) });
    });

    it('does not archive a run in progress', async () => {
      const { service, actor, praha } = await setup();
      const run = await service.start(actor('write'), { locationId: praha.id });
      await expectCode(service.archive(actor('write'), run.id, run.version), 'inventory_in_progress');
    });

    it('refuses to archive twice, to restore what is not archived, a stale version and an unknown run', async () => {
      const { service, actor, run } = await endedRun();
      await expectCode(service.restore(actor('write'), run.id, run.version), 'not_archived');
      const archived = await service.archive(actor('write'), run.id, run.version);
      await expectCode(service.archive(actor('write'), run.id, archived.version), 'archived');
      await expectCode(service.restore(actor('write'), run.id, run.version), 'conflict');
      await expectCode(service.archive(actor('write'), crypto.randomUUID(), 1), 'not_found');
      await expectCode(service.restore(actor('write'), crypto.randomUUID(), 1), 'not_found');
    });

    it('is for writers', async () => {
      const { service, actor, run } = await endedRun();
      await expectCode(service.archive(actor('read'), run.id, run.version), 'forbidden');
    });
  });

  describe('listItems', () => {
    it('lists the rows of the run by item name in Czech order, or those of one location', async () => {
      const { store, service, actor, praha } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      await store.addItem(praha.id, 'Žebřík');
      await store.addItem(patro.id, 'Čepice');
      await store.addItem(praha.id, 'Mixér');
      await store.addItem(patro.id, 'Cukřenka');
      const run = await service.start(actor('write'), { locationId: praha.id });

      const all = await service.listItems(actor('read'), run.id);
      expect(all.map((r) => r.name)).toEqual(['Cukřenka', 'Čepice', 'Mixér', 'Žebřík']);
      expect(all[0]).toMatchObject({ kind: 'expected', locationId: patro.id, checkedAt: null, checkedBy: null, registeredPath: [] });
      const inPatro = await service.listItems(actor('read'), run.id, patro.id);
      expect(inPatro.map((r) => r.name)).toEqual(['Cukřenka', 'Čepice']);
    });

    it('shows who checked a row and how, and where an item found elsewhere was registered', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const brno = await store.itemStore.addLocation('Centrála Brno');
      const sklad = await store.itemStore.addLocation('Sklad', brno.id);
      const listed = await store.addItem(praha.id, 'Tiskárna');
      const stranger = await store.addItem(sklad.id, 'Pokladní systém');
      const unregistered = await store.addItem(null, 'Stojan na tácy');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, listed.id, users.other.id, clock.now(), 'scan');
      const found = (itemId: string, registeredLocationId: string | null, extra = {}) =>
        store.addRow(run.id, itemId, praha.id, {
          kind: 'elsewhere',
          registeredLocationId,
          checkedAt: clock.now(),
          checkedBy: users.write.id,
          method: 'manual',
          ...extra,
        });
      found(stranger.id, sklad.id, { movedAt: clock.now(), movedBy: users.write.id });
      found(unregistered.id, null);

      const rows = new Map((await service.listItems(actor('read'), run.id)).map((r) => [r.name, r]));
      expect(rows.get('Tiskárna')).toMatchObject({ checkedBy: users.other, method: 'scan', checkedAt: clock.now() });
      expect(rows.get('Pokladní systém')).toMatchObject({ kind: 'elsewhere', moved: true });
      expect(rows.get('Pokladní systém')!.registeredPath.map((s) => s.name)).toEqual(['Centrála Brno', 'Sklad']);
      expect(rows.get('Stojan na tácy')).toMatchObject({ kind: 'elsewhere', moved: false, registeredPath: [] });
    });

    it('stops reporting an item found elsewhere as registered elsewhere once its location is the one it was found in', async () => {
      const { store, service, actor, praha } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      const sklad = await store.itemStore.addLocation('Sklad');
      const stranger = await store.addItem(sklad.id, 'Pokladní systém');
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.scan(actor('write'), run.id, { code: stranger.code, locationId: patro.id });

      const before = await service.listItems(actor('read'), run.id, patro.id);
      expect(before).toMatchObject([{ kind: 'elsewhere', registeredElsewhere: true }]);

      // An ordinary edit of the item: its location is now the checklist's.
      store.itemStore.state.items.find((i) => i.id === stranger.id)!.locationId = patro.id;

      const after = await service.listItems(actor('read'), run.id, patro.id);
      // Still a find of this run (kind and counts do not change), but it is in place.
      expect(after).toMatchObject([{ kind: 'elsewhere', registeredElsewhere: false, checkedAt: expect.any(Date) }]);
      expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ elsewhere: 1 });

      // Moved somewhere else again: elsewhere once more.
      store.itemStore.state.items.find((i) => i.id === stranger.id)!.locationId = sklad.id;
      expect(await service.listItems(actor('read'), run.id, patro.id)).toMatchObject([{ registeredElsewhere: true }]);
    });

    it('never reports a listed item or an added one as registered elsewhere', async () => {
      const { store, service, actor, praha, users } = await setup();
      const listed = await store.addItem(praha.id, 'Tiskárna');
      const run = await service.start(actor('write'), { locationId: praha.id });
      const added = await store.addItem(praha.id, 'Nová police');
      store.addRow(run.id, added.id, praha.id, { kind: 'new', checkedAt: new Date(), checkedBy: users.write.id, method: 'manual' });
      // The listed item moved away by an edit: its row is still a listed one.
      store.itemStore.state.items.find((i) => i.id === listed.id)!.locationId = null;

      const rows = await service.listItems(actor('read'), run.id);
      expect(rows.map((r) => r.registeredElsewhere)).toEqual([false, false]);
    });

    it('leaves out archived items and found or added items that are not checked', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const gone = await store.addItem(praha.id, 'Vyřazeno');
      await store.addItem(praha.id, 'Zůstává');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.itemStore.state.items.find((i) => i.id === gone.id)!.archivedAt = new Date();
      const unticked = await store.addItem(null, 'Odškrtnuto');
      store.addRow(run.id, unticked.id, praha.id, { kind: 'new' });
      const added = await store.addItem(praha.id, 'Přidáno');
      store.addRow(run.id, added.id, praha.id, { kind: 'new', checkedAt: clock.now(), checkedBy: users.write.id, method: 'manual' });

      const rows = await service.listItems(actor('read'), run.id);
      expect(rows.map((r) => r.name)).toEqual(['Přidáno', 'Zůstává']);
    });

    it('throws not_found for an unknown run', async () => {
      const { service, actor } = await setup();
      await expectCode(service.listItems(actor('read'), crypto.randomUUID()), 'not_found');
    });
  });

  describe('check', () => {
    it('ticks the row for the user at the time of the clock, by hand, and audits it', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const item = await store.addItem(praha.id, 'Tiskárna');
      const run = await service.start(actor('write'), { locationId: praha.id });
      clock.advance(10 * MINUTE);

      const row = await service.check(actor('write', users.other), run.id, item.id);

      expect(row).toMatchObject({
        itemId: item.id,
        name: 'Tiskárna',
        checkedAt: clock.now(),
        checkedBy: users.other,
        method: 'manual',
      });
      expect(store.state.rows[0]).toMatchObject({ checkedAt: clock.now(), checkedBy: users.other.id, method: 'manual' });
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: users.other.id,
        entityType: 'inventory',
        entityId: run.id,
        action: 'check',
        changes: { itemId: { from: null, to: item.id }, method: { from: null, to: 'manual' } },
      });
      const detail = await service.get(actor('read'), run.id);
      expect(detail.counts).toMatchObject({ expected: 1, checked: 1 });
      expect(detail.participants).toEqual([users.write, users.other]);
    });

    it('does not touch the version of the run', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.check(actor('write'), run.id, item.id);
      expect(store.state.inventories[0]!.version).toBe(run.version);
    });

    it('leaves a row that is already checked as it is: the first check wins, with no new audit entry', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      const first = await service.check(actor('write'), run.id, item.id);
      clock.advance(5 * MINUTE);
      const auditBefore = store.state.audit.length;

      const second = await service.check(actor('write', users.other), run.id, item.id);

      expect(second).toEqual(first);
      expect(second.checkedBy).toEqual(users.write);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('refuses an item the run does not have, an unknown run and a closed run', async () => {
      const { store, service, actor, praha } = await setup();
      const brno = await store.itemStore.addLocation('Centrála Brno');
      const listed = await store.addItem(praha.id);
      const outside = await store.addItem(brno.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      const later = await store.addItem(praha.id, 'Přidáno po zahájení');

      await expectCode(service.check(actor('write'), run.id, outside.id), 'item_not_in_inventory');
      await expectCode(service.check(actor('write'), run.id, later.id), 'item_not_in_inventory');
      await expectCode(service.check(actor('write'), run.id, crypto.randomUUID()), 'item_not_in_inventory');
      await expectCode(service.check(actor('write'), crypto.randomUUID(), listed.id), 'not_found');

      await service.cancel(actor('write'), run.id, run.version);
      await expectCode(service.check(actor('write'), run.id, listed.id), 'inventory_closed');
      expect(store.state.rows.every((r) => r.checkedAt === null)).toBe(true);
      expect(store.state.audit.map((e) => e.action)).toEqual(['start', 'cancel']);
    });

    it('refuses an item archived since the start', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
      await expectCode(service.check(actor('write'), run.id, item.id), 'archived');
      expect(store.state.rows[0]!.checkedAt).toBeNull();
    });

    it('ticks an item found elsewhere again after it was unticked', async () => {
      const { store, service, actor, praha, users } = await setup();
      const stranger = await store.addItem(null, 'Pokladní systém');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.addRow(run.id, stranger.id, praha.id, { kind: 'elsewhere' });

      expect(await service.listItems(actor('read'), run.id)).toEqual([]);
      const row = await service.check(actor('write'), run.id, stranger.id);
      expect(row).toMatchObject({ kind: 'elsewhere', checkedBy: users.write });
      expect(await service.listItems(actor('read'), run.id)).toHaveLength(1);
    });
  });

  describe('uncheck', () => {
    it('returns the row to unchecked and audits it', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const item = await store.addItem(praha.id, 'Tiskárna');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, item.id, users.other.id, clock.now());

      const row = await service.uncheck(actor('write'), run.id, item.id);

      expect(row).toMatchObject({ name: 'Tiskárna', kind: 'expected', checkedAt: null, checkedBy: null, method: null });
      expect(store.state.rows[0]).toMatchObject({ checkedAt: null, checkedBy: null, method: null });
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: users.write.id,
        entityType: 'inventory',
        entityId: run.id,
        action: 'uncheck',
        changes: { itemId: { from: item.id, to: null } },
      });
      expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ expected: 1, checked: 0 });
    });

    it('changes nothing for a row that is not checked, and leaves no audit entry', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      const auditBefore = store.state.audit.length;
      await expect(service.uncheck(actor('write'), run.id, item.id)).resolves.toMatchObject({ checkedAt: null });
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('drops an item found elsewhere or added out of the rows but keeps its record', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const stranger = await store.addItem(null, 'Pokladní systém');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.addRow(run.id, stranger.id, praha.id, {
        kind: 'elsewhere',
        checkedAt: clock.now(),
        checkedBy: users.write.id,
        method: 'manual',
      });
      expect(await service.listItems(actor('read'), run.id)).toHaveLength(1);

      await service.uncheck(actor('write'), run.id, stranger.id);

      expect(await service.listItems(actor('read'), run.id)).toEqual([]);
      expect(store.state.rows).toHaveLength(1);
      expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ elsewhere: 0 });
    });

    it('refuses an item the run does not have, an unknown run and a closed run', async () => {
      const { store, service, actor, praha, users, clock } = await setup();
      const listed = await store.addItem(praha.id);
      const outside = await store.addItem(null);
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, listed.id, users.write.id, clock.now());

      await expectCode(service.uncheck(actor('write'), run.id, outside.id), 'item_not_in_inventory');
      await expectCode(service.uncheck(actor('write'), crypto.randomUUID(), listed.id), 'not_found');
      await service.cancel(actor('write'), run.id, run.version);
      await expectCode(service.uncheck(actor('write'), run.id, listed.id), 'inventory_closed');
      expect(store.state.rows[0]!.checkedAt).not.toBeNull();
    });
  });

  describe('mark missing', () => {
    it('flags an unchecked item of the list and audits it', async () => {
      const { store, service, actor, praha, users } = await setup();
      const item = await store.addItem(praha.id, 'Tiskárna');
      await store.addItem(praha.id, 'Kávovar');
      const run = await service.start(actor('write'), { locationId: praha.id });

      const row = await service.markMissing(actor('write', users.other), run.id, item.id);

      expect(row).toMatchObject({ itemId: item.id, name: 'Tiskárna', missing: true, checkedAt: null });
      expect(store.state.rows.find((r) => r.itemId === item.id)!.outcome).toBe('missing');
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: users.other.id,
        entityType: 'inventory',
        entityId: run.id,
        action: 'mark_missing',
        changes: { itemId: { from: null, to: item.id } },
      });
      const detail = await service.get(actor('read'), run.id);
      expect(detail.counts).toMatchObject({ expected: 2, checked: 0, missing: 1 });
      expect(detail.locations).toMatchObject([{ total: 2, checked: 0, missing: 1 }]);
      // Still on the list: the row shows as missing.
      expect(await service.listItems(actor('read'), run.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: item.id, missing: true })]),
      );
      // Flagging does not change the run itself.
      expect(store.state.inventories[0]!.version).toBe(run.version);
    });

    it('takes the flag back and audits it', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.markMissing(actor('write'), run.id, item.id);

      const row = await service.unmarkMissing(actor('write'), run.id, item.id);

      expect(row).toMatchObject({ missing: false, checkedAt: null });
      expect(store.state.rows[0]!.outcome).toBeNull();
      expect(store.state.audit.at(-1)).toMatchObject({
        action: 'unmark_missing',
        changes: { itemId: { from: item.id, to: null } },
      });
      expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ missing: 0 });
    });

    it('changes nothing, and leaves no audit entry, for a row that is flagged already or not flagged', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      await expect(service.unmarkMissing(actor('write'), run.id, item.id)).resolves.toMatchObject({ missing: false });
      await service.markMissing(actor('write'), run.id, item.id);
      const auditBefore = store.state.audit.length;

      await expect(service.markMissing(actor('write'), run.id, item.id)).resolves.toMatchObject({ missing: true });

      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('leaves a row somebody checked as it is: found beats missing', async () => {
      const { store, service, actor, praha, users } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, item.id, users.other.id);
      const auditBefore = store.state.audit.length;

      const row = await service.markMissing(actor('write'), run.id, item.id);

      expect(row).toMatchObject({ missing: false, checkedBy: users.other });
      expect(store.state.rows[0]!.outcome).toBeNull();
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('is taken back by a check, by hand or by scan, so a row is never both checked and missing', async () => {
      const { store, service, actor, praha } = await setup();
      const byHand = await store.addItem(praha.id, 'Kávovar');
      const byScan = await store.addItem(praha.id, 'Lednice');
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.markMissing(actor('write'), run.id, byHand.id);
      await service.markMissing(actor('write'), run.id, byScan.id);

      await expect(service.check(actor('write'), run.id, byHand.id)).resolves.toMatchObject({
        missing: false,
        checkedAt: expect.any(Date),
      });
      await expect(service.scan(actor('write'), run.id, { code: byScan.code })).resolves.toMatchObject({
        outcome: 'found',
        row: { missing: false, checkedAt: expect.any(Date) },
      });

      expect(store.state.rows.every((r) => r.outcome === null && r.checkedAt !== null)).toBe(true);
      expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ checked: 2, missing: 0 });
    });

    it('does not bring the flag back when the item is unticked after a check took it', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.markMissing(actor('write'), run.id, item.id);
      await service.check(actor('write'), run.id, item.id);

      // Unticking does not bring the flag back (like the Nezvěstná status, SPEC §9.3 rule 12).
      await expect(service.uncheck(actor('write'), run.id, item.id)).resolves.toMatchObject({
        missing: false,
        checkedAt: null,
      });
    });

    it('refuses an item that is not on the list, an archived one, an unknown item and run, and a closed run', async () => {
      const { store, service, actor, praha, users } = await setup();
      const listed = await store.addItem(praha.id);
      const gone = await store.addItem(praha.id, 'Vyřazeno');
      const stranger = await store.addItem(null, 'Pokladní systém');
      const outside = await store.addItem(null, 'Jinde');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.addRow(run.id, stranger.id, praha.id, { kind: 'elsewhere', checkedAt: new Date(), checkedBy: users.write.id, method: 'scan' });
      store.itemStore.state.items.find((i) => i.id === gone.id)!.archivedAt = new Date();

      await expectCode(service.markMissing(actor('write'), run.id, stranger.id), 'item_not_in_inventory');
      await expectCode(service.markMissing(actor('write'), run.id, outside.id), 'item_not_in_inventory');
      await expectCode(service.markMissing(actor('write'), run.id, crypto.randomUUID()), 'item_not_in_inventory');
      await expectCode(service.markMissing(actor('write'), run.id, gone.id), 'archived');
      await expectCode(service.markMissing(actor('write'), crypto.randomUUID(), listed.id), 'not_found');
      await expectCode(service.unmarkMissing(actor('write'), run.id, stranger.id), 'item_not_in_inventory');

      await service.cancel(actor('write'), run.id, run.version);
      await expectCode(service.markMissing(actor('write'), run.id, listed.id), 'inventory_closed');
      expect(store.state.rows.every((r) => r.outcome === null)).toBe(true);
    });
  });

  describe('scan', () => {
    it('checks an item of the list by its code, case ignored, and audits it as a scan', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      const item = await store.addItem(patro.id, 'Kávovar');
      const run = await service.start(actor('write'), { locationId: praha.id });
      clock.advance(10 * MINUTE);

      const result = await service.scan(actor('write', users.other), run.id, { code: item.code.toLowerCase() });

      expect(result).toMatchObject({
        outcome: 'found',
        misplaced: false,
        wasMissing: false,
        item: { id: item.id, code: item.code, name: 'Kávovar', path: [{ name: 'Centrála Praha' }, { name: 'Patro' }] },
        row: { itemId: item.id, kind: 'expected', checkedAt: clock.now(), checkedBy: users.other, method: 'scan' },
      });
      expect(store.state.rows[0]).toMatchObject({ checkedBy: users.other.id, method: 'scan', locationId: patro.id });
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: users.other.id,
        entityType: 'inventory',
        entityId: run.id,
        action: 'check',
        changes: { itemId: { from: null, to: item.id }, method: { from: null, to: 'scan' } },
      });
      expect(store.state.inventories[0]!.version).toBe(run.version);
      expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ expected: 1, checked: 1 });
    });

    it('records a code typed by hand as a hand check', async () => {
      const { store, service, actor, praha } = await setup();
      const item = await store.addItem(praha.id);
      const run = await service.start(actor('write'), { locationId: praha.id });

      await service.scan(actor('write'), run.id, { code: item.code, method: 'manual' });

      expect(store.state.rows[0]).toMatchObject({ method: 'manual' });
      expect(store.state.audit.at(-1)!.changes).toMatchObject({ method: { from: null, to: 'manual' } });
    });

    describe('where the user stands', () => {
      it('is not misplaced without a context location, wherever the item is registered', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const item = await store.addItem(patro.id);
        const run = await service.start(actor('write'), { locationId: praha.id });
        await expect(service.scan(actor('write'), run.id, { code: item.code })).resolves.toMatchObject({
          outcome: 'found',
          misplaced: false,
        });
      });

      it('is not misplaced from the checklist of the location the item is registered in', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const item = await store.addItem(patro.id);
        const run = await service.start(actor('write'), { locationId: praha.id });
        await expect(
          service.scan(actor('write'), run.id, { code: item.code, locationId: patro.id }),
        ).resolves.toMatchObject({ outcome: 'found', misplaced: false });
      });

      it('is misplaced from the checklist of another location of the run, and still counts where it is registered', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const sklad = await store.itemStore.addLocation('Sklad', praha.id);
        const item = await store.addItem(sklad.id, 'Vozík');
        const run = await service.start(actor('write'), { locationId: praha.id });

        const result = await service.scan(actor('write'), run.id, { code: item.code, locationId: patro.id });

        expect(result).toMatchObject({
          outcome: 'found',
          misplaced: true,
          item: { path: [{ name: 'Centrála Praha' }, { name: 'Sklad' }] },
        });
        // No move: the row stays in the location it was listed in.
        expect(store.state.rows[0]).toMatchObject({ kind: 'expected', locationId: sklad.id });
      });
    });

    describe('an item that is not on the list', () => {
      it('adds it to the run as found elsewhere at the root, remembering where it is registered', async () => {
        const { store, service, clock, actor, praha, users } = await setup();
        const brno = await store.itemStore.addLocation('Centrála Brno');
        const sklad = await store.itemStore.addLocation('Sklad', brno.id);
        const stranger = await store.addItem(sklad.id, 'Pokladní systém');
        const run = await service.start(actor('write'), { locationId: praha.id });
        clock.advance(MINUTE);

        const result = await service.scan(actor('write'), run.id, { code: stranger.code });

        expect(result).toMatchObject({
          outcome: 'found_elsewhere',
          wasMissing: false,
          item: { id: stranger.id, path: [{ name: 'Centrála Brno' }, { name: 'Sklad' }] },
          row: {
            kind: 'elsewhere',
            locationId: praha.id,
            checkedAt: clock.now(),
            checkedBy: users.write,
            method: 'scan',
            registeredPath: [{ name: 'Centrála Brno' }, { name: 'Sklad' }],
          },
        });
        expect(store.state.rows[0]).toMatchObject({ kind: 'elsewhere', registeredLocationId: sklad.id });
        expect(store.state.audit.at(-1)).toMatchObject({
          action: 'check',
          entityId: run.id,
          changes: {
            itemId: { to: stranger.id },
            kind: { from: null, to: 'elsewhere' },
            locationId: { to: praha.id },
            registeredLocationId: { to: sklad.id },
          },
        });
        expect((await service.listItems(actor('read'), run.id)).map((r) => r.itemId)).toEqual([stranger.id]);
        expect((await service.get(actor('read'), run.id)).counts).toMatchObject({ expected: 0, elsewhere: 1 });
      });

      it('records it at the location of the checklist the scanner was opened from', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const stranger = await store.addItem(null, 'Pokladní systém');
        const run = await service.start(actor('write'), { locationId: praha.id });

        const result = await service.scan(actor('write'), run.id, { code: stranger.code, locationId: patro.id });

        expect(result).toMatchObject({ outcome: 'found_elsewhere', item: { path: [] }, row: { registeredPath: [] } });
        expect(store.state.rows[0]).toMatchObject({ locationId: patro.id, registeredLocationId: null });
        const detail = await service.get(actor('read'), run.id);
        expect(detail.locations).toMatchObject([{ name: 'Patro', total: 0, checked: 0, extra: 1 }]);
      });

      it('takes an item moved into the run by an ordinary edit after the start', async () => {
        const { store, service, actor, praha } = await setup();
        const item = await store.addItem(null, 'Přenosný projektor');
        const run = await service.start(actor('write'), { locationId: praha.id });
        store.itemStore.state.items.find((i) => i.id === item.id)!.locationId = praha.id;

        await expect(service.scan(actor('write'), run.id, { code: item.code })).resolves.toMatchObject({
          outcome: 'found_elsewhere',
          item: { path: [{ name: 'Centrála Praha' }] },
        });
      });

      it('checks a found item again after it was unticked, at the location it is found in now', async () => {
        const { store, service, actor, praha, users } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const stranger = await store.addItem(null, 'Pokladní systém');
        const run = await service.start(actor('write'), { locationId: praha.id });
        await service.scan(actor('write'), run.id, { code: stranger.code });
        await service.uncheck(actor('write'), run.id, stranger.id);
        expect(await service.listItems(actor('read'), run.id)).toEqual([]);

        const result = await service.scan(actor('write', users.other), run.id, {
          code: stranger.code,
          locationId: patro.id,
        });

        expect(result).toMatchObject({ outcome: 'found_elsewhere', row: { checkedBy: users.other } });
        expect(store.state.rows).toHaveLength(1);
        expect(store.state.rows[0]).toMatchObject({ kind: 'elsewhere', locationId: patro.id });
        expect(store.state.audit.map((e) => e.action)).toEqual(['start', 'check', 'uncheck', 'check']);
      });

      it('checks an item added during the run again after it was unticked, keeping it as added', async () => {
        const { store, service, actor, praha } = await setup();
        const added = await store.addItem(praha.id, 'Nový stůl');
        const run = await service.start(actor('write'), { locationId: praha.id });
        // As the item form will add it (rule 9): created after the start, in the run as new.
        store.state.rows.length = 0;
        store.addRow(run.id, added.id, praha.id, { kind: 'new' });

        await expect(service.scan(actor('write'), run.id, { code: added.code })).resolves.toMatchObject({
          outcome: 'found',
          row: { kind: 'new' },
        });
        expect(store.state.rows).toHaveLength(1);
        expect(store.state.rows[0]).toMatchObject({ kind: 'new', locationId: praha.id });
      });
    });

    describe('nothing to record', () => {
      it('leaves a row that is already checked as it is: the first check wins, who and when are answered', async () => {
        const { store, service, clock, actor, praha, users } = await setup();
        const item = await store.addItem(praha.id);
        const run = await service.start(actor('write'), { locationId: praha.id });
        const first = await service.scan(actor('write'), run.id, { code: item.code });
        clock.advance(5 * MINUTE);
        const auditBefore = store.state.audit.length;

        const second = await service.scan(actor('write', users.other), run.id, { code: item.code });

        expect(first.outcome).toBe('found');
        expect(second).toMatchObject({ outcome: 'already_checked', row: { checkedBy: users.write } });
        expect('row' in first && 'row' in second && second.row).toEqual('row' in first && first.row);
        expect(store.state.audit).toHaveLength(auditBefore);
      });

      it('answers already checked for a found item that is scanned twice', async () => {
        const { store, service, actor, praha, users } = await setup();
        const stranger = await store.addItem(null);
        const run = await service.start(actor('write'), { locationId: praha.id });
        await service.scan(actor('write'), run.id, { code: stranger.code });
        const again = await service.scan(actor('write', users.other), run.id, { code: stranger.code });
        expect(again).toMatchObject({ outcome: 'already_checked', row: { kind: 'elsewhere', checkedBy: users.write } });
        expect(store.state.rows).toHaveLength(1);
      });

      it('reports an archived item and does not count it, listed or not', async () => {
        const { store, service, actor, praha } = await setup();
        const listed = await store.addItem(praha.id, 'Stará tiskárna');
        const stranger = await store.addItem(null, 'Starý server');
        const run = await service.start(actor('write'), { locationId: praha.id });
        for (const item of [listed, stranger]) {
          store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
        }
        const auditBefore = store.state.audit.length;

        await expect(service.scan(actor('write'), run.id, { code: listed.code })).resolves.toMatchObject({
          outcome: 'archived',
          item: { id: listed.id, name: 'Stará tiskárna' },
        });
        await expect(service.scan(actor('write'), run.id, { code: stranger.code })).resolves.toMatchObject({
          outcome: 'archived',
        });

        expect(store.state.rows).toHaveLength(1);
        expect(store.state.rows[0]!.checkedAt).toBeNull();
        expect(store.state.audit).toHaveLength(auditBefore);
      });

      it('answers an unknown code and records nothing', async () => {
        const { store, service, actor, praha } = await setup();
        await store.addItem(praha.id);
        const run = await service.start(actor('write'), { locationId: praha.id });
        const auditBefore = store.state.audit.length;

        await expect(service.scan(actor('write'), run.id, { code: 'INV-99999' })).resolves.toEqual({
          outcome: 'unknown_code',
        });

        expect(store.state.rows).toHaveLength(1);
        expect(store.state.rows[0]!.checkedAt).toBeNull();
        expect(store.state.audit).toHaveLength(auditBefore);
      });
    });

    describe('refusals', () => {
      it('refuses an unknown run and a run that has ended, whatever the code', async () => {
        const { store, service, actor, praha } = await setup();
        const item = await store.addItem(praha.id);
        const run = await service.start(actor('write'), { locationId: praha.id });
        await expectCode(service.scan(actor('write'), crypto.randomUUID(), { code: item.code }), 'not_found');

        await service.cancel(actor('write'), run.id, run.version);
        await expectCode(service.scan(actor('write'), run.id, { code: item.code }), 'inventory_closed');
        await expectCode(service.scan(actor('write'), run.id, { code: 'INV-99999' }), 'inventory_closed');
        expect(store.state.rows[0]!.checkedAt).toBeNull();
        expect(store.state.audit.map((e) => e.action)).toEqual(['start', 'cancel']);
      });

      it('refuses a context location that is not in the run, or does not exist', async () => {
        const { store, service, actor, praha } = await setup();
        const brno = await store.itemStore.addLocation('Centrála Brno');
        const above = await store.itemStore.addLocation('Budova A');
        const patro = await store.itemStore.addLocation('Patro', above.id);
        const item = await store.addItem(patro.id);
        const run = await service.start(actor('write'), { locationId: patro.id });

        await expectCode(service.scan(actor('write'), run.id, { code: item.code, locationId: brno.id }), 'location_outside_inventory');
        // The parent of the root is not part of the run either.
        await expectCode(service.scan(actor('write'), run.id, { code: item.code, locationId: above.id }), 'location_outside_inventory');
        await expectCode(service.scan(actor('write'), run.id, { code: item.code, locationId: praha.id }), 'location_outside_inventory');
        await expectCode(service.scan(actor('write'), run.id, { code: item.code, locationId: crypto.randomUUID() }), 'location_not_found');
        expect(store.state.rows[0]!.checkedAt).toBeNull();
      });

      it('accepts the root, a sub-location of any depth and an archived one as the context', async () => {
        const { store, service, actor, praha } = await setup();
        const patro = await store.itemStore.addLocation('Patro', praha.id);
        const zasedacka = await store.itemStore.addLocation('Zasedačka', patro.id);
        const stranger = await store.addItem(null);
        const run = await service.start(actor('write'), { locationId: praha.id });
        store.itemStore.locationStore.state.locations.find((l) => l.id === zasedacka.id)!.archivedAt = new Date();

        for (const locationId of [praha.id, patro.id, zasedacka.id]) {
          await expect(service.scan(actor('write'), run.id, { code: stranger.code, locationId })).resolves.toMatchObject({
            outcome: expect.stringMatching(/found_elsewhere|already_checked/),
          });
        }
      });
    });
  });

  describe('get', () => {
    it('throws not_found for an unknown run', async () => {
      const { service, actor } = await setup();
      await expectCode(service.get(actor('read'), crypto.randomUUID()), 'not_found');
    });

    it('sums up the run: counts, people, who is active now, and each location in Czech path order', async () => {
      const { store, service, clock, actor, praha, users } = await setup();
      const { addLocation } = store.itemStore;
      const names = ['Šatna', 'Sklad', 'Čistírna', 'Chodba', 'Hala'];
      const rooms = await Promise.all(names.map((name) => addLocation(name, praha.id)));
      const hala = rooms[4]!;
      const deep = await addLocation('Regál', hala.id);
      await addLocation('Prázdná', praha.id);
      const items = [];
      for (const room of [...rooms, deep, praha]) items.push(await store.addItem(room.id, `Věc v ${room.name}`));

      const run = await service.start(actor('write'), { locationId: praha.id });
      // 40 minutes ago: Jan checked the first two; 5 minutes ago: Petra checked one.
      clock.advance(-40 * MINUTE);
      store.check(run.id, items[0]!.id, users.other.id, clock.now());
      store.check(run.id, items[1]!.id, users.other.id, clock.now());
      clock.advance(35 * MINUTE);
      store.check(run.id, items[2]!.id, users.read.id, clock.now());
      clock.advance(5 * MINUTE);

      const detail = await service.get(actor('read'), run.id);

      expect(detail.counts).toEqual({ expected: 7, checked: 3, elsewhere: 0, new: 0, missing: 0 });
      expect(detail.participants).toEqual([users.write, users.other, users.read]);
      expect(detail.activeNow).toEqual([users.read]);
      expect(detail.locations.map((l) => [l.name, l.checked, l.total])).toEqual([
        ['Centrála Praha', 0, 1],
        ['Čistírna', 1, 1],
        ['Hala', 0, 1],
        ['Regál', 0, 1],
        ['Chodba', 0, 1],
        ['Sklad', 1, 1],
        ['Šatna', 1, 1],
      ]);
      expect(detail.locations.find((l) => l.name === 'Regál')!.path.map((s) => s.name)).toEqual([
        'Centrála Praha',
        'Hala',
        'Regál',
      ]);
      expect(detail.locations.find((l) => l.name === 'Sklad')!.participants).toEqual([users.other]);
      expect(detail.locations.find((l) => l.name === 'Čistírna')!.participants).toEqual([users.read]);
      expect(detail.locations.find((l) => l.name === 'Hala')!.participants).toEqual([]);
    });

    it('keeps the items found or added apart, so the locations add up to the run', async () => {
      const { store, service, actor, praha } = await setup();
      const patro = await store.itemStore.addLocation('Patro', praha.id);
      const listed = await store.addItem(praha.id, 'Kávovar');
      await store.addItem(patro.id, 'Lednice');
      const stranger = await store.addItem(null, 'Pokladní systém');
      const run = await service.start(actor('write'), { locationId: praha.id });
      await service.check(actor('write'), run.id, listed.id);
      await service.scan(actor('write'), run.id, { code: stranger.code });

      const detail = await service.get(actor('read'), run.id);

      expect(detail.counts).toMatchObject({ expected: 2, checked: 1, elsewhere: 1 });
      expect(detail.locations).toMatchObject([
        { name: 'Centrála Praha', total: 1, checked: 1, extra: 1 },
        { name: 'Patro', total: 1, checked: 0, extra: 0 },
      ]);
      expect(detail.locations.reduce((sum, l) => sum + l.total, 0)).toBe(detail.counts.expected);
      expect(detail.locations.reduce((sum, l) => sum + l.checked, 0)).toBe(detail.counts.checked);
    });

    it('leaves an item archived since the start out of the numbers', async () => {
      const { store, service, actor, praha } = await setup();
      await store.addItem(praha.id, 'Zůstává');
      const gone = await store.addItem(praha.id, 'Vyřazeno');
      const run = await service.start(actor('write'), { locationId: praha.id });
      store.check(run.id, gone.id, run.startedBy!.id);
      store.itemStore.state.items.find((i) => i.id === gone.id)!.archivedAt = new Date();

      const detail = await service.get(actor('read'), run.id);
      expect(detail.counts).toMatchObject({ expected: 1, checked: 0 });
      expect(detail.locations).toMatchObject([{ id: praha.id, total: 1, checked: 0 }]);
    });
  });

  describe('list', () => {
    it('lists runs in progress apart from ended ones, newest first, with totals', async () => {
      const { store, service, clock, actor, praha } = await setup();
      const brno = await store.itemStore.addLocation('Centrála Brno');
      const ostrava = await store.itemStore.addLocation('Centrála Ostrava');
      const first = await service.start(actor('write'), { locationId: praha.id });
      clock.advance(MINUTE);
      const second = await service.start(actor('write'), { locationId: brno.id });
      clock.advance(MINUTE);
      const third = await service.start(actor('write'), { locationId: ostrava.id });
      clock.advance(MINUTE);
      await service.cancel(actor('write'), second.id, second.version);
      clock.advance(MINUTE);
      await service.cancel(actor('write'), first.id, first.version);

      const open = await service.list(actor('read'), { state: 'open' }, { limit: 20 });
      const closed = await service.list(actor('read'), { state: 'closed' }, { limit: 20 });

      expect(open.items.map((r) => r.id)).toEqual([third.id]);
      expect(open.total).toBe(1);
      // Newest end first: the first run was cancelled last.
      expect(closed.items.map((r) => r.id)).toEqual([first.id, second.id]);
      expect(closed.total).toBe(2);
      expect(closed.items[0]).toMatchObject({ status: 'cancelled', path: [{ name: 'Centrála Praha' }] });
    });

    it('pages through runs that ended in the same moment without gaps or repeats', async () => {
      const { store, service, clock, actor } = await setup();
      const ids: string[] = [];
      for (const name of ['A', 'B', 'C', 'D', 'E']) {
        const location = await store.itemStore.addLocation(name);
        ids.push((await service.start(actor('write'), { locationId: location.id })).id);
      }
      clock.advance(MINUTE);
      for (const id of ids) await service.cancel(actor('write'), id, 1);

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.list(actor('read'), { state: 'closed' }, { limit: 2, cursor });
        seen.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it('searches the root by name, code and the names above it', async () => {
      const { store, service, actor, praha } = await setup();
      const sklad = await store.itemStore.addLocation('Sklad', praha.id);
      const brno = await store.itemStore.addLocation('Centrála Brno');
      await service.start(actor('write'), { locationId: sklad.id });
      await service.start(actor('write'), { locationId: brno.id });

      const names = async (q: string) =>
        (await service.list(actor('read'), { state: 'open', q }, { limit: 20 })).items.map((r) => r.location.name);
      expect(await names('brno')).toEqual(['Centrála Brno']);
      expect(await names('sklad praha')).toEqual(['Sklad']);
      expect(await names(brno.code)).toEqual(['Centrála Brno']);
      expect(await names('ostrava')).toEqual([]);
    });
  });
});
