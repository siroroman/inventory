import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { inventories, inventoryItems, items } from '../../../src/db/schema/index.ts';
import type { DomainError } from '../../../src/errors.ts';
import { createInventoryRepository } from '../../../src/modules/inventories/repository.ts';
import { createInventoryService, inventoryRepos } from '../../../src/modules/inventories/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertInventory, insertInventoryItem, insertItem, insertLocation, insertUser } from '../../helpers/factories.ts';

// The rules are unit-tested with fakes; this checks the wiring and the locks against a real database.
describe('inventory service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { name: 'Roman Siro', role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const service = createInventoryService({
      repos: inventoryRepos(t().app),
      transact: transactor(t().app, inventoryRepos),
    });
    return { user, actor, service };
  }

  it('starts, shows and cancels a run with an audit entry for each step', async () => {
    const { actor, service, user } = await setup();
    const praha = await insertLocation(t().app, { name: 'Centrála Praha' });
    const patro = await insertLocation(t().app, { name: 'Patro', parentId: praha.id });
    await insertItem(t().app, { locationId: praha.id });
    await insertItem(t().app, { locationId: patro.id });

    const started = await service.start(actor, { locationId: praha.id });
    expect(started).toMatchObject({
      status: 'in_progress',
      startedBy: { id: user.id, name: 'Roman Siro' },
      counts: { expected: 2, checked: 0 },
      participants: [{ id: user.id }],
      path: [{ name: 'Centrála Praha' }],
    });
    expect(started.locations.map((l) => [l.name, l.total])).toEqual([['Centrála Praha', 1], ['Patro', 1]]);
    expect(await service.preview(actor, patro.id)).toMatchObject({ overlap: { id: started.id } });

    const cancelled = await service.cancel(actor, started.id, started.version);
    expect(cancelled).toMatchObject({ status: 'cancelled', version: 2, closedBy: { id: user.id } });
    expect(await service.list(actor, { state: 'open' }, { limit: 20 })).toMatchObject({ items: [], total: 0 });
    expect(await service.list(actor, { state: 'closed' }, { limit: 20 })).toMatchObject({
      items: [{ id: started.id }],
      total: 1,
    });

    const history = await inventoryRepos(t().app).audit.list(
      { entityType: 'inventory', entityId: started.id },
      { limit: 10 },
    );
    expect(history.items.map((e) => e.action)).toEqual(['cancel', 'start']);
  });

  it('leaves nothing behind when a start is refused', async () => {
    const { actor, service } = await setup();
    const location = await insertLocation(t().app);
    await insertItem(t().app, { locationId: location.id });
    await service.start(actor, { locationId: location.id });
    await expect(service.start(actor, { locationId: location.id })).rejects.toMatchObject({ code: 'inventory_overlap' });

    expect(await t().app.select().from(inventories)).toHaveLength(1);
    expect(await t().app.select().from(inventoryItems)).toHaveLength(1);
  });

  describe('checks', () => {
    /** A run with one listed item, and a second writer. */
    async function run() {
      const base = await setup();
      const other = await insertUser(t().app, { name: 'Jan Novák', role: 'write' });
      const otherActor: Actor = { id: other.id, role: 'write' };
      const inventory = await insertInventory(t().app, { createdBy: base.actor.id });
      const item = await insertItem(t().app, { name: 'Kávovar', locationId: inventory.locationId });
      await insertInventoryItem(t().app, { inventoryId: inventory.id, itemId: item.id, locationId: inventory.locationId });
      const history = async () =>
        (await inventoryRepos(t().app).audit.list({ entityType: 'inventory', entityId: inventory.id }, { limit: 20 })).items.map(
          (e) => e.action,
        );
      return { ...base, other, otherActor, inventory, item, history };
    }

    it('ticks and unticks an item with an audit entry for each, and counts it in the run', async () => {
      const { actor, service, user, inventory, item, history } = await run();

      const ticked = await service.check(actor, inventory.id, item.id);
      expect(ticked).toMatchObject({ itemId: item.id, name: 'Kávovar', checkedBy: { id: user.id, name: 'Roman Siro' }, method: 'manual' });
      expect(await service.get(actor, inventory.id)).toMatchObject({ counts: { checked: 1 }, version: 1 });
      expect((await service.listItems(actor, inventory.id)).map((r) => r.checkedBy?.id)).toEqual([user.id]);

      await service.uncheck(actor, inventory.id, item.id);
      expect(await service.get(actor, inventory.id)).toMatchObject({ counts: { checked: 0 } });
      expect(await history()).toEqual(['uncheck', 'check']);
    });

    it('let the first of two simultaneous ticks win, with one audit entry', async () => {
      const { actor, otherActor, service, inventory, item, history } = await run();
      const settled = await Promise.all([
        service.check(actor, inventory.id, item.id),
        service.check(otherActor, inventory.id, item.id),
      ]);
      // Both are told who really checked it.
      expect(settled[0]!.checkedBy!.id).toBe(settled[1]!.checkedBy!.id);
      expect(await history()).toEqual(['check']);
    });

    it('tell the loser of two ticks who really checked it, also when it read the row before the winner committed', async () => {
      const { actor, otherActor, service, inventory, item } = await run();
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The winner is half-way: it has ticked the row but not committed.
      const winner = t().app.transaction(async (tx) => {
        const repo = createInventoryRepository(tx);
        await repo.lockShared(inventory.id);
        await repo.markChecked(inventory.id, item.id, { checkedAt: new Date(), checkedBy: actor.id, method: 'manual' });
        await hold;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The loser reads the row unchecked, then waits for the winner's row lock.
      const loser = service.check(otherActor, inventory.id, item.id);
      await new Promise((resolve) => setTimeout(resolve, 150));
      release();
      await winner;

      expect(await loser).toMatchObject({ itemId: item.id, checkedBy: { id: actor.id } });
    });

    it('never lose a tick to a cancel: a tick is either saved before it or refused after it', async () => {
      const { actor, otherActor, service, inventory, item, history } = await run();
      const [tick, cancel] = await Promise.allSettled([
        service.check(otherActor, inventory.id, item.id),
        service.cancel(actor, inventory.id, inventory.version),
      ]);
      expect(cancel.status).toBe('fulfilled');
      const stored = (await service.listItems(actor, inventory.id))[0]!;
      if (tick.status === 'fulfilled') {
        expect(stored.checkedAt).not.toBeNull();
        expect(await history()).toEqual(['cancel', 'check']);
      } else {
        expect((tick.reason as DomainError).code).toBe('inventory_closed');
        expect(stored.checkedAt).toBeNull();
        expect(await history()).toEqual(['cancel']);
      }
      // Whichever came first, nothing can be ticked now.
      await expect(service.check(actor, inventory.id, item.id)).rejects.toMatchObject({ code: 'inventory_closed' });
    });
  });

  describe('scans', () => {
    /** A run with one listed item and an item of another location that the run does not list. */
    async function run() {
      const base = await setup();
      const other = await insertUser(t().app, { name: 'Jan Novák', role: 'write' });
      const otherActor: Actor = { id: other.id, role: 'write' };
      const inventory = await insertInventory(t().app, { createdBy: base.actor.id });
      const listed = await insertItem(t().app, { name: 'Kávovar', locationId: inventory.locationId });
      await insertInventoryItem(t().app, { inventoryId: inventory.id, itemId: listed.id, locationId: inventory.locationId });
      const sklad = await insertLocation(t().app, { name: 'Sklad' });
      const stranger = await insertItem(t().app, { name: 'Pokladní systém', locationId: sklad.id });
      const history = async () =>
        (await inventoryRepos(t().app).audit.list({ entityType: 'inventory', entityId: inventory.id }, { limit: 20 })).items.map(
          (e) => e.action,
        );
      const rows = () => t().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, inventory.id));
      return { ...base, other, otherActor, inventory, listed, stranger, sklad, history, rows };
    }

    it('checks a listed item by its code and adds an unlisted one as found elsewhere, each with an audit entry', async () => {
      const { actor, service, user, inventory, listed, stranger, sklad, history, rows } = await run();

      const found = await service.scan(actor, inventory.id, { code: listed.code.toLowerCase() });
      expect(found).toMatchObject({ outcome: 'found', misplaced: false, row: { checkedBy: { id: user.id }, method: 'scan' } });

      const elsewhere = await service.scan(actor, inventory.id, { code: stranger.code });
      expect(elsewhere).toMatchObject({
        outcome: 'found_elsewhere',
        item: { path: [{ name: 'Sklad' }] },
        row: { kind: 'elsewhere', locationId: inventory.locationId },
      });

      expect(await rows()).toHaveLength(2);
      expect(await rows().then((all) => all.find((r) => r.itemId === stranger.id))).toMatchObject({
        kind: 'elsewhere',
        locationId: inventory.locationId,
        registeredLocationId: sklad.id,
        method: 'scan',
      });
      expect(await service.get(actor, inventory.id)).toMatchObject({
        version: 1,
        counts: { expected: 1, checked: 1, elsewhere: 1 },
      });
      expect(await history()).toEqual(['check', 'check']);
    });

    it('checks a found item again after it was unticked, through the upsert, at the new context', async () => {
      const { actor, service, inventory, listed, stranger, history, rows } = await run();
      const room = await insertLocation(t().app, { name: 'Zasedačka', parentId: inventory.locationId });

      await service.scan(actor, inventory.id, { code: stranger.code });
      await service.uncheck(actor, inventory.id, stranger.id);
      // Only the listed item is left; the unticked found item is kept in the table but hidden.
      expect((await service.listItems(actor, inventory.id)).map((r) => r.itemId)).toEqual([listed.id]);

      const again = await service.scan(actor, inventory.id, { code: stranger.code, locationId: room.id, method: 'manual' });

      expect(again).toMatchObject({ outcome: 'found_elsewhere', row: { locationId: room.id, method: 'manual' } });
      expect(await rows()).toHaveLength(2);
      expect(await history()).toEqual(['check', 'uncheck', 'check']);
    });

    it('let the first of two simultaneous scans of a listed item win, with one audit entry', async () => {
      const { actor, otherActor, service, inventory, listed, history } = await run();
      const settled = await Promise.all([
        service.scan(actor, inventory.id, { code: listed.code }),
        service.scan(otherActor, inventory.id, { code: listed.code }),
      ]);
      expect(settled.map((r) => r.outcome).sort()).toEqual(['already_checked', 'found']);
      const [a, b] = settled.map((r) => ('row' in r ? r.row.checkedBy!.id : null));
      expect(a).toBe(b);
      expect(await history()).toEqual(['check']);
    });

    it('let the first of two simultaneous scans of an unlisted item win, with one row and one audit entry', async () => {
      const { actor, otherActor, service, inventory, stranger, history, rows } = await run();
      const settled = await Promise.all([
        service.scan(actor, inventory.id, { code: stranger.code }),
        service.scan(otherActor, inventory.id, { code: stranger.code }),
      ]);
      expect(settled.map((r) => r.outcome).sort()).toEqual(['already_checked', 'found_elsewhere']);
      const [a, b] = settled.map((r) => ('row' in r ? r.row.checkedBy!.id : null));
      expect(a).toBe(b);
      expect((await rows()).filter((r) => r.itemId === stranger.id)).toHaveLength(1);
      expect(await history()).toEqual(['check']);
    });

    // The winner is half-way (checked, not committed) while the loser reads the row and then waits for it.
    async function loserOfHalfWayWinner(
      winnerWrites: (repo: ReturnType<typeof createInventoryRepository>) => Promise<unknown>,
      loserScans: () => Promise<unknown>,
      inventoryId: string,
    ) {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const winner = t().app.transaction(async (tx) => {
        const repo = createInventoryRepository(tx);
        await repo.lockShared(inventoryId);
        await winnerWrites(repo);
        await hold;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const loser = loserScans();
      await new Promise((resolve) => setTimeout(resolve, 150));
      release();
      await winner;
      return loser;
    }

    it('tell the loser of two scans of a listed item who really checked it, with no second audit entry', async () => {
      const { actor, otherActor, service, inventory, listed, history } = await run();
      const result = await loserOfHalfWayWinner(
        (repo) => repo.markChecked(inventory.id, listed.id, { checkedAt: new Date(), checkedBy: actor.id, method: 'scan' }),
        () => service.scan(otherActor, inventory.id, { code: listed.code }),
        inventory.id,
      );
      expect(result).toMatchObject({ outcome: 'already_checked', row: { checkedBy: { id: actor.id }, method: 'scan' } });
      expect(await history()).toEqual([]);
    });

    it('tell the loser of two scans of an unlisted item who really checked it, through the upsert', async () => {
      const { actor, otherActor, service, inventory, stranger, sklad, rows } = await run();
      const result = await loserOfHalfWayWinner(
        (repo) =>
          repo.recordFound(inventory.id, stranger.id, {
            locationId: inventory.locationId,
            registeredLocationId: sklad.id,
            checkedAt: new Date(),
            checkedBy: actor.id,
            method: 'scan',
          }),
        () => service.scan(otherActor, inventory.id, { code: stranger.code }),
        inventory.id,
      );
      expect(result).toMatchObject({ outcome: 'already_checked', row: { kind: 'elsewhere', checkedBy: { id: actor.id } } });
      expect((await rows()).filter((r) => r.itemId === stranger.id)).toHaveLength(1);
    });

    it('never lose a scan to a cancel: it is either saved before it or refused after it', async () => {
      const { actor, otherActor, service, inventory, stranger, history, rows } = await run();
      const [scan, cancel] = await Promise.allSettled([
        service.scan(otherActor, inventory.id, { code: stranger.code }),
        service.cancel(actor, inventory.id, inventory.version),
      ]);
      expect(cancel.status).toBe('fulfilled');
      const stored = (await rows()).filter((r) => r.itemId === stranger.id);
      if (scan.status === 'fulfilled') {
        expect(stored).toHaveLength(1);
        expect(await history()).toEqual(['cancel', 'check']);
      } else {
        expect((scan.reason as DomainError).code).toBe('inventory_closed');
        expect(stored).toHaveLength(0);
        expect(await history()).toEqual(['cancel']);
      }
      await expect(service.scan(actor, inventory.id, { code: stranger.code })).rejects.toMatchObject({
        code: 'inventory_closed',
      });
    });

    it('answers an unknown code and an archived item without writing anything', async () => {
      const { actor, service, inventory, stranger, history, rows } = await run();
      await t().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, stranger.id));

      await expect(service.scan(actor, inventory.id, { code: 'INV-NOPE-1' })).resolves.toEqual({ outcome: 'unknown_code' });
      await expect(service.scan(actor, inventory.id, { code: stranger.code })).resolves.toMatchObject({ outcome: 'archived' });

      expect(await rows()).toHaveLength(1);
      expect(await history()).toEqual([]);
    });

    it('refuses a context location outside the run', async () => {
      const { actor, service, inventory, stranger, sklad } = await run();
      await expect(
        service.scan(actor, inventory.id, { code: stranger.code, locationId: sklad.id }),
      ).rejects.toMatchObject({ code: 'location_outside_inventory' });
    });
  });

  describe('simultaneous starts', () => {
    const outcome = (settled: PromiseSettledResult<unknown>[]) =>
      settled.map((r) => (r.status === 'fulfilled' ? 'started' : (r.reason as DomainError).code));

    // A smoke test: the next one is what proves the lock, because here the first start can commit before the second begins.
    it('let only one of two starts for the same location through', async () => {
      const { actor, service } = await setup();
      const location = await insertLocation(t().app);
      const settled = await Promise.allSettled([
        service.start(actor, { locationId: location.id }),
        service.start(actor, { locationId: location.id }),
      ]);
      expect(outcome(settled).sort()).toEqual(['inventory_overlap', 'started']);
    });

    it('wait for a start in progress and then see its run', async () => {
      const { actor, service } = await setup();
      const location = await insertLocation(t().app);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Another start is half-way: it holds the lock and has written its run, but not committed.
      const other = t().app.transaction(async (tx) => {
        const repo = createInventoryRepository(tx);
        await repo.lockStarts();
        await repo.insert({ locationId: location.id, createdBy: actor.id, createdAt: new Date() });
        await hold;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      let finished = false;
      const start = service.start(actor, { locationId: location.id }).finally(() => {
        finished = true;
      });
      const checked = start.catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(finished, 'the start waits for the lock').toBe(false);

      release();
      await other;
      expect(await checked).toMatchObject({ code: 'inventory_overlap' });
    });
  });

  describe('simultaneous cancels', () => {
    it('end the run once: the other is told it is already closed', async () => {
      const { actor, service } = await setup();
      const run = await insertInventory(t().app, { createdBy: actor.id });
      const settled = await Promise.allSettled([
        service.cancel(actor, run.id, run.version),
        service.cancel(actor, run.id, run.version),
      ]);
      const codes = settled.map((r) => (r.status === 'fulfilled' ? 'cancelled' : (r.reason as DomainError).code));
      expect(codes.sort()).toEqual(['cancelled', 'inventory_closed']);
      const history = await inventoryRepos(t().app).audit.list({ entityType: 'inventory', entityId: run.id }, { limit: 10 });
      expect(history.items.map((e) => e.action)).toEqual(['cancel']);
    });

    it('refuse a stale version', async () => {
      const { actor, service } = await setup();
      const run = await insertInventory(t().app, { createdBy: actor.id });
      await expect(service.cancel(actor, run.id, 9)).rejects.toMatchObject({ code: 'conflict' });
    });
  });
});
