import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { items } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation, insertManufacturer } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('items', () => {
  const t = useTestDb();

  it('can exist without a location', async () => {
    const row = await insertItem(t().app, { locationId: null });
    expect(row.locationId).toBeNull();
  });

  it('reject an unknown location', async () => {
    await expectPgError(insertItem(t().app, { locationId: randomUUID() }), {
      code: PG.foreignKeyViolation,
      constraint: 'items_location_id_locations_id_fk',
    });
  });

  it('can sit in a location at any depth', async () => {
    const top = await insertLocation(t().app);
    const floor = await insertLocation(t().app, { parentId: top.id });
    const room = await insertLocation(t().app, { parentId: floor.id });
    for (const location of [top, floor, room]) await insertItem(t().app, { locationId: location.id });
  });

  it('have an optional manufacturer that must exist when set', async () => {
    await insertItem(t().app, { manufacturerId: null });
    const manufacturer = await insertManufacturer(t().app);
    await insertItem(t().app, { manufacturerId: manufacturer.id });
    await expectPgError(insertItem(t().app, { manufacturerId: randomUUID() }), {
      code: PG.foreignKeyViolation,
      constraint: 'items_manufacturer_id_manufacturers_id_fk',
    });
  });

  it('reject a blank name', async () => {
    await expectPgError(insertItem(t().app, { name: ' ' }), {
      code: PG.checkViolation,
      constraint: 'items_name_not_blank',
    });
  });

  it.each([
    [1949, false],
    [1950, true],
    [2026, true],
    [2100, true],
    [2101, false],
  ])('manufacture year %i accepted: %s', async (manufactureYear, accepted) => {
    const attempt = insertItem(t().app, { manufactureYear });
    if (accepted) await attempt;
    else await expectPgError(attempt, { code: PG.checkViolation, constraint: 'items_manufacture_year_range' });
  });

  it.each([
    [-0.01, false],
    [0, true],
    [144902.5, true],
    [9_999_999_999.99, true],
  ])('purchase price %d accepted: %s', async (purchasePrice, accepted) => {
    const attempt = insertItem(t().app, { purchasePrice });
    if (accepted) expect((await attempt).purchasePrice).toBe(purchasePrice);
    else await expectPgError(attempt, { code: PG.checkViolation, constraint: 'items_purchase_price_not_negative' });
  });

  it.each([
    'https://drive.google.com/drive/folders/1AbCdEf',
    'https://docs.google.com/document/d/1AbCdEf/edit',
    null,
  ])('accepts documents_url %s', async (documentsUrl) => {
    await insertItem(t().app, { documentsUrl });
  });

  it.each([
    'http://drive.google.com/drive/folders/1AbCdEf',
    'https://dropbox.com/folder',
    'https://drive.google.com.evil.com/drive/folders/1',
    'https://drive.google.com@evil.com/',
    'see https://drive.google.com/drive/folders/1',
    'https://sheets.google.com/x',
    'https://drive.google.com',
  ])('rejects documents_url %s', async (documentsUrl) => {
    await expectPgError(insertItem(t().app, { documentsUrl }), {
      code: PG.checkViolation,
      constraint: 'items_documents_url_google',
    });
  });

  it('round-trips dates exactly, without time zone shifts', async () => {
    const dates = {
      registeredOn: '2026-09-27',
      warrantyUntil: '2028-12-31',
      lastServiceOn: '2026-01-01',
      nextServiceOn: '2027-03-15',
    };
    const created = await insertItem(t().app, dates);
    const [row] = await t().app.select().from(items).where(eq(items.id, created.id));
    expect(row).toMatchObject(dates);
    const raw = await t().app.execute(sql`SELECT registered_on::text AS d FROM items WHERE id = ${created.id}`);
    expect(raw.rows[0]).toEqual({ d: '2026-09-27' });
  });
});
