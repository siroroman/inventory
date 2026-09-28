import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers/db.ts';

describe('database functions', () => {
  const t = useTestDb();

  it.each([
    ['Žluťoučký kůň úpěl ďábelské ódy', 'Zlutoucky kun upel dabelske ody'],
    ['ŘEŘICHA', 'RERICHA'],
    ['EL-4821', 'EL-4821'],
  ])('f_unaccent(%j) strips diacritics', async (input, expected) => {
    const result = await t().app.execute(sql`SELECT f_unaccent(${input}) AS v`);
    expect(result.rows[0]!.v).toBe(expected);
  });

  it('f_unaccent is IMMUTABLE so it can back expression indexes', async () => {
    const result = await t().owner.execute(
      sql`SELECT provolatile FROM pg_proc WHERE proname = 'f_unaccent'`,
    );
    expect(result.rows).toEqual([{ provolatile: 'i' }]);
  });

  it.each([
    ['LOC', 4, 3, 'LOC-004'],
    ['LOC', 999, 3, 'LOC-999'],
    ['LOC', 1000, 3, 'LOC-1000'],
    ['INV', 42, 5, 'INV-00042'],
    ['SUP', 1, 3, 'SUP-001'],
  ])('format_code(%s, %i, %i) = %s', async (prefix, n, width, expected) => {
    const result = await t().app.execute(sql`SELECT format_code(${prefix}, ${n}, ${width}) AS v`);
    expect(result.rows[0]!.v).toBe(expected);
  });
});
