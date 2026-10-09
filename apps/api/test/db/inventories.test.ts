import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { inventories } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertInventory, insertInventoryItem, insertItem, insertLocation, insertUser } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('inventories', () => {
  const t = useTestDb();

  it('starts in progress, at version 1, with no end', async () => {
    const run = await insertInventory(t().app);
    expect(run).toMatchObject({ status: 'in_progress', version: 1, endedAt: null, endedBy: null });
  });

  it('rejects an unknown status', async () => {
    const user = await insertUser(t().app);
    await expectPgError(insertInventory(t().app, { status: 'paused', endedAt: new Date(), endedBy: user.id }), {
      code: PG.checkViolation,
      constraint: 'inventories_status_valid',
    });
  });

  describe('end fields', () => {
    it('are required once the run is not in progress', async () => {
      const user = await insertUser(t().app);
      for (const ended of [{}, { endedAt: new Date() }, { endedBy: user.id }]) {
        await expectPgError(insertInventory(t().app, { status: 'cancelled', ...ended }), {
          code: PG.checkViolation,
          constraint: 'inventories_ended_when_closed',
        });
      }
      const run = await insertInventory(t().app, { status: 'cancelled', endedAt: new Date(), endedBy: user.id });
      expect(run.status).toBe('cancelled');
    });

    it('are refused on a run in progress', async () => {
      const user = await insertUser(t().app);
      await expectPgError(insertInventory(t().app, { endedAt: new Date(), endedBy: user.id }), {
        code: PG.checkViolation,
        constraint: 'inventories_ended_when_closed',
      });
    });
  });

  it('bumps the version on update', async () => {
    const run = await insertInventory(t().app);
    const user = await insertUser(t().app);
    await t().app.update(inventories).set({ status: 'finished', endedAt: new Date(), endedBy: user.id }).where(eq(inventories.id, run.id));
    const [after] = await t().app.select().from(inventories).where(eq(inventories.id, run.id));
    expect(after!.version).toBe(2);
  });

  it('cannot be deleted by the runtime role, and keeps its location', async () => {
    const run = await insertInventory(t().app);
    await expectPgError(t().app.execute(sql`DELETE FROM inventories WHERE id = ${run.id}`), {
      code: PG.insufficientPrivilege,
    });
    await expectPgError(t().owner.execute(sql`DELETE FROM locations WHERE id = ${run.locationId}`), {
      code: PG.foreignKeyViolation,
      constraint: 'inventories_location_id_locations_id_fk',
    });
  });
});

describe('inventory_items', () => {
  const t = useTestDb();

  it('holds an item once per run', async () => {
    const run = await insertInventory(t().app);
    const row = await insertInventoryItem(t().app, { inventoryId: run.id });
    await expectPgError(
      insertInventoryItem(t().app, { inventoryId: run.id, itemId: row.itemId, locationId: row.locationId }),
      { code: PG.uniqueViolation, constraint: 'inventory_items_inventory_id_item_id_key' },
    );
    // The same item may be in another run.
    await insertInventoryItem(t().app, { itemId: row.itemId, locationId: row.locationId });
  });

  it('rejects an unknown kind, method or outcome', async () => {
    const user = await insertUser(t().app);
    await expectPgError(insertInventoryItem(t().app, { kind: 'lost' }), {
      code: PG.checkViolation,
      constraint: 'inventory_items_kind_valid',
    });
    await expectPgError(
      insertInventoryItem(t().app, { checkedAt: new Date(), checkedBy: user.id, method: 'telepathy' }),
      { code: PG.checkViolation, constraint: 'inventory_items_method_valid' },
    );
    await expectPgError(insertInventoryItem(t().app, { outcome: 'burned' }), {
      code: PG.checkViolation,
      constraint: 'inventory_items_outcome_valid',
    });
  });

  it('records who, when and how a check was made together or not at all', async () => {
    const user = await insertUser(t().app);
    const checked = await insertInventoryItem(t().app, { checkedAt: new Date(), checkedBy: user.id, method: 'scan' });
    expect(checked.method).toBe('scan');
    for (const partial of [
      { checkedAt: new Date() },
      { checkedBy: user.id },
      { method: 'manual' },
      { checkedAt: new Date(), checkedBy: user.id },
    ]) {
      await expectPgError(insertInventoryItem(t().app, partial), {
        code: PG.checkViolation,
        constraint: 'inventory_items_checked_together',
      });
    }
  });

  it('gives an outcome only to unchecked expected rows', async () => {
    const user = await insertUser(t().app);
    const missing = await insertInventoryItem(t().app, { outcome: 'missing' });
    expect(missing.outcome).toBe('missing');
    await expectPgError(insertInventoryItem(t().app, { kind: 'elsewhere', outcome: 'missing' }), {
      code: PG.checkViolation,
      constraint: 'inventory_items_outcome_unchecked_expected',
    });
    await expectPgError(
      insertInventoryItem(t().app, { outcome: 'skipped', checkedAt: new Date(), checkedBy: user.id, method: 'manual' }),
      { code: PG.checkViolation, constraint: 'inventory_items_outcome_unchecked_expected' },
    );
  });

  it('may be unticked: a check can be cleared again', async () => {
    const user = await insertUser(t().app);
    const row = await insertInventoryItem(t().app, { kind: 'elsewhere', checkedAt: new Date(), checkedBy: user.id, method: 'scan' });
    await t().app.execute(
      sql`UPDATE inventory_items SET checked_at = NULL, checked_by = NULL, method = NULL WHERE id = ${row.id}`,
    );
  });

  it('cannot be deleted by the runtime role and keeps its item and location', async () => {
    const row = await insertInventoryItem(t().app);
    await expectPgError(t().app.execute(sql`DELETE FROM inventory_items WHERE id = ${row.id}`), {
      code: PG.insufficientPrivilege,
    });
    await expectPgError(t().owner.execute(sql`DELETE FROM items WHERE id = ${row.itemId}`), {
      code: PG.foreignKeyViolation,
      constraint: 'inventory_items_item_id_items_id_fk',
    });
    await expectPgError(t().owner.execute(sql`DELETE FROM locations WHERE id = ${row.locationId}`), {
      code: PG.foreignKeyViolation,
    });
  });

  it('keeps a found-elsewhere item with no registered location', async () => {
    const where = await insertLocation(t().app, { name: 'Sklad' });
    const item = await insertItem(t().app, { locationId: null });
    const row = await insertInventoryItem(t().app, {
      itemId: item.id,
      kind: 'elsewhere',
      locationId: where.id,
      registeredLocationId: null,
    });
    expect(row.registeredLocationId).toBeNull();
  });
});
