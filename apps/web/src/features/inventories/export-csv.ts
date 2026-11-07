import type { CodeRef, ExportResult, InventoryDto, InventoryExportRowDto } from '@inventory/shared';
import { pathLabel } from '@/features/locations/path';
import i18n from '@/i18n';
import { formatTimestamp } from '@/lib/format';

// The CSV of a run (SPEC §9.4.9), made to be laid next to the accountant's workbook: one sheet per
// centre (50, 51, 59...) with the column "Inv. číslo" holding the number without the centre
// (1512). The item's accounting ID `74-1512` is split into the two, so a row matches by centre +
// number; the centre of the location (LOC-74 → 74) is there for items with no accounting ID.

/** Excel in Czech: a BOM so it reads UTF-8, `;` between fields, CRLF line ends, decimal comma. */
const BOM = '﻿';
const SEPARATOR = ';';
const LINE_END = '\r\n';
/** The prefix of the top-level locations made from the centres by the import. */
const CENTRE_PREFIX = 'LOC-';
/** Text Excel would take for a formula; a leading apostrophe keeps it as text (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

const columns = [
  'centre',
  'inventoryNumber',
  'code',
  'name',
  'manufacturer',
  'model',
  'serialNumber',
  'originalCode',
  'otherExternalIds',
  'result',
  'foundIn',
  'registeredIn',
  'locationCentre',
  'checkedBy',
  'checkedAt',
  'method',
  'purchasePrice',
] as const;

/** `74-1512` → centre `74`, number `1512`. A value without a hyphen is the number alone. */
export function splitAccountingId(value: string | null): { centre: string; number: string } {
  if (!value) return { centre: '', number: '' };
  const hyphen = value.indexOf('-');
  return hyphen < 0 ? { centre: '', number: value } : { centre: value.slice(0, hyphen), number: value.slice(hyphen + 1) };
}

/** The centre of a path: the code of its top-level location without the prefix (LOC-74 → 74). */
function centreOf(path: CodeRef[]): string {
  const code = path[0]?.code ?? '';
  return code.startsWith(CENTRE_PREFIX) ? code.slice(CENTRE_PREFIX.length) : code;
}

/** A price with a decimal comma and no thousands separator, so Excel reads it as a number. */
function priceText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

function cell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const numeric = new Intl.Collator('cs', { numeric: true });

/**
 * In the accountant's order: by centre, then by inventory number (compared as numbers); items with
 * no accounting ID after them, by name.
 */
function byAccounting(a: InventoryExportRowDto, b: InventoryExportRowDto): number {
  if (!a.accountingId || !b.accountingId) {
    return Number(!a.accountingId) - Number(!b.accountingId) || numeric.compare(a.name, b.name);
  }
  const x = splitAccountingId(a.accountingId);
  const y = splitAccountingId(b.accountingId);
  return numeric.compare(x.centre, y.centre) || numeric.compare(x.number, y.number);
}

function fields(row: InventoryExportRowDto): Record<(typeof columns)[number], string> {
  const t = i18n.t.bind(i18n);
  const { centre, number } = splitAccountingId(row.accountingId);
  return {
    centre,
    inventoryNumber: number,
    code: row.code,
    name: row.name,
    manufacturer: row.manufacturer ?? '',
    model: row.model ?? '',
    serialNumber: row.serialNumber ?? '',
    originalCode: row.originalCode ?? '',
    otherExternalIds: row.otherExternalIds.join(', '),
    result: t(`inventory.export.results.${row.result satisfies ExportResult}`),
    foundIn: pathLabel(row.foundPath),
    registeredIn: pathLabel(row.registeredPath),
    locationCentre: centreOf(row.registeredPath),
    checkedBy: row.checkedBy?.name ?? '',
    checkedAt: row.checkedAt ? formatTimestamp(row.checkedAt) : '',
    method: row.method ? t(`inventory.export.methods.${row.method}`) : '',
    purchasePrice: priceText(row.purchasePrice),
  };
}

/** The whole file: the heading row, then every item in the accountant's order. */
export function inventoryCsv(rows: InventoryExportRowDto[]): string {
  const heading = columns.map((column) => cell(i18n.t(`inventory.export.columns.${column}`)));
  const lines = [...rows].sort(byAccounting).map((row) => {
    const values = fields(row);
    return columns.map((column) => cell(values[column]));
  });
  return BOM + [heading, ...lines].map((line) => line.join(SEPARATOR)).join(LINE_END) + LINE_END;
}

/** `inventura-LOC-74-2026-10-04.csv`: the root's ID and the end date (today while the run is in progress). */
export function inventoryCsvFileName(inventory: Pick<InventoryDto, 'location' | 'endedAt'>, now = new Date()): string {
  const day = inventory.endedAt ? new Date(inventory.endedAt) : now;
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  const code = inventory.location.code.replace(/[^A-Za-z0-9._-]/g, '');
  return `inventura-${code}-${date}.csv`;
}
