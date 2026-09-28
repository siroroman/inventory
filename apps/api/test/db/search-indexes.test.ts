import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { itemExternalIds } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation, insertManufacturer } from '../helpers/factories.ts';

const TRIGRAM_INDEXES: [table: string, column: string, index: string][] = [
  ['items', 'name', 'items_name_trgm_idx'],
  ['items', 'code', 'items_code_trgm_idx'],
  ['items', 'serial_number', 'items_serial_number_trgm_idx'],
  ['items', 'model', 'items_model_trgm_idx'],
  ['item_external_ids', 'value', 'item_external_ids_value_trgm_idx'],
  ['manufacturers', 'name', 'manufacturers_name_trgm_idx'],
  ['locations', 'name', 'locations_name_trgm_idx'],
];

// The normalization repositories must use so that searches hit the trigram indexes.
const matches = (column: string, query: string) =>
  sql`f_unaccent(lower(${sql.identifier(column)})) LIKE '%' || f_unaccent(lower(${query})) || '%'`;

describe('search indexes', () => {
  const t = useTestDb();

  it.each(TRIGRAM_INDEXES)('%s.%s is searched through %s', async (table, column, index) => {
    const plan = await t().owner.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute(sql`EXPLAIN SELECT 1 FROM ${sql.identifier(table)} WHERE ${matches(column, 'abc')}`);
    });
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain(index);
  });

  it('finds item names ignoring case and diacritics', async () => {
    const location = await insertLocation(t().app);
    await insertItem(t().app, { name: 'Židle kancelářská', locationId: location.id });
    await insertItem(t().app, { name: 'Stůl jídelní', locationId: location.id });
    for (const query of ['ZIDLE', 'židle', 'kancelarska', 'dle kan']) {
      const found = await t().app.execute(sql`SELECT name FROM items WHERE ${matches('name', query)}`);
      expect(found.rows, query).toEqual([{ name: 'Židle kancelářská' }]);
    }
  });

  it('finds items by an external ID fragment in any case', async () => {
    const item = await insertItem(t().app);
    await t().app.insert(itemExternalIds).values({ itemId: item.id, source: 'Elektrikář', value: 'EL-4821' });
    for (const query of ['el-4821', 'EL-48', '4821']) {
      const found = await t().app.execute(
        sql`SELECT item_id FROM item_external_ids WHERE ${matches('value', query)}`,
      );
      expect(found.rows, query).toEqual([{ item_id: item.id }]);
    }
  });

  it('finds manufacturers and locations ignoring diacritics', async () => {
    await insertManufacturer(t().app, { name: 'Škoda Transportation' });
    await insertLocation(t().app, { name: 'Přízemí výroba' });
    const m = await t().app.execute(sql`SELECT name FROM manufacturers WHERE ${matches('name', 'skoda')}`);
    const l = await t().app.execute(sql`SELECT name FROM locations WHERE ${matches('name', 'prizemi')}`);
    expect(m.rows).toEqual([{ name: 'Škoda Transportation' }]);
    expect(l.rows).toEqual([{ name: 'Přízemí výroba' }]);
  });
});
