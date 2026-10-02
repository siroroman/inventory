import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers/db.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

const READ_WRITE = ['INSERT', 'SELECT', 'UPDATE'];
const READ_WRITE_DELETE = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];

// Every table in public must appear here. Records are archived, never deleted; child rows, auth
// sessions and verification tokens may be deleted; the audit log is insert-only.
const EXPECTED_GRANTS: Record<string, string[]> = {
  account: READ_WRITE_DELETE,
  audit_log: ['INSERT', 'SELECT'],
  item_external_ids: READ_WRITE_DELETE,
  item_photos: READ_WRITE_DELETE,
  items: READ_WRITE,
  location_types: READ_WRITE,
  locations: READ_WRITE,
  manufacturer_service_providers: READ_WRITE_DELETE,
  manufacturers: READ_WRITE,
  service_providers: READ_WRITE,
  service_record_documents: READ_WRITE_DELETE,
  service_records: READ_WRITE,
  session: READ_WRITE_DELETE,
  user: READ_WRITE,
  verification: READ_WRITE_DELETE,
};

const NO_DELETE_TABLES = Object.entries(EXPECTED_GRANTS)
  .filter(([, grants]) => !grants.includes('DELETE'))
  .map(([table]) => table);
const DELETE_TABLES = Object.entries(EXPECTED_GRANTS)
  .filter(([, grants]) => grants.includes('DELETE'))
  .map(([table]) => table);

describe('app_runtime privileges', () => {
  const t = useTestDb();

  it('match the expected grant matrix for every table', async () => {
    const result = await t().owner.execute(sql`
      SELECT tablename,
        array_remove(ARRAY[
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'DELETE') THEN 'DELETE' END,
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'INSERT') THEN 'INSERT' END,
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'REFERENCES') THEN 'REFERENCES' END,
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'SELECT') THEN 'SELECT' END,
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'TRIGGER') THEN 'TRIGGER' END,
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'TRUNCATE') THEN 'TRUNCATE' END,
          CASE WHEN has_table_privilege('app_runtime', format('public.%I', tablename), 'UPDATE') THEN 'UPDATE' END
        ], NULL) AS grants
      FROM pg_tables WHERE schemaname = 'public'`);
    const actual = Object.fromEntries(result.rows.map((r) => [r.tablename, r.grants]));
    expect(actual).toEqual(EXPECTED_GRANTS);
  });

  it('can use the code sequences', async () => {
    const result = await t().owner.execute(sql`
      SELECT c.relname, has_sequence_privilege('app_runtime', c.oid, 'USAGE') AS usage
      FROM pg_class c WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
      ORDER BY c.relname`);
    expect(result.rows).toEqual([
      { relname: 'audit_log_id_seq', usage: true },
      { relname: 'item_code_seq', usage: true },
      { relname: 'location_code_seq', usage: true },
      { relname: 'service_provider_code_seq', usage: true },
    ]);
  });

  it.each(NO_DELETE_TABLES)('cannot hard-delete from %s', async (table) => {
    await expectPgError(t().app.execute(sql`DELETE FROM ${sql.identifier(table)}`), {
      code: PG.insufficientPrivilege,
    });
  });

  it.each(DELETE_TABLES)('can delete from %s', async (table) => {
    await t().app.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE false`);
  });

  it('cannot rewrite the audit log', async () => {
    await expectPgError(t().app.execute(sql`UPDATE audit_log SET action = 'update'`), {
      code: PG.insufficientPrivilege,
    });
  });

  it.each([
    ['create a table', sql`CREATE TABLE evil (id int)`],
    ['drop a table', sql`DROP TABLE items`],
    ['truncate a table', sql`TRUNCATE items`],
    ['alter a table', sql`ALTER TABLE items ADD COLUMN evil text`],
    ['disable triggers', sql`ALTER TABLE audit_log DISABLE TRIGGER ALL`],
  ])('cannot %s', async (_, statement) => {
    await expectPgError(t().app.execute(statement), { code: PG.insufficientPrivilege });
  });
});
