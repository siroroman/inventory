import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.ts';
import { migrationsFolder, runMigrations } from '../../src/db/migrate.ts';
import { createDatabase, dropDatabase, urlFor, useTestDb } from '../helpers/db.ts';

const AUDITED_TABLES = ['location_types', 'locations', 'items', 'manufacturers', 'service_providers', 'service_records'];
// Documents are versioned (rename) but deleted for real: no archived_at.
const VERSIONED_TABLES = [...AUDITED_TABLES, 'service_record_documents'];
const COMMON_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'archived_at', 'version'];
// Users are never deleted, so author references need no index for ON DELETE checks.
const UNINDEXED_FK_ALLOWLIST = new Set(['created_by', 'updated_by', 'audit_log.user_id']);

describe('migrations', () => {
  let scratch: string | undefined;
  afterEach(async () => {
    if (scratch) await dropDatabase(scratch);
    scratch = undefined;
  });

  it('apply to an empty database and are a no-op the second time', async () => {
    scratch = await createDatabase({ template: false });
    const url = urlFor(scratch, 'owner');
    await runMigrations(url);
    await runMigrations(url);

    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    const { db, pool } = createDb(url);
    const applied = await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    const tables = await db.execute(
      sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
    );
    await pool.end();
    expect(applied.rows[0]).toEqual({ n: journal.entries.length });
    expect(tables.rows[0]).toEqual({ n: 15 });
  });
});

describe('schema', () => {
  const t = useTestDb();

  it('gives every versioned table the common columns and the touch_row trigger', async () => {
    const versioned = await t().owner.execute(sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'version' ORDER BY table_name`);
    expect(versioned.rows.map((r) => r.table_name)).toEqual([...VERSIONED_TABLES].sort());

    for (const table of VERSIONED_TABLES) {
      const common = table === 'service_record_documents' ? COMMON_COLUMNS.filter((c) => c !== 'archived_at') : COMMON_COLUMNS;
      const cols = await t().owner.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}`);
      expect(cols.rows.map((r) => r.column_name), table).toEqual(expect.arrayContaining(common));

      const trigger = await t().owner.execute(sql`
        SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE tg.tgrelid = ${table}::regclass AND p.proname = 'touch_row' AND NOT tg.tgisinternal`);
      expect(trigger.rows, `${table} has touch_row`).toHaveLength(1);
    }
  });

  // Postgres silently truncates identifiers to 63 bytes, while Drizzle's snapshot keeps the full
  // name; a truncated name would break later migrations that reference it.
  it('has no constraint or index name at the 63-character truncation limit', async () => {
    const result = await t().owner.execute(sql`
      SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND length(conname) >= 63
      UNION
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND length(indexname) >= 63`);
    expect(result.rows).toEqual([]);
  });

  it('indexes every foreign key column (as the leading index column)', async () => {
    const fks = await t().owner.execute(sql`
      SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
        )
      ORDER BY 1, 2`);
    const missing = fks.rows
      .map((r) => `${String(r.table_name).replaceAll('"', '')}.${r.column_name}`)
      .filter((fk) => {
        const column = fk.split('.')[1]!;
        return !UNINDEXED_FK_ALLOWLIST.has(column) && !UNINDEXED_FK_ALLOWLIST.has(fk);
      });
    expect(missing).toEqual([]);
  });
});
