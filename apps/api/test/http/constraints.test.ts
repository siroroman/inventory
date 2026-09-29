import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { constraintErrors, unmappedConstraints } from '../../src/http/errors.ts';
import { useTestDb } from '../helpers/db.ts';

const db = useTestDb();

async function uniqueIndexNames(): Promise<string[]> {
  const result = await db().owner.execute(sql`
    SELECT i.relname AS name
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND x.indisunique AND NOT x.indisprimary`);
  return result.rows.map((row) => String(row.name)).sort();
}

// A new unique constraint must either become an API error or be listed as deliberately unmapped
// (with the reason); otherwise a duplicate would surface as a 500 nobody planned for.
describe('unique constraints', () => {
  it('are each mapped to an error code or listed as deliberately unmapped', async () => {
    const known = new Set([...Object.keys(constraintErrors), ...Object.keys(unmappedConstraints)]);
    expect((await uniqueIndexNames()).filter((name) => !known.has(name))).toEqual([]);
  });

  it('are listed once, and every listed name still exists', async () => {
    for (const name of Object.keys(unmappedConstraints)) expect(constraintErrors, name).not.toHaveProperty(name);
    // A stale entry would hide a renamed constraint, whose new name is then unmapped.
    const existing = new Set(await uniqueIndexNames());
    for (const name of [...Object.keys(constraintErrors), ...Object.keys(unmappedConstraints)]) {
      expect(existing.has(name), `${name} no longer exists`).toBe(true);
    }
  });
});
