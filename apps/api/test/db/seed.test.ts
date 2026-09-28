import { verifyPassword } from 'better-auth/crypto';
import { and, count, eq, gte, isNotNull, lt, lte } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { account, items, user } from '../../src/db/schema/index.ts';
import { seedItems, seedLocations } from '../../src/db/seed/data.ts';
import { seed, SeedRefusedError } from '../../src/db/seed/seed.ts';
import { createItemRepository } from '../../src/modules/items/repository.ts';
import { createLocationRepository } from '../../src/modules/locations/repository.ts';
import { createManufacturerRepository } from '../../src/modules/manufacturers/repository.ts';
import { useTestDb } from '../helpers/db.ts';

const TODAY = '2026-09-28';
const options = { password: 'seed-test-password', today: TODAY };

describe('dev seed', () => {
  const t = useTestDb();

  it('fills an empty database through the app role', async () => {
    const summary = await seed(t().app, options);
    expect(summary).toEqual({
      users: 3,
      locations: 17,
      manufacturers: 8,
      serviceProviders: 5,
      items: seedItems.length,
      externalIds: seedItems.reduce((sum, i) => sum + (i.externalIds?.length ?? 0), 0),
    });
    const top = await createLocationRepository(t().app).list({ parentId: null }, { limit: 50 });
    expect(top.items.map((l) => [l.name, l.type?.code])).toEqual(
      seedLocations.map((l) => [l.name, l.type]).sort(([a], [b]) => a!.localeCompare(b!, 'cs')),
    );
  });

  it('creates one user per role who can sign in with the seed password', async () => {
    await seed(t().app, options);
    const users = await t()
      .app.select({ email: user.email, role: user.role, hash: account.password })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
      .orderBy(user.email);
    expect(users.map((u) => [u.email, u.role])).toEqual([
      ['admin@example.test', 'admin'],
      ['read@example.test', 'read'],
      ['write@example.test', 'write'],
    ]);
    for (const u of users) {
      expect(await verifyPassword({ hash: u.hash!, password: options.password })).toBe(true);
      expect(await verifyPassword({ hash: u.hash!, password: 'wrong' })).toBe(false);
    }
  });

  it('includes every service and warranty badge case', async () => {
    await seed(t().app, options);
    const n = async (condition: ReturnType<typeof and>) => (await t().app.select({ n: count() }).from(items).where(condition))[0]!.n;
    const in30Days = '2026-10-28';
    expect(await n(lt(items.nextServiceOn, TODAY))).toBeGreaterThan(0); // overdue
    expect(await n(and(gte(items.nextServiceOn, TODAY), lte(items.nextServiceOn, in30Days)))).toBeGreaterThan(0);
    expect(await n(lt(items.warrantyUntil, TODAY))).toBeGreaterThan(0); // expired warranty
    expect(await n(isNotNull(items.documentsUrl))).toBeGreaterThan(0);
  });

  it('is searchable by external ID and has a manufacturer without providers', async () => {
    await seed(t().app, options);
    const found = await createItemRepository(t().app).list({ q: 'el-4821' }, { limit: 50 });
    expect(found.items.map((i) => i.name)).toEqual(['Konvektomat 10 GN']);
    const karcher = await createManufacturerRepository(t().app).findByName('Kärcher');
    expect(await createManufacturerRepository(t().app).listProviders(karcher!.id)).toEqual([]);
  });

  it('refuses to run on a database that already has data', async () => {
    await seed(t().app, options);
    await expect(seed(t().app, options)).rejects.toBeInstanceOf(SeedRefusedError);
    expect((await t().app.select({ n: count() }).from(user))[0]!.n).toBe(3);
  });
});
