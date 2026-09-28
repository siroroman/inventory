import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { locationTypes } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('location_types', () => {
  const t = useTestDb();

  it('are seeded with the four default types in order', async () => {
    const rows = await t()
      .app.select({ code: locationTypes.code, name: locationTypes.name })
      .from(locationTypes)
      .orderBy(asc(locationTypes.sortOrder));
    expect(rows).toEqual([
      { code: 'HQ', name: 'Centrála' },
      { code: 'STORE', name: 'Prodejna' },
      { code: 'SITE', name: 'Provozovna' },
      { code: 'WAREHOUSE', name: 'Sklad' },
    ]);
  });

  it('can be extended with a new row', async () => {
    await t().app.insert(locationTypes).values({ code: 'OFFICE', name: 'Kancelář', sortOrder: 5 });
  });

  it.each([
    [{ code: 'HQ', name: 'Jiná centrála' }, 'location_types_code_key'],
    [{ code: 'HQ2', name: 'Centrála' }, 'location_types_name_key'],
  ])('rejects a duplicate %j', async (values, constraint) => {
    await expectPgError(t().app.insert(locationTypes).values(values), { code: PG.uniqueViolation, constraint });
  });

  it.each([
    [{ code: ' ', name: 'Prázdný kód' }, 'location_types_code_not_blank'],
    [{ code: 'EMPTY', name: '  ' }, 'location_types_name_not_blank'],
  ])('rejects a blank value %j', async (values, constraint) => {
    await expectPgError(t().app.insert(locationTypes).values(values), { code: PG.checkViolation, constraint });
  });
});
