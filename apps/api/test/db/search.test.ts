import { describe, expect, it } from 'vitest';
import { items } from '../../src/db/schema/index.ts';
import { containsText, escapeLike } from '../../src/db/search.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation } from '../helpers/factories.ts';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});

describe('containsText', () => {
  const t = useTestDb();

  async function search(query: string) {
    const rows = await t().app.select({ name: items.name }).from(items).where(containsText(items.name, query));
    return rows.map((r) => r.name).sort();
  }

  it('treats wildcards in the query literally', async () => {
    const location = await insertLocation(t().app);
    for (const name of ['Sleva 50%', 'Sleva 500', 'A_B', 'AxB', 'C\\D']) {
      await insertItem(t().app, { name, locationId: location.id });
    }
    expect(await search('50%')).toEqual(['Sleva 50%']);
    expect(await search('a_b')).toEqual(['A_B']);
    expect(await search('c\\d')).toEqual(['C\\D']);
  });

  it('ignores case and diacritics on both sides', async () => {
    const location = await insertLocation(t().app);
    await insertItem(t().app, { name: 'Žehlič prádla', locationId: location.id });
    expect(await search('ZEHLIC')).toEqual(['Žehlič prádla']);
    expect(await search('pRÁdla')).toEqual(['Žehlič prádla']);
  });
});
