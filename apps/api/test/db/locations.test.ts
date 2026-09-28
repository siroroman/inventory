import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { locations } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation, locationTypeId } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

const moveUnder = (parentId: string) =>
  ({ parentId, locationTypeId: null }) satisfies Partial<typeof locations.$inferInsert>;

describe('locations', () => {
  const t = useTestDb();

  describe('location type', () => {
    it('is required for a top-level location', async () => {
      await expectPgError(t().app.insert(locations).values({ name: 'Bez typu' }), {
        code: PG.checkViolation,
        constraint: 'locations_type_only_top_level',
      });
    });

    it('is not allowed on a sub-location', async () => {
      const parent = await insertLocation(t().app);
      await expectPgError(
        t()
          .app.insert(locations)
          .values({ name: 'Přízemí', parentId: parent.id, locationTypeId: await locationTypeId(t().app) }),
        { code: PG.checkViolation, constraint: 'locations_type_only_top_level' },
      );
    });

    it('must be set when a sub-location becomes top-level', async () => {
      const parent = await insertLocation(t().app);
      const child = await insertLocation(t().app, { name: 'Přízemí', parentId: parent.id });
      await expectPgError(
        t().app.update(locations).set({ parentId: null }).where(eq(locations.id, child.id)),
        { code: PG.checkViolation, constraint: 'locations_type_only_top_level' },
      );
      await t()
        .app.update(locations)
        .set({ parentId: null, locationTypeId: await locationTypeId(t().app, 'WAREHOUSE') })
        .where(eq(locations.id, child.id));
    });
  });

  it('supports sub-locations nested several levels deep', async () => {
    let parent = await insertLocation(t().app, { name: 'Centrála Praha' });
    for (const name of ['Přízemí výroba', '0.19 – Teplá kuchyně', 'Regál A', 'Police 3']) {
      parent = await insertLocation(t().app, { name, parentId: parent.id });
    }
    const depth = await t().app.execute(sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 1 AS depth FROM locations WHERE id = ${parent.id}
        UNION ALL SELECT l.id, l.parent_id, up.depth + 1 FROM locations l JOIN up ON l.id = up.parent_id
      ) SELECT max(depth)::int AS depth FROM up`);
    expect(depth.rows[0]).toEqual({ depth: 5 });
  });

  it('rejects an unknown parent', async () => {
    await expectPgError(insertLocation(t().app, { parentId: randomUUID() }), {
      code: PG.foreignKeyViolation,
      constraint: 'locations_parent_id_locations_id_fk',
    });
  });

  it('rejects a blank name', async () => {
    await expectPgError(insertLocation(t().app, { name: '   ' }), {
      code: PG.checkViolation,
      constraint: 'locations_name_not_blank',
    });
  });

  describe('cycle protection', () => {
    it('rejects inserting a location as its own parent', async () => {
      const id = randomUUID();
      await expectPgError(t().app.insert(locations).values({ id, name: 'Smyčka', parentId: id }), {
        code: PG.checkViolation,
        constraint: 'locations_not_own_parent',
      });
    });

    it('rejects moving a location under itself', async () => {
      const a = await insertLocation(t().app);
      await expectPgError(
        t().app.update(locations).set(moveUnder(a.id)).where(eq(locations.id, a.id)),
        { code: PG.checkViolation, constraint: 'locations_no_cycle' },
      );
    });

    it('rejects moving a location under its child', async () => {
      const a = await insertLocation(t().app, { name: 'A' });
      const b = await insertLocation(t().app, { name: 'B', parentId: a.id });
      await expectPgError(
        t().app.update(locations).set(moveUnder(b.id)).where(eq(locations.id, a.id)),
        { code: PG.checkViolation, constraint: 'locations_no_cycle' },
      );
    });

    it('rejects moving a location under a deep descendant', async () => {
      const a = await insertLocation(t().app, { name: 'A' });
      const b = await insertLocation(t().app, { name: 'B', parentId: a.id });
      const c = await insertLocation(t().app, { name: 'C', parentId: b.id });
      const d = await insertLocation(t().app, { name: 'D', parentId: c.id });
      await expectPgError(
        t().app.update(locations).set({ parentId: d.id }).where(eq(locations.id, b.id)),
        { code: PG.checkViolation, constraint: 'locations_no_cycle' },
      );
    });

    it('allows moving a subtree under another branch', async () => {
      const a = await insertLocation(t().app, { name: 'A' });
      const b = await insertLocation(t().app, { name: 'B' });
      const child = await insertLocation(t().app, { name: 'A1', parentId: a.id });
      await insertLocation(t().app, { name: 'A1a', parentId: child.id });
      await t().app.update(locations).set({ parentId: b.id }).where(eq(locations.id, child.id));
      const [moved] = await t().app.select().from(locations).where(eq(locations.id, child.id));
      expect(moved!.parentId).toBe(b.id);
    });

    it('allows other updates without re-checking the tree', async () => {
      const a = await insertLocation(t().app);
      const b = await insertLocation(t().app, { parentId: a.id });
      await t().app.update(locations).set({ note: 'Nový popis' }).where(eq(locations.id, b.id));
    });

    it('keeps the tree acyclic when two opposite moves run concurrently', async () => {
      const a = await insertLocation(t().app, { name: 'A' });
      const b = await insertLocation(t().app, { name: 'B' });
      const first = await t().appPool.connect();
      const second = await t().appPool.connect();
      try {
        await first.query('BEGIN');
        await first.query('UPDATE locations SET parent_id = $1, location_type_id = NULL WHERE id = $2', [b.id, a.id]);

        await second.query('BEGIN');
        const { rows } = await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        const blocked = second.query('UPDATE locations SET parent_id = $1, location_type_id = NULL WHERE id = $2', [
          a.id,
          b.id,
        ]);
        blocked.catch(() => {});

        // Wait until the second move is actually waiting for the tree lock.
        for (let i = 0; i < 100; i++) {
          const waiting = await t().owner.execute(
            sql`SELECT 1 FROM pg_stat_activity WHERE pid = ${rows[0]!.pid} AND wait_event_type = 'Lock'`,
          );
          if (waiting.rows.length) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        await first.query('COMMIT');
        await expectPgError(blocked, { code: PG.checkViolation, constraint: 'locations_no_cycle' });
        await second.query('ROLLBACK');
      } finally {
        first.release();
        second.release();
      }

      const rows = await t().app.select({ id: locations.id, parentId: locations.parentId }).from(locations);
      const parentOf = Object.fromEntries(rows.map((r) => [r.id, r.parentId]));
      expect(parentOf).toEqual({ [a.id]: b.id, [b.id]: null });
    });
  });

  it('cannot be deleted while it has sub-locations or items (owner-level check)', async () => {
    const parent = await insertLocation(t().owner);
    await insertLocation(t().owner, { parentId: parent.id });
    await expectPgError(t().owner.delete(locations).where(eq(locations.id, parent.id)), {
      code: PG.foreignKeyViolation,
      constraint: 'locations_parent_id_locations_id_fk',
    });

    const withItem = await insertLocation(t().owner);
    await insertItem(t().owner, { locationId: withItem.id });
    await expectPgError(t().owner.delete(locations).where(eq(locations.id, withItem.id)), {
      code: PG.foreignKeyViolation,
      constraint: 'items_location_id_locations_id_fk',
    });
  });
});
