import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.ts';
import { locationTypes } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import {
  insertItem,
  insertLocation,
  insertManufacturer,
  insertProvider,
  insertServiceRecord,
} from '../helpers/factories.ts';

type Row = { id: string };
const TABLES: [string, (db: Db) => Promise<Row>][] = [
  [
    'location_types',
    async (db) => (await db.insert(locationTypes).values({ code: 'OFFICE', name: 'Kancelář' }).returning())[0]!,
  ],
  ['locations', (db) => insertLocation(db)],
  ['items', (db) => insertItem(db)],
  ['manufacturers', (db) => insertManufacturer(db)],
  ['service_providers', (db) => insertProvider(db)],
  ['service_records', (db) => insertServiceRecord(db)],
];

type Meta = { version: number; created: bigint; updated: bigint; archived: boolean };

describe.each(TABLES)('common columns on %s', (table, insert) => {
  const t = useTestDb();
  const meta = async (id: string): Promise<Meta> => {
    const result = await t().app.execute(sql`
      SELECT version,
        (extract(epoch FROM created_at) * 1000000)::bigint::text AS created,
        (extract(epoch FROM updated_at) * 1000000)::bigint::text AS updated,
        archived_at IS NOT NULL AS archived
      FROM ${sql.identifier(table)} WHERE id = ${id}`);
    const row = result.rows[0] as { version: number; created: string; updated: string; archived: boolean };
    return { ...row, created: BigInt(row.created), updated: BigInt(row.updated) };
  };
  const update = (id: string, set: ReturnType<typeof sql>, where = sql`true`) =>
    t().app.execute(sql`UPDATE ${sql.identifier(table)} SET ${set} WHERE id = ${id} AND ${where}`);

  it('start at version 1, unarchived, with created_at = updated_at', async () => {
    const row = await insert(t().app);
    const m = await meta(row.id);
    expect(m.version).toBe(1);
    expect(m.archived).toBe(false);
    expect(m.updated).toBe(m.created);
  });

  it('bump version and updated_at on every update', async () => {
    const row = await insert(t().app);
    const before = await meta(row.id);
    await update(row.id, sql`updated_by = NULL`);
    await update(row.id, sql`updated_by = NULL`);
    const after = await meta(row.id);
    expect(after.version).toBe(3);
    expect(after.updated > before.updated).toBe(true);
    expect(after.created).toBe(before.created);
  });

  it('ignore a version set by the caller', async () => {
    const row = await insert(t().app);
    await update(row.id, sql`version = 99`);
    expect((await meta(row.id)).version).toBe(2);
  });

  it('make a stale-version update affect no rows (optimistic locking)', async () => {
    const row = await insert(t().app);
    await update(row.id, sql`updated_by = NULL`, sql`version = 1`);
    const stale = await update(row.id, sql`updated_by = NULL`, sql`version = 1`);
    expect(stale.rowCount).toBe(0);
    expect((await meta(row.id)).version).toBe(2);
  });

  it('archive and restore by setting archived_at, bumping the version each time', async () => {
    const row = await insert(t().app);
    await update(row.id, sql`archived_at = now()`);
    expect((await meta(row.id)).archived).toBe(true);
    await update(row.id, sql`archived_at = NULL`);
    const restored = await meta(row.id);
    expect(restored.archived).toBe(false);
    expect(restored.version).toBe(3);
  });
});
