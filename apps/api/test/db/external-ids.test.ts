import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING_SOURCE, SHARED_SOURCES } from '../../src/db/accounting.ts';
import { itemExternalIds } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('item_external_ids', () => {
  const t = useTestDb();
  const add = (itemId: string, source: string, value: string) =>
    t().app.insert(itemExternalIds).values({ itemId, source, value });

  it('allow several IDs per item from different suppliers', async () => {
    const item = await insertItem(t().app);
    await add(item.id, 'Elektrikář', 'EL-4821');
    await add(item.id, 'Revize plynu', 'RP-2026-17');
    await add(item.id, 'Elektrikář', 'EL-4822');
    const rows = await t().app.select().from(itemExternalIds).where(eq(itemExternalIds.itemId, item.id));
    expect(rows).toHaveLength(3);
  });

  it('allow the same value from a different source', async () => {
    const item = await insertItem(t().app);
    await add(item.id, 'Elektrikář', '100');
    await add(item.id, 'Vzduchotechnika', '100');
  });

  it.each([
    ['Elektrikář', 'EL-4821'],
    [ACCOUNTING_SOURCE, '69-1134'],
  ])('reject an exact duplicate on the same item (%j)', async (source, value) => {
    const item = await insertItem(t().app);
    await add(item.id, source, value);
    await expectPgError(add(item.id, source.toUpperCase(), value), {
      code: PG.uniqueViolation,
      constraint: 'item_external_ids_item_source_value_key',
    });
  });

  // The accountant keeps several pieces under one number; each piece is its own item.
  it.each(SHARED_SOURCES.flatMap((source) => [source, source.toLowerCase(), source.toUpperCase()]))(
    'allow one value of a shared source on several items (%j)',
    async (source) => {
      const first = await insertItem(t().app);
      const second = await insertItem(t().app, { locationId: first.locationId });
      await add(first.id, SHARED_SOURCES[0], '69-1134');
      await add(second.id, source, '69-1134');
      const rows = await t().app.select().from(itemExternalIds).where(eq(itemExternalIds.value, '69-1134'));
      expect(rows).toHaveLength(2);
    },
  );

  // The index's WHERE names the source as a literal (drizzle-kit cannot write a parameter into
  // DDL), so SHARED_SOURCES and the index could drift apart; this fails when they do.
  it('exempts exactly SHARED_SOURCES from the cross-item unique index', async () => {
    const result = await t().owner.execute(sql`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'item_external_ids_source_value_key'`);
    const where = String(result.rows[0]?.indexdef).split(' WHERE ')[1] ?? '';
    const named = [...where.matchAll(/lower\('([^']+)'::text\)/g)].map((m) => m[1]);
    expect(named.sort()).toEqual([...SHARED_SOURCES].sort());
  });

  // One supplier's ID identifies a single item (SPEC.md open question 7).
  it.each([
    ['Elektrikář', 'EL-4821'],
    ['ELEKTRIKÁŘ', 'el-4821'],
  ])('reject the same source and value on another item (%j, %j)', async (source, value) => {
    const first = await insertItem(t().app);
    const second = await insertItem(t().app, { locationId: first.locationId });
    await add(first.id, 'Elektrikář', 'EL-4821');
    await expectPgError(add(second.id, source, value), {
      code: PG.uniqueViolation,
      constraint: 'item_external_ids_source_value_key',
    });
  });

  it('keep an archived item\'s IDs reserved, so restoring it cannot collide', async () => {
    const archived = await insertItem(t().app, { archivedAt: new Date() });
    const active = await insertItem(t().app, { locationId: archived.locationId });
    await add(archived.id, 'Elektrikář', 'EL-4821');
    await expectPgError(add(active.id, 'Elektrikář', 'EL-4821'), {
      code: PG.uniqueViolation,
      constraint: 'item_external_ids_source_value_key',
    });
  });

  it('allow the same value from a different source on another item', async () => {
    const first = await insertItem(t().app);
    const second = await insertItem(t().app, { locationId: first.locationId });
    await add(first.id, 'Elektrikář', '100');
    await add(second.id, 'Vzduchotechnika', '100');
  });

  it.each([
    [' ', 'EL-1', 'item_external_ids_source_not_blank'],
    ['Elektrikář', '  ', 'item_external_ids_value_not_blank'],
  ])('reject blank source/value (%j, %j)', async (source, value, constraint) => {
    const item = await insertItem(t().app);
    await expectPgError(add(item.id, source, value), { code: PG.checkViolation, constraint });
  });

  it('reject an unknown item', async () => {
    await expectPgError(add(randomUUID(), 'Elektrikář', 'EL-1'), {
      code: PG.foreignKeyViolation,
      constraint: 'item_external_ids_item_id_items_id_fk',
    });
  });
});
