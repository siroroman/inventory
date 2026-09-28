import { asc, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { locations, manufacturers } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertLocation, insertManufacturer } from '../helpers/factories.ts';

// Czech alphabet: á is a variant of a, Č follows C, "ch" follows h, Ř follows R, Š follows S, Ž is last.
const CZECH_ORDER = ['Ábel', 'Ahoj', 'Cyril', 'Čáp', 'hrad', 'chata', 'Řeka', 'Sklad', 'Šroub', 'Žebřík'];
const shuffled = () => [...CZECH_ORDER].sort(() => Math.random() - 0.5);

describe('Czech collation', () => {
  const t = useTestDb();

  it('is set on every human-facing name column', async () => {
    const result = await t().owner.execute(sql`
      SELECT table_name, collation_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'name' ORDER BY table_name`);
    expect(result.rows).toEqual(
      ['items', 'location_types', 'locations', 'manufacturers', 'service_providers', 'user'].map(
        (table_name) => ({ table_name, collation_name: 'cs_cz' }),
      ),
    );
  });

  it('sorts location names in Czech order with a plain ORDER BY', async () => {
    for (const name of shuffled()) await insertLocation(t().app, { name });
    const rows = await t().app.select({ name: locations.name }).from(locations).orderBy(asc(locations.name));
    expect(rows.map((r) => r.name)).toEqual(CZECH_ORDER);
  });

  it('sorts manufacturer names in Czech order with a plain ORDER BY', async () => {
    for (const name of shuffled()) await insertManufacturer(t().app, { name });
    const rows = await t()
      .app.select({ name: manufacturers.name })
      .from(manufacturers)
      .orderBy(asc(manufacturers.name));
    expect(rows.map((r) => r.name)).toEqual(CZECH_ORDER);
  });
});
