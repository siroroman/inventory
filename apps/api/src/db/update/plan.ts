// Plans bringing the database in line with the accounting workbook (DLHM and small assets by cost
// centre) and numbering every item INV-0001, INV-0002... The planner only computes: it reads rows
// and a snapshot of the database and returns what to write, so it is tested without a database and
// can run as a dry run against production. `accounting-update.ts` loads the snapshot and applies it.

import { createHash } from 'node:crypto';
import { ACCOUNTING_SOURCE, accountingId, ORIGINAL_CODE_SOURCE } from '../accounting.ts';
import { csvRecords } from '../import/csv.ts';

// ---------------------------------------------------------------- workbook rows

export type AssetTable = 'DLHM' | 'DrM';

/** One asset of the workbook; `centre` is resolved (the centre 0 of sheet "TJ 50" is 50). */
export type AccountingRow = {
  sheet: string;
  table: AssetTable;
  centre: string;
  inventoryNumber: string;
  /** `centre-number`, the external ID Účetnictví. */
  key: string;
  registeredOn: string;
  name: string;
  /** The increased accounting price when the workbook has one, otherwise the entry price. */
  purchasePrice: number;
};

export const ACCOUNTING_COLUMNS = [
  'sheet',
  'table',
  'centre',
  'inv_number',
  'registered_on',
  'name',
  'price',
  'price_increased',
] as const;

/** Centre 0 means "not assigned" and belongs to the centre of the sheet (TJ 50 is centre 50). */
export function resolveCentre(sheet: string, centre: string): string {
  const trimmed = centre.trim();
  if (/^\d+$/.test(trimmed) && Number(trimmed) !== 0) return String(Number(trimmed));
  if (trimmed !== '' && trimmed !== '0') throw new Error(`sheet ${sheet}: centre "${centre}" is not a number`);
  const numbers = sheet.match(/\d+/g);
  if (numbers?.length !== 1) throw new Error(`sheet ${sheet}: centre 0 and no single centre number in the sheet name`);
  return String(Number(numbers[0]));
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export function parseAccountingCsv(text: string): AccountingRow[] {
  const seen = new Set<string>();
  return csvRecords(text, ACCOUNTING_COLUMNS).map((r, index) => {
    const problem = (what: string) => new Error(`accounting CSV record ${index + 1} (${r.name}): ${what}`);
    if (r.table !== 'DLHM' && r.table !== 'DrM') throw problem(`unknown table "${r.table}"`);
    const inventoryNumber = r.inv_number.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(inventoryNumber)) throw problem(`inventory number "${r.inv_number}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.registered_on)) throw problem(`date "${r.registered_on}"`);
    const entry = Number(r.price);
    const increased = r.price_increased.trim() === '' ? 0 : Number(r.price_increased);
    if (!Number.isFinite(entry) || entry < 0 || !Number.isFinite(increased) || increased < 0) throw problem('price');
    const name = collapse(r.name);
    if (!name) throw problem('empty name');
    const centre = resolveCentre(r.sheet, r.centre);
    const key = accountingId(centre, inventoryNumber);
    if (seen.has(key)) throw problem(`${key} is listed twice`);
    seen.add(key);
    return {
      sheet: r.sheet,
      table: r.table,
      centre,
      inventoryNumber,
      key,
      registeredOn: r.registered_on,
      name,
      purchasePrice: increased > 0 ? increased : entry,
    };
  });
}

// ---------------------------------------------------------------- decisions

/** What the planner cannot work out from the data; the file is company data and stays out of git. */
export type Decisions = {
  /** The date the workbook is valid for, ISO; the notes say "k 31. 7. 2026". */
  asOf: string;
  /** Centres of the workbook that have no location yet, by centre number. */
  newLocations: Record<string, { name: string; type: string }>;
  /** Workbook key → code of the electrician-only item it is the same item as (a manual merge). */
  merge: Record<string, string>;
  /** Workbook key → why the row is left out. */
  skip: Record<string, string>;
};

// ---------------------------------------------------------------- database snapshot

export type ExternalIdPair = { source: string; value: string };

export type PlanItem = {
  id: string;
  code: string;
  name: string;
  locationId: string | null;
  registeredOn: string | null;
  purchasePrice: number | null;
  note: string | null;
  version: number;
  externalIds: ExternalIdPair[];
};
export type PlanLocation = { id: string; code: string; name: string };

// ---------------------------------------------------------------- the plan

export type FieldChange = { from: unknown; to: unknown };

export type ItemUpdate = {
  itemId: string;
  oldCode: string;
  newCode: string;
  /** matched: same accounting key; merged: an electrician-only item that the workbook also lists;
   *  moved: the workbook lists it under another centre; electrician-only: has no accounting number;
   *  not-in-workbook: has one the workbook no longer lists. */
  kind: 'matched' | 'merged' | 'moved' | 'electrician-only' | 'not-in-workbook';
  key: string | null;
  name: string;
  fields: { registeredOn?: string; purchasePrice?: number; locationId?: string; note?: string | null };
  /** The full external ID list the item ends up with. */
  externalIds: ExternalIdPair[];
  externalIdsChanged: boolean;
  /** The audit change set: code, changed fields and external IDs. */
  changes: Record<string, FieldChange>;
  /** Edited by a person since the import: only the code and external IDs change. */
  touched: boolean;
  /** Differences left alone on purpose, for the report. */
  conflicts: string[];
};

export type ItemCreate = {
  newCode: string;
  key: string;
  sheet: string;
  table: AssetTable;
  centre: string;
  locationCode: string;
  name: string;
  registeredOn: string;
  purchasePrice: number;
  note: string;
  externalIds: ExternalIdPair[];
};

export type ReviewEntry = {
  key: string;
  name: string;
  centre: string;
  candidates: { code: string; name: string; score: number }[];
};

export type Plan = {
  newLocations: { code: string; centre: string; name: string; type: string }[];
  updates: ItemUpdate[];
  creates: ItemCreate[];
  skipped: { key: string; name: string; reason: string }[];
  /** New rows with a possible electrician-only twin, left as new items unless decided in `merge`. */
  review: ReviewEntry[];
  /** Accounting items of the database the workbook no longer lists. */
  notInWorkbook: { code: string; name: string }[];
  /** The last number handed out; the sequence is set to it. */
  lastNumber: number;
  /** Hash of the whole old → new numbering; `--expect` pins an apply to the reviewed dry run. */
  fingerprint: string;
};

/** The numbering was already applied: some item carries its original code as an external ID. */
export class AlreadyAppliedError extends Error {
  constructor() {
    super(`Items already have the external ID ${ORIGINAL_CODE_SOURCE}: the renumbering was already applied.`);
    this.name = 'AlreadyAppliedError';
  }
}

// ---------------------------------------------------------------- helpers

/** Lower case without diacritics and punctuation, words separated by single spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set(['pro', 'vcetne', 'the', 'and']);
const tokens = (text: string) =>
  new Set(normalize(text).split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w)));

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size);
}

const labels = (ids: ExternalIdPair[]) => ids.map((i) => `${i.source}: ${i.value}`).sort();

/** `INV-73-2023016` (the codes of the first import) → `73-2023016`. */
const legacyKey = (code: string) => /^INV-(\d+)-([A-Za-z0-9._-]+)$/.exec(code)?.slice(1).join('-') ?? null;

function keyOf(item: PlanItem): string | null {
  const own = item.externalIds.find((e) => e.source.toLowerCase() === ACCOUNTING_SOURCE.toLowerCase());
  return own?.value ?? legacyKey(item.code);
}

/** `27. 9. 2026` */
const czechDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
};

const UNKNOWN_DATE_LINE = /^Pořízeno v roce \d{4} \(přesné datum neznámé\)$/;

function withLine(note: string | null, line: string): string {
  const lines = note ? note.split('\n') : [];
  return lines.includes(line) ? lines.join('\n') : [...lines, line].join('\n');
}

const assetType = (table: AssetTable) => (table === 'DLHM' ? 'DLHM' : 'Drobný majetek');
const PRICE_EPSILON = 0.005;
const pad = (n: number) => `INV-${String(n).padStart(4, '0')}`;

// ---------------------------------------------------------------- planner

export function planAccountingUpdate(input: {
  rows: AccountingRow[];
  locations: PlanLocation[];
  items: PlanItem[];
  decisions: Decisions;
}): Plan {
  const { items, decisions } = input;
  if (items.some((i) => i.externalIds.some((e) => e.source.toLowerCase() === ORIGINAL_CODE_SOURCE.toLowerCase()))) {
    throw new AlreadyAppliedError();
  }

  // Locations: one per centre, LOC-<centre>; a centre without one needs a decision.
  const locationByCode = new Map(input.locations.map((l) => [l.code, l]));
  const newLocations: Plan['newLocations'] = [];
  for (const centre of [...new Set(input.rows.map((r) => r.centre))].sort((a, b) => Number(a) - Number(b))) {
    const code = `LOC-${centre}`;
    if (locationByCode.has(code)) continue;
    const decided = decisions.newLocations[centre];
    if (!decided) throw new Error(`centre ${centre} has no location ${code}: add it to "newLocations" in the decisions`);
    newLocations.push({ code, centre, name: decided.name, type: decided.type });
  }
  const locationCodeById = new Map(input.locations.map((l) => [l.id, l.code]));
  const centreOfItem = (item: PlanItem) => {
    const code = item.locationId ? locationCodeById.get(item.locationId) : undefined;
    return code && /^LOC-\d+$/.test(code) ? code.slice(4) : null;
  };

  // Rows: the skipped ones are reported and otherwise ignored.
  const skipped: Plan['skipped'] = [];
  const liveRows = new Map<string, AccountingRow>();
  for (const row of input.rows) {
    const reason = decisions.skip[row.key];
    if (reason !== undefined) skipped.push({ key: row.key, name: row.name, reason });
    else liveRows.set(row.key, row);
  }
  for (const key of Object.keys(decisions.skip)) {
    if (!input.rows.some((r) => r.key === key)) throw new Error(`decisions.skip: ${key} is not in the workbook`);
  }

  const claimed = new Set<string>(); // keys of rows that found their item
  const kinds = new Map<string, { kind: ItemUpdate['kind']; row?: AccountingRow }>();
  const movedFrom = new Map<string, string>(); // item id → old key

  // 1. Same accounting key.
  const unmatchedItems: PlanItem[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const row = key ? liveRows.get(key) : undefined;
    if (row) {
      kinds.set(item.id, { kind: 'matched', row });
      claimed.add(row.key);
    } else if (key) unmatchedItems.push(item);
  }

  // 2. An accounting item the workbook lists under another centre: same number, name and price.
  const notInWorkbook: Plan['notInWorkbook'] = [];
  for (const item of unmatchedItems) {
    const key = keyOf(item)!;
    const number = key.slice(key.indexOf('-') + 1);
    const twins = [...liveRows.values()].filter(
      (r) =>
        !claimed.has(r.key) &&
        r.inventoryNumber === number &&
        normalize(r.name) === normalize(item.name) &&
        (item.purchasePrice === null || Math.abs(r.purchasePrice - item.purchasePrice) < PRICE_EPSILON),
    );
    if (twins.length === 1) {
      kinds.set(item.id, { kind: 'moved', row: twins[0]! });
      claimed.add(twins[0]!.key);
      movedFrom.set(item.id, key);
    } else notInWorkbook.push({ code: item.code, name: item.name });
  }

  // 3. New rows against the electrician-only items (no accounting key, never edited by a person).
  const pool = items.filter((i) => !kinds.has(i.id) && keyOf(i) === null);
  const poolByCode = new Map(pool.map((i) => [i.code, i]));
  const freeRows = [...liveRows.values()].filter((r) => !claimed.has(r.key));

  for (const [key, code] of Object.entries(decisions.merge)) {
    const row = freeRows.find((r) => r.key === key);
    const item = poolByCode.get(code);
    if (!row) throw new Error(`decisions.merge: ${key} is not a new row of the workbook`);
    if (!item) throw new Error(`decisions.merge: ${code} is not an electrician-only item`);
    if (item.version > 1) throw new Error(`decisions.merge: ${code} was edited since the import`);
    if (kinds.has(item.id)) throw new Error(`decisions.merge: ${code} is merged twice`);
    kinds.set(item.id, { kind: 'merged', row });
    claimed.add(row.key);
  }

  // Exactly one row and exactly one item of the same centre and normalized name: the same item.
  const groupKey = (centre: string | null, name: string) => `${centre}|${normalize(name)}`;
  const rowGroups = new Map<string, AccountingRow[]>();
  for (const row of freeRows.filter((r) => !claimed.has(r.key))) {
    const k = groupKey(row.centre, row.name);
    rowGroups.set(k, [...(rowGroups.get(k) ?? []), row]);
  }
  const itemGroups = new Map<string, PlanItem[]>();
  for (const item of pool.filter((i) => !kinds.has(i.id) && i.version === 1)) {
    const k = groupKey(centreOfItem(item), item.name);
    itemGroups.set(k, [...(itemGroups.get(k) ?? []), item]);
  }
  for (const [k, group] of rowGroups) {
    const candidates = itemGroups.get(k);
    if (group.length === 1 && candidates?.length === 1) {
      kinds.set(candidates[0]!.id, { kind: 'merged', row: group[0]! });
      claimed.add(group[0]!.key);
    }
  }

  // The rest is new; show the likeliest electrician-only twins for review.
  const newRows = freeRows.filter((r) => !claimed.has(r.key));
  const left = pool.filter((i) => !kinds.has(i.id));
  const review: ReviewEntry[] = [];
  for (const row of newRows) {
    const words = tokens(row.name);
    const candidates = left
      .filter((i) => centreOfItem(i) === row.centre)
      .map((i) => ({ code: i.code, name: i.name, score: overlap(words, tokens(i.name)) }))
      .filter((c) => c.score >= 0.5)
      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
      .slice(0, 3)
      .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }));
    if (candidates.length > 0) review.push({ key: row.key, name: row.name, centre: row.centre, candidates });
  }

  // Updates of the existing items.
  const asOf = czechDate(decisions.asOf);
  type Draft = { update?: ItemUpdate; create?: Omit<ItemCreate, 'newCode'>; date: string | null; centre: number; number: number; order: string };
  const drafts: Draft[] = [];

  for (const item of items) {
    const found = kinds.get(item.id);
    const row = found?.row;
    const touched = item.version > 1;
    const fields: ItemUpdate['fields'] = {};
    const conflicts: string[] = [];
    const changes: Record<string, FieldChange> = {};
    let key = keyOf(item);
    let note = item.note;

    if (row && found) {
      key = row.key;
      if (!touched) {
        if (item.registeredOn === null) {
          fields.registeredOn = row.registeredOn;
          note = (note ?? '')
            .split('\n')
            .filter((line) => !UNKNOWN_DATE_LINE.test(line))
            .join('\n');
        } else if (item.registeredOn !== row.registeredOn) {
          conflicts.push(`registered ${item.registeredOn}, workbook ${row.registeredOn}`);
        }
        if (item.purchasePrice === null || Math.abs(item.purchasePrice - row.purchasePrice) > PRICE_EPSILON) {
          fields.purchasePrice = row.purchasePrice;
        }
        if (found.kind === 'moved') {
          const target = locationByCode.get(`LOC-${row.centre}`);
          if (target) fields.locationId = target.id;
          note = withLine(note, `Středisko v účetnictví změněno z ${movedFrom.get(item.id)!.split('-')[0]} na ${row.centre} (stav k ${asOf}).`);
        }
        if (normalize(item.name) !== normalize(row.name)) note = withLine(note, `Název v účetnictví: ${row.name}`);
        if (found.kind === 'merged') note = withLine(note, `Typ majetku: ${assetType(row.table)}`);
      } else {
        conflicts.push('edited since the import: fields left alone');
      }
    }
    const finalNote = note === '' ? null : note;
    if (finalNote !== item.note) fields.note = finalNote;

    // External IDs: the accounting key (replacing an old one) and the original code.
    let externalIds = [...item.externalIds];
    if (key) {
      externalIds = externalIds.filter((e) => e.source.toLowerCase() !== ACCOUNTING_SOURCE.toLowerCase());
      externalIds.push({ source: ACCOUNTING_SOURCE, value: key });
    }
    externalIds.push({ source: ORIGINAL_CODE_SOURCE, value: item.code });
    const externalIdsChanged = labels(externalIds).join('\n') !== labels(item.externalIds).join('\n');

    const before = {
      registeredOn: item.registeredOn,
      purchasePrice: item.purchasePrice,
      locationId: item.locationId,
      note: item.note,
    };
    for (const field of Object.keys(fields) as (keyof typeof before)[]) {
      changes[field] = { from: before[field], to: fields[field] ?? null };
    }
    if (externalIdsChanged) changes.externalIds = { from: labels(item.externalIds), to: labels(externalIds) };

    const update: ItemUpdate = {
      itemId: item.id,
      oldCode: item.code,
      newCode: '',
      kind: found?.kind ?? (key ? 'not-in-workbook' : 'electrician-only'),
      key,
      name: item.name,
      fields,
      externalIds,
      externalIdsChanged,
      changes,
      touched,
      conflicts,
    };
    const centreText = row?.centre ?? key?.split('-')[0] ?? centreOfItem(item);
    const numberText = key ? key.slice(key.indexOf('-') + 1) : '';
    drafts.push({
      update,
      date: fields.registeredOn ?? item.registeredOn,
      centre: centreText && /^\d+$/.test(centreText) ? Number(centreText) : Number.MAX_SAFE_INTEGER,
      number: /^\d+$/.test(numberText) ? Number(numberText) : Number.MAX_SAFE_INTEGER,
      order: item.code,
    });
  }

  for (const row of newRows) {
    drafts.push({
      create: {
        key: row.key,
        sheet: row.sheet,
        table: row.table,
        centre: row.centre,
        locationCode: `LOC-${row.centre}`,
        name: row.name,
        registeredOn: row.registeredOn,
        purchasePrice: row.purchasePrice,
        note: [
          `Zdroj: účetní evidence k ${asOf}`,
          `Typ majetku: ${assetType(row.table)}`,
          `List evidence: ${row.sheet}`,
        ].join('\n'),
        externalIds: [{ source: ACCOUNTING_SOURCE, value: row.key }],
      },
      date: row.registeredOn,
      centre: Number(row.centre),
      number: /^\d+$/.test(row.inventoryNumber) ? Number(row.inventoryNumber) : Number.MAX_SAFE_INTEGER,
      order: row.key,
    });
  }

  // Numbering: by date of registration, undated last; ties by centre, accounting number, old code.
  drafts.sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? -1 : 1;
    }
    return a.centre - b.centre || a.number - b.number || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
  });
  const updates: ItemUpdate[] = [];
  const creates: ItemCreate[] = [];
  drafts.forEach((draft, index) => {
    const newCode = pad(index + 1);
    if (draft.update) {
      const update = { ...draft.update, newCode };
      update.changes = { code: { from: update.oldCode, to: newCode }, ...update.changes };
      updates.push(update);
    } else creates.push({ ...draft.create!, newCode });
  });

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        ...updates.map((u) => [u.oldCode, u.newCode]),
        ...creates.map((c) => [c.key, c.newCode]),
        newLocations.map((l) => l.code),
      ]),
    )
    .digest('hex')
    .slice(0, 16);

  return { newLocations, updates, creates, skipped, review, notInWorkbook, lastNumber: drafts.length, fingerprint };
}
