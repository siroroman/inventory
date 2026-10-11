import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PlanChangedError, runAccountingUpdate } from '../../../src/db/update/accounting-update.ts';
import { AlreadyAppliedError, type Decisions } from '../../../src/db/update/plan.ts';
import { auditLog, itemExternalIds, items, locations } from '../../../src/db/schema/index.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertLocation, insertUser } from '../../helpers/factories.ts';

// Made-up rows in the shape of the real workbook, which holds company data and stays out of git.
const HEADER = 'sheet,table,centre,inv_number,registered_on,name,price,price_increased';
const workbook = [
  HEADER,
  '50,DLHM,50,2019047,2019-08-27,Výrobník tříště GBG SPIN,100000,',
  '54,DrM,65,2025030,2025-06-27,"Prodejní automat WallKiosk 32""",225730,',
  '50,DrM,50,1862,2025-11-02,Mikrovlnná trouba,2500,',
  '50,DrM,50,1901,2026-02-01,Nový stůl,4000,',
  '56+59,DrM,59,1048,2024-03-01,Telefon Samsung,9000,',
  '50,DrM,50,1869,2026-05-27,Ledovač,1404.96,',
].join('\n');

const decisions: Decisions = {
  asOf: '2026-07-31',
  newLocations: { '59': { name: 'Vedení', type: 'STORE' } },
  merge: {},
  skip: { '50-1869': 'duplicate of 76-1885' },
};

describe('accounting update', () => {
  const t = useTestDb();

  async function setup() {
    const db = t().app;
    const admin = await insertUser(db, { email: 'admin@example.test' });
    const l50 = await insertLocation(db, { code: 'LOC-50', name: 'Anděl' });
    const l54 = await insertLocation(db, { code: 'LOC-54', name: 'Hl. nádraží' });
    const l65 = await insertLocation(db, { code: 'LOC-65', name: 'Pol. Budějovická' });
    const matched = await insertItem(db, {
      code: 'INV-50-2019047',
      name: 'Výrobník tříště',
      locationId: l50.id,
      registeredOn: null,
      purchasePrice: 90000,
      note: 'Pořízeno v roce 2019 (přesné datum neznámé)\nZdroj dat: DlouhHM',
    });
    const moved = await insertItem(db, {
      code: 'INV-54-2025030',
      name: 'Prodejní automat WallKiosk 32"',
      locationId: l54.id,
      registeredOn: '2025-06-27',
      purchasePrice: 225730,
    });
    const electrician = await insertItem(db, { code: 'INV-00001', name: 'Mikrovlnná trouba', locationId: l50.id });
    const other = await insertItem(db, { code: 'INV-00002', name: 'Žehlička', locationId: l50.id });
    await db.insert(itemExternalIds).values({ itemId: electrician.id, source: 'Revize ILKO', value: 'S 9' });
    return { admin, l50, l54, l65, matched, moved, electrician, other };
  }

  const run = (db: ReturnType<typeof t>['app'], over: Partial<Parameters<typeof runAccountingUpdate>[1]> = {}) =>
    runAccountingUpdate(db, { rowsCsv: workbook, decisions, apply: false, actorEmail: 'admin@example.test', ...over });

  const snapshot = async () =>
    (await t().owner.select({ id: items.id, code: items.code, version: items.version }).from(items).orderBy(asc(items.id)));

  it('plans without writing anything', async () => {
    await setup();
    const before = await snapshot();
    const { plan, applied } = await run(t().app);
    expect(applied).toBe(false);
    expect(plan.lastNumber).toBe(6);
    expect(await snapshot()).toEqual(before);
    expect(await t().owner.select().from(auditLog)).toEqual([]);
  });

  it('numbers every item by date, keeps the old code and the accounting number, and fills what the workbook knows', async () => {
    const s = await setup();
    const { plan } = await run(t().owner);
    const applied = await run(t().owner, { apply: true, expect: plan.fingerprint });
    expect(applied.applied).toBe(true);

    const rows = await t()
      .owner.select({ id: items.id, code: items.code, name: items.name, locationId: items.locationId, registeredOn: items.registeredOn, purchasePrice: items.purchasePrice, note: items.note })
      .from(items)
      .orderBy(asc(items.code));
    expect(rows.map((r) => r.code)).toEqual(['INV-0001', 'INV-0002', 'INV-0003', 'INV-0004', 'INV-0005', 'INV-0006']);

    const byId = new Map(rows.map((r) => [r.id, r]));
    // 2019-08-27 is the oldest date, so the matched item is first; its date and price came from the workbook.
    expect(byId.get(s.matched.id)).toMatchObject({
      code: 'INV-0001',
      registeredOn: '2019-08-27',
      purchasePrice: 100000,
      note: 'Zdroj dat: DlouhHM\nNázev v účetnictví: Výrobník tříště GBG SPIN',
    });
    // The undated ones come last, in the order of their old codes.
    expect(byId.get(s.other.id)?.code).toBe('INV-0006');
    // The moved item sits in LOC-65 now.
    expect(byId.get(s.moved.id)).toMatchObject({ locationId: s.l65.id });
    expect(byId.get(s.moved.id)?.note).toBe('Středisko v účetnictví změněno z 54 na 65 (stav k 31. 7. 2026).');
    // The electrician's microwave is the workbook's microwave.
    expect(byId.get(s.electrician.id)).toMatchObject({ registeredOn: '2025-11-02', purchasePrice: 2500, note: 'Typ majetku: Drobný majetek' });
  });

  it('keeps each old code and accounting number as an external ID, searchable by either', async () => {
    const s = await setup();
    await run(t().owner, { apply: true });
    const ids = await t()
      .owner.select({ itemId: itemExternalIds.itemId, source: itemExternalIds.source, value: itemExternalIds.value })
      .from(itemExternalIds)
      .where(eq(itemExternalIds.itemId, s.electrician.id))
      .orderBy(asc(itemExternalIds.source));
    expect(ids.map((i) => `${i.source}: ${i.value}`)).toEqual([
      'Původní kód: INV-00001',
      'Revize ILKO: S 9',
      'Účetnictví: 50-1862',
    ]);
    const all = await t().owner.select({ source: itemExternalIds.source }).from(itemExternalIds);
    expect(all.filter((i) => i.source === 'Původní kód')).toHaveLength(4);
    expect(all.filter((i) => i.source === 'Účetnictví')).toHaveLength(5);
  });

  it('creates the items and the location the database lacks, leaves skipped rows out, and audits it all', async () => {
    const s = await setup();
    await run(t().owner, { apply: true });
    const created = await t().owner.select().from(items).where(eq(items.name, 'Telefon Samsung'));
    const [centre59] = await t().owner.select().from(locations).where(eq(locations.code, 'LOC-59'));
    expect(centre59).toMatchObject({ name: 'Vedení', parentId: null });
    expect(created[0]).toMatchObject({ locationId: centre59?.id, registeredOn: '2024-03-01', purchasePrice: 9000, createdBy: s.admin.id });
    expect(created[0]?.note).toBe('Zdroj: účetní evidence k 31. 7. 2026\nTyp majetku: Drobný majetek\nList evidence: 56+59');
    expect(await t().owner.select().from(items).where(eq(items.name, 'Ledovač'))).toEqual([]);

    const audit = await t().owner.select().from(auditLog);
    expect(audit.filter((a) => a.entityType === 'item' && a.action === 'update')).toHaveLength(4);
    expect(audit.filter((a) => a.entityType === 'item' && a.action === 'create')).toHaveLength(2);
    expect(audit.filter((a) => a.entityType === 'location')).toHaveLength(1);
    const matchedAudit = audit.find((a) => a.entityId === s.matched.id);
    expect(matchedAudit).toMatchObject({ userId: s.admin.id, action: 'update' });
    expect(matchedAudit?.changes).toMatchObject({ code: { from: 'INV-50-2019047', to: 'INV-0001' } });
  });

  it('continues the numbering after the last number', async () => {
    await setup();
    await run(t().owner, { apply: true });
    const next = await insertItem(t().app, { name: 'Po aktualizaci' });
    expect(next.code).toBe('INV-0007');
  });

  it('writes nothing when the plan differs from the reviewed one', async () => {
    await setup();
    const before = await snapshot();
    await expect(run(t().owner, { apply: true, expect: 'not-the-fingerprint' })).rejects.toBeInstanceOf(PlanChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it('writes nothing when it cannot finish (the app role does not own the code sequence)', async () => {
    await setup();
    const before = await snapshot();
    await expect(run(t().app, { apply: true })).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(await t().owner.select().from(auditLog)).toEqual([]);
    expect(await t().owner.select().from(locations).where(eq(locations.code, 'LOC-59'))).toEqual([]);
  });

  it('refuses to run a second time', async () => {
    await setup();
    await run(t().owner, { apply: true });
    await expect(run(t().owner)).rejects.toBeInstanceOf(AlreadyAppliedError);
  });

  it('needs the actor to exist', async () => {
    await setup();
    await expect(run(t().owner, { actorEmail: 'nikdo@example.test' })).rejects.toThrow('No user nikdo@example.test');
  });
});
