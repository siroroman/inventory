import { describe, expect, it } from 'vitest';
import {
  AlreadyAppliedError,
  type AccountingRow,
  type Decisions,
  type PlanItem,
  type PlanLocation,
  parseAccountingCsv,
  planAccountingUpdate,
  resolveCentre,
} from '../../../src/db/update/plan.ts';

const HEADER = 'sheet,table,centre,inv_number,registered_on,name,price,price_increased';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

describe('parseAccountingCsv', () => {
  it('reads a row, collapsing the name and keying it by centre and number', () => {
    expect(parseAccountingCsv(csv('73,DrM,73,1552,2025-02-03,"Tiskárna  cenovek ",15340,'))).toEqual([
      {
        sheet: '73',
        table: 'DrM',
        centre: '73',
        inventoryNumber: '1552',
        key: '73-1552',
        registeredOn: '2025-02-03',
        name: 'Tiskárna cenovek',
        purchasePrice: 15340,
      },
    ]);
  });

  it('prefers the increased price when the workbook has one', () => {
    const [row] = parseAccountingCsv(csv('71,DLHM,71,2020021,2020-05-01,Vectron,177380.99,402782.64'));
    expect(row?.purchasePrice).toBe(402782.64);
  });

  it('puts centre 0 in the centre of its sheet', () => {
    expect(resolveCentre('TJ 50', '0')).toBe('50');
    expect(resolveCentre('56+59', '59')).toBe('59');
    expect(() => resolveCentre('56+59', '0')).toThrow('centre 0');
    expect(parseAccountingCsv(csv('TJ 50,DLHM,0,1,2011-07-13,Interiér,283780,'))[0]?.key).toBe('50-1');
  });

  it.each([
    ['a repeated key', csv('1,DrM,1,5,2025-01-01,A,1,', '1,DrM,1,5,2025-01-02,B,1,'), 'listed twice'],
    ['a bad date', csv('1,DrM,1,5,1.1.2025,A,1,'), 'date'],
    ['a negative price', csv('1,DrM,1,5,2025-01-01,A,-1,'), 'price'],
    ['a slash in the number', csv('1,DrM,1,5/6,2025-01-01,A,1,'), 'inventory number'],
    ['an unknown table', csv('1,XX,1,5,2025-01-01,A,1,'), 'unknown table'],
  ])('refuses %s', (_, text, message) => {
    expect(() => parseAccountingCsv(text)).toThrow(message);
  });
});

// ------------------------------------------------------------------ the planner

const locations: PlanLocation[] = [
  { id: 'l50', code: 'LOC-50', name: 'Anděl' },
  { id: 'l54', code: 'LOC-54', name: 'Hl. nádraží' },
  { id: 'l65', code: 'LOC-65', name: 'Pol. Budějovická' },
];

const row = (over: Partial<AccountingRow> & { key: string }): AccountingRow => {
  const [centre, inventoryNumber] = over.key.split('-') as [string, string];
  return {
    sheet: centre,
    table: 'DrM',
    centre,
    inventoryNumber,
    registeredOn: '2025-01-01',
    name: 'Položka',
    purchasePrice: 100,
    ...over,
  };
};

let seq = 0;
const item = (over: Partial<PlanItem> & { code: string }): PlanItem => ({
  id: `id-${++seq}`,
  name: 'Položka',
  locationId: 'l50',
  registeredOn: null,
  purchasePrice: null,
  note: null,
  version: 1,
  externalIds: [],
  ...over,
});

const decisions: Decisions = { asOf: '2026-07-31', newLocations: {}, merge: {}, skip: {} };
const plan = (rows: AccountingRow[], items: PlanItem[], d: Partial<Decisions> = {}) =>
  planAccountingUpdate({ rows, locations, items, decisions: { ...decisions, ...d } });

describe('planAccountingUpdate', () => {
  it('matches an item by the accounting number in its old code and keeps its fields when they agree', () => {
    const existing = item({ code: 'INV-50-1552', name: 'Tiskárna', registeredOn: '2025-02-03', purchasePrice: 100 });
    const p = plan([row({ key: '50-1552', name: 'Tiskárna', registeredOn: '2025-02-03' })], [existing]);
    expect(p.creates).toEqual([]);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]).toMatchObject({ kind: 'matched', key: '50-1552', oldCode: 'INV-50-1552', newCode: 'INV-0001', fields: {} });
    expect(p.updates[0]?.externalIds).toEqual([
      { source: 'Účetnictví', value: '50-1552' },
      { source: 'Původní kód', value: 'INV-50-1552' },
    ]);
  });

  it('matches by the external ID Účetnictví first, and keeps the other external IDs', () => {
    const existing = item({
      code: 'INV-00007',
      externalIds: [
        { source: 'Revize ILKO', value: 'S 1' },
        { source: 'Účetnictví', value: '50-9' },
      ],
    });
    const p = plan([row({ key: '50-9', name: 'Položka' })], [existing]);
    expect(p.updates[0]?.kind).toBe('matched');
    expect(p.updates[0]?.externalIds.map((e) => e.source).sort()).toEqual(['Původní kód', 'Revize ILKO', 'Účetnictví']);
  });

  it('fills a missing date, drops the unknown-date note line and sets the price the workbook states', () => {
    const existing = item({
      code: 'INV-50-1',
      registeredOn: null,
      purchasePrice: 177380.99,
      note: 'Pořízeno v roce 2019 (přesné datum neznámé)\nZdroj dat: DlouhHM',
    });
    const p = plan([row({ key: '50-1', registeredOn: '2019-08-27', purchasePrice: 402782.64 })], [existing]);
    expect(p.updates[0]?.fields).toEqual({ registeredOn: '2019-08-27', purchasePrice: 402782.64, note: 'Zdroj dat: DlouhHM' });
    expect(p.updates[0]?.changes).toMatchObject({
      code: { from: 'INV-50-1', to: 'INV-0001' },
      registeredOn: { from: null, to: '2019-08-27' },
      purchasePrice: { from: 177380.99, to: 402782.64 },
    });
  });

  it('keeps the name and notes the accounting name when it differs in substance, not in spacing', () => {
    const cosmetic = item({ code: 'INV-50-1', name: 'Logo oválné prosvětlené', registeredOn: '2025-01-01', purchasePrice: 100 });
    const real = item({ code: 'INV-50-2', name: 'Kávovar', registeredOn: '2025-01-01', purchasePrice: 100 });
    const p = plan(
      [row({ key: '50-1', name: 'Logo oválné prosvětlené' }), row({ key: '50-2', name: 'Kávovar WMF 1500S' })],
      [cosmetic, real],
    );
    expect(p.updates.find((u) => u.oldCode === 'INV-50-1')?.fields).toEqual({});
    expect(p.updates.find((u) => u.oldCode === 'INV-50-2')?.fields).toEqual({ note: 'Název v účetnictví: Kávovar WMF 1500S' });
  });

  it('leaves a date that disagrees alone and reports it', () => {
    const existing = item({ code: 'INV-50-1', registeredOn: '2020-01-01', purchasePrice: 100 });
    const p = plan([row({ key: '50-1', registeredOn: '2021-01-01' })], [existing]);
    expect(p.updates[0]?.fields).toEqual({});
    expect(p.updates[0]?.conflicts).toEqual(['registered 2020-01-01, workbook 2021-01-01']);
  });

  it('changes no field of an item a person edited since the import, only its code and external IDs', () => {
    const edited = item({ code: 'INV-50-1', version: 3, registeredOn: null, purchasePrice: 5, name: 'Moje jméno' });
    const p = plan([row({ key: '50-1', name: 'Jiné jméno' })], [edited]);
    expect(p.updates[0]).toMatchObject({ touched: true, fields: {}, newCode: 'INV-0001' });
    expect(p.updates[0]?.externalIdsChanged).toBe(true);
  });

  it('moves an item the workbook lists under another centre when number, name and price agree', () => {
    const existing = item({
      code: 'INV-54-2025030',
      name: 'Prodejní automat WallKiosk 32"',
      locationId: 'l54',
      registeredOn: '2025-06-27',
      purchasePrice: 225730,
      note: 'Zdroj dat: DlouhHM',
    });
    const p = plan(
      [row({ key: '65-2025030', name: 'Prodejní automat WallKiosk 32"', registeredOn: '2025-06-27', purchasePrice: 225730 })],
      [existing],
    );
    expect(p.creates).toEqual([]);
    expect(p.notInWorkbook).toEqual([]);
    expect(p.updates[0]).toMatchObject({ kind: 'moved', key: '65-2025030' });
    expect(p.updates[0]?.fields).toEqual({
      locationId: 'l65',
      note: 'Zdroj dat: DlouhHM\nStředisko v účetnictví změněno z 54 na 65 (stav k 31. 7. 2026).',
    });
    expect(p.updates[0]?.externalIds).toContainEqual({ source: 'Účetnictví', value: '65-2025030' });
    expect(p.updates[0]?.externalIds).not.toContainEqual({ source: 'Účetnictví', value: '54-2025030' });
  });

  it('reports an accounting item the workbook no longer lists', () => {
    const p = plan([], [item({ code: 'INV-50-77', name: 'Zmizelo' })]);
    expect(p.notInWorkbook).toEqual([{ code: 'INV-50-77', name: 'Zmizelo' }]);
    expect(p.updates[0]?.kind).toBe('not-in-workbook');
  });

  it('merges a new row into the electrician-only item of the same centre when the name is the same and unique', () => {
    const ilko = item({ code: 'INV-00010', name: 'Mikrovlnná trouba', externalIds: [{ source: 'Revize ILKO', value: 'S 9' }] });
    const p = plan([row({ key: '50-1862', name: 'Mikrovlnná  trouba', purchasePrice: 2500, registeredOn: '2025-11-02' })], [ilko]);
    expect(p.creates).toEqual([]);
    expect(p.updates[0]).toMatchObject({ kind: 'merged', key: '50-1862' });
    expect(p.updates[0]?.fields).toEqual({
      registeredOn: '2025-11-02',
      purchasePrice: 2500,
      note: 'Typ majetku: Drobný majetek',
    });
    expect(p.updates[0]?.externalIds).toContainEqual({ source: 'Revize ILKO', value: 'S 9' });
  });

  it('does not merge when the name is ambiguous, and lists the candidates for review instead', () => {
    const a = item({ code: 'INV-00010', name: 'Mikrovlnná trouba' });
    const b = item({ code: 'INV-00011', name: 'Mikrovlnná trouba' });
    const p = plan([row({ key: '50-1862', name: 'Mikrovlnná trouba' })], [a, b]);
    expect(p.updates.map((u) => u.kind)).toEqual(['electrician-only', 'electrician-only']);
    expect(p.creates).toHaveLength(1);
    expect(p.review).toEqual([
      {
        key: '50-1862',
        name: 'Mikrovlnná trouba',
        centre: '50',
        candidates: [
          { code: 'INV-00010', name: 'Mikrovlnná trouba', score: 1 },
          { code: 'INV-00011', name: 'Mikrovlnná trouba', score: 1 },
        ],
      },
    ]);
  });

  it('does not merge across centres', () => {
    const elsewhere = item({ code: 'INV-00010', name: 'Mikrovlnná trouba', locationId: 'l54' });
    const p = plan([row({ key: '50-1862', name: 'Mikrovlnná trouba' })], [elsewhere]);
    expect(p.creates).toHaveLength(1);
    expect(p.review).toEqual([]);
  });

  it('merges what the decisions say, and refuses a decision that does not fit', () => {
    const ilko = item({ code: 'INV-00010', name: 'Chladící vitrína' });
    const rows = [row({ key: '50-5', name: 'Chladicí vitrína Maranko View 1500' })];
    const p = plan(rows, [ilko], { merge: { '50-5': 'INV-00010' } });
    expect(p.updates[0]).toMatchObject({ kind: 'merged', key: '50-5' });
    expect(p.creates).toEqual([]);
    expect(() => plan(rows, [ilko], { merge: { '50-5': 'INV-99999' } })).toThrow('not an electrician-only item');
    expect(() => plan(rows, [ilko], { merge: { '50-6': 'INV-00010' } })).toThrow('not a new row');
    expect(() => plan(rows, [{ ...ilko, version: 2 }], { merge: { '50-5': 'INV-00010' } })).toThrow('edited since');
  });

  it('creates new rows with a note of where they came from, and leaves skipped rows out', () => {
    const rows = [
      row({ key: '50-1', name: 'Nový stůl', table: 'DLHM', sheet: 'TJ 50', registeredOn: '2026-05-27', purchasePrice: 1404.96 }),
      row({ key: '50-1869', name: 'Ledovač' }),
    ];
    const p = plan(rows, [], { skip: { '50-1869': 'duplicate of 76-1885' } });
    expect(p.skipped).toEqual([{ key: '50-1869', name: 'Ledovač', reason: 'duplicate of 76-1885' }]);
    expect(p.creates).toEqual([
      {
        newCode: 'INV-0001',
        key: '50-1',
        sheet: 'TJ 50',
        table: 'DLHM',
        centre: '50',
        locationCode: 'LOC-50',
        name: 'Nový stůl',
        registeredOn: '2026-05-27',
        purchasePrice: 1404.96,
        note: 'Zdroj: účetní evidence k 31. 7. 2026\nTyp majetku: DLHM\nList evidence: TJ 50',
        externalIds: [{ source: 'Účetnictví', value: '50-1' }],
      },
    ]);
    expect(() => plan(rows, [], { skip: { '99-1': 'x' } })).toThrow('not in the workbook');
  });

  it('wants a decision for a centre without a location, and plans the new location', () => {
    const rows = [row({ key: '59-1', name: 'iPhone' })];
    expect(() => plan(rows, [])).toThrow('centre 59 has no location LOC-59');
    const p = plan(rows, [], { newLocations: { '59': { name: 'Vedení', type: 'STORE' } } });
    expect(p.newLocations).toEqual([{ code: 'LOC-59', centre: '59', name: 'Vedení', type: 'STORE' }]);
    expect(p.creates[0]?.locationCode).toBe('LOC-59');
  });

  it('numbers by date of registration, undated items last, and keeps one number per item', () => {
    const ilko = item({ code: 'INV-00005', name: 'Bez data' });
    const old = item({ code: 'INV-50-3', name: 'Starší', registeredOn: '2020-01-01', purchasePrice: 100 });
    const rows = [
      row({ key: '50-3', name: 'Starší', registeredOn: '2020-01-01' }),
      row({ key: '50-8', name: 'Novější', registeredOn: '2024-06-01' }),
      row({ key: '50-4', name: 'Stejný den, nižší číslo', registeredOn: '2024-06-01' }),
    ];
    const p = plan(rows, [ilko, old]);
    const byCode = Object.fromEntries([
      ...p.updates.map((u) => [u.newCode, u.oldCode]),
      ...p.creates.map((c) => [c.newCode, c.key]),
    ]);
    expect(byCode).toEqual({ 'INV-0001': 'INV-50-3', 'INV-0002': '50-4', 'INV-0003': '50-8', 'INV-0004': 'INV-00005' });
    expect(p.lastNumber).toBe(4);
  });

  it('is deterministic and refuses to run twice', () => {
    const items = [item({ code: 'INV-50-1' }), item({ code: 'INV-00002' })];
    const rows = [row({ key: '50-1' }), row({ key: '50-2', name: 'Nová' })];
    expect(plan(rows, items).fingerprint).toBe(plan(rows, items).fingerprint);
    const applied = items.map((i) => ({ ...i, externalIds: [{ source: 'Původní kód', value: i.code }] }));
    expect(() => plan(rows, applied)).toThrow(AlreadyAppliedError);
  });
});
