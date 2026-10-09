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
