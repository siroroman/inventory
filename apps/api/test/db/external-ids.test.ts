import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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

  it('reject an exact duplicate on the same item', async () => {
    const item = await insertItem(t().app);
    await add(item.id, 'Elektrikář', 'EL-4821');
    await expectPgError(add(item.id, 'Elektrikář', 'EL-4821'), {
      code: PG.uniqueViolation,
      constraint: 'item_external_ids_item_source_value_key',
    });
  });

  // SPEC.md open question 7: global uniqueness is undecided, so the DB allows it for now.
  it('allow the same source and value on two different items', async () => {
    const first = await insertItem(t().app);
    const second = await insertItem(t().app, { locationId: first.locationId });
    await add(first.id, 'Elektrikář', 'EL-4821');
    await add(second.id, 'Elektrikář', 'EL-4821');
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
