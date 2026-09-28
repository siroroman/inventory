import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { manufacturerServiceProviders as msp } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertManufacturer, insertProvider } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('manufacturers and service providers', () => {
  const t = useTestDb();
  const rank = (manufacturerId: string, serviceProviderId: string, priority: number) =>
    t().app.insert(msp).values({ manufacturerId, serviceProviderId, priority });
  const order = async (manufacturerId: string) =>
    (
      await t()
        .app.select({ providerId: msp.serviceProviderId, priority: msp.priority })
        .from(msp)
        .where(eq(msp.manufacturerId, manufacturerId))
        .orderBy(asc(msp.priority))
    ).map((r) => r.providerId);

  it('manufacturer names are unique regardless of case', async () => {
    await insertManufacturer(t().app, { name: 'Rational' });
    await expectPgError(insertManufacturer(t().app, { name: 'RATIONAL' }), {
      code: PG.uniqueViolation,
      constraint: 'manufacturers_name_lower_key',
    });
  });

  it('a provider can service several manufacturers, each with its own priority', async () => {
    const [m1, m2] = [await insertManufacturer(t().app), await insertManufacturer(t().app)];
    const provider = await insertProvider(t().app);
    await rank(m1.id, provider.id, 1);
    await rank(m2.id, provider.id, 3);
  });

  it('the same priority can be used under different manufacturers', async () => {
    const [m1, m2] = [await insertManufacturer(t().app), await insertManufacturer(t().app)];
    await rank(m1.id, (await insertProvider(t().app)).id, 1);
    await rank(m2.id, (await insertProvider(t().app)).id, 1);
  });

  it('rejects the same provider twice for one manufacturer', async () => {
    const m = await insertManufacturer(t().app);
    const p = await insertProvider(t().app);
    await rank(m.id, p.id, 1);
    await expectPgError(rank(m.id, p.id, 2), {
      code: PG.uniqueViolation,
      constraint: 'manufacturer_service_providers_pkey',
    });
  });

  it.each([0, -1])('rejects priority %i', async (priority) => {
    const m = await insertManufacturer(t().app);
    await expectPgError(rank(m.id, (await insertProvider(t().app)).id, priority), {
      code: PG.checkViolation,
      constraint: 'manufacturer_service_providers_priority_positive',
    });
  });

  it('rejects an unknown provider', async () => {
    const m = await insertManufacturer(t().app);
    await expectPgError(rank(m.id, randomUUID(), 1), {
      code: PG.foreignKeyViolation,
      constraint: 'msp_service_provider_id_fk',
    });
  });

  it('rejects a duplicate priority when the transaction commits', async () => {
    const m = await insertManufacturer(t().app);
    const [p1, p2] = [await insertProvider(t().app), await insertProvider(t().app)];
    await expectPgError(
      t().app.transaction(async (tx) => {
        await tx.insert(msp).values({ manufacturerId: m.id, serviceProviderId: p1.id, priority: 1 });
        // Deferred: the duplicate is only detected at COMMIT.
        await tx.insert(msp).values({ manufacturerId: m.id, serviceProviderId: p2.id, priority: 1 });
      }),
      { code: PG.uniqueViolation, constraint: 'manufacturer_service_providers_manufacturer_priority_key' },
    );
    expect(await order(m.id)).toEqual([]);
  });

  it('can swap two priorities inside one transaction', async () => {
    const m = await insertManufacturer(t().app);
    const [p1, p2] = [await insertProvider(t().app), await insertProvider(t().app)];
    await rank(m.id, p1.id, 1);
    await rank(m.id, p2.id, 2);
    await t().app.transaction(async (tx) => {
      await tx.update(msp).set({ priority: 2 }).where(and(eq(msp.manufacturerId, m.id), eq(msp.serviceProviderId, p1.id)));
      await tx.update(msp).set({ priority: 1 }).where(and(eq(msp.manufacturerId, m.id), eq(msp.serviceProviderId, p2.id)));
    });
    expect(await order(m.id)).toEqual([p2.id, p1.id]);
  });

  it('can replace the whole order inside one transaction', async () => {
    const m = await insertManufacturer(t().app);
    const [p1, p2, p3] = [await insertProvider(t().app), await insertProvider(t().app), await insertProvider(t().app)];
    await rank(m.id, p1.id, 1);
    await rank(m.id, p2.id, 2);
    await t().app.transaction(async (tx) => {
      await tx.delete(msp).where(eq(msp.manufacturerId, m.id));
      await tx.insert(msp).values(
        [p3, p1, p2].map((p, i) => ({ manufacturerId: m.id, serviceProviderId: p.id, priority: i + 1 })),
      );
    });
    expect(await order(m.id)).toEqual([p3.id, p1.id, p2.id]);
  });
});
