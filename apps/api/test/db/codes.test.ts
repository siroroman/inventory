import { describe, expect, it } from 'vitest';
import { locations } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation, insertProvider, locationTypeId } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('human-readable codes', () => {
  const t = useTestDb();

  it('are generated in sequence per entity', async () => {
    const a = await insertLocation(t().app, { name: 'A' });
    const b = await insertLocation(t().app, { name: 'B' });
    const item = await insertItem(t().app, { locationId: a.id });
    const provider = await insertProvider(t().app);
    expect([a.code, b.code, item.code, provider.code]).toEqual(['LOC-001', 'LOC-002', 'INV-00001', 'SUP-001']);
  });

  it('can be supplied explicitly, e.g. when importing existing numbers', async () => {
    const row = await insertLocation(t().app, { code: 'LOC-900' });
    expect(row.code).toBe('LOC-900');
  });

  it('must be unique', async () => {
    await insertLocation(t().app, { code: 'LOC-900' });
    await expectPgError(insertLocation(t().app, { code: 'LOC-900' }), {
      code: PG.uniqueViolation,
      constraint: 'locations_code_key',
    });
  });

  it('may have gaps after a rolled-back insert (expected, never back-filled)', async () => {
    const typeId = await locationTypeId(t().app);
    await t()
      .app.transaction(async (tx) => {
        await tx.insert(locations).values({ name: 'Rolled back', locationTypeId: typeId });
        tx.rollback();
      })
      .catch(() => {});
    const row = await insertLocation(t().app);
    expect(row.code).toBe('LOC-002');
  });
});
