// One-off import of the company's inventory into an empty database: the centres from the locations
// CSV, the items of each centre from the items CSV. The files hold real company data and are never
// committed; `deploy/import.sh` runs this against Cloud SQL.

import { createItemBody } from '@inventory/shared';
import { hashPassword } from 'better-auth/crypto';
import { createItemRepository, type ExternalIdInput } from '../../modules/items/repository.ts';
import {
  createLocationRepository,
  createLocationTypeRepository,
} from '../../modules/locations/repository.ts';
import { createManufacturerRepository } from '../../modules/manufacturers/repository.ts';
import type { Db } from '../client.ts';
import { insertSeedUsers, isEmpty } from '../seed/seed.ts';
import { csvRecords } from './csv.ts';

export class ImportRefusedError extends Error {
  constructor() {
    super('The database already contains locations, items or users; the import only fills an empty one.');
    this.name = 'ImportRefusedError';
  }
}

export type ImportOptions = {
  locationsCsv: string;
  itemsCsv: string;
  /** Password for the admin@, write@ and read@example.test users. */
  password: string;
};

export type ImportSummary = {
  users: number;
  locations: number;
  manufacturers: number;
  items: number;
  externalIds: number;
  /** Electrician's IDs listed with more than one item: kept on the first, named in the note of the others. */
  skippedRevisionIds: number;
};

const LOCATION_COLUMNS = ['id', 'name', 'type', 'address', 'note'] as const;
const ITEM_COLUMNS = [
  'location_id',
  'name',
  'manufacturer',
  'model',
  'serial_number',
  'manufacture_year',
  'registered_on',
  'inv_number',
  'revision_ids',
  'price_czk',
  'note',
  'alt_designation',
  'zone',
  'category',
  'condition',
  'data_source',
  'match_status',
  'discrepancy_note',
  'source_sheet',
  'manufacturer_raw',
] as const;

/** The source of the electrician's inspection IDs (S 129, Z 045). */
export const REVISION_SOURCE = 'Revize ILKO';
/** A centre's ID: the centre number behind a prefix, LOC-73. */
export const locationCode = (centre: string) => `LOC-${centre}`;
/**
 * An item's ID from its accounting inventory number: INV-73-2023016. Accounting restarts its numbers
 * in every centre, so the centre belongs in the ID; the number alone would repeat.
 */
export const itemCode = (centre: string, inventoryNumber: string) => `INV-${centre}-${inventoryNumber}`;

const orNull = (text: string) => text.trim() || null;

/** The CSV's extra columns as lines of the item's note, in Czech. */
export function itemNote(row: Record<(typeof ITEM_COLUMNS)[number], string>, skippedRevisionIds: string[]): string | null {
  const lines = [row.note.trim()];
  const labelled = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}` : '');
  lines.push(
    labelled('Alternativní označení', row.alt_designation),
    labelled('Zóna', row.zone),
    labelled('Kategorie', row.category),
    labelled('Stav', row.condition),
    labelled('Oddíl evidence', row.source_sheet),
    labelled('Výrobce ve zdroji', row.manufacturer_raw),
    labelled('Zdroj dat', row.data_source),
  );
  if (row.match_status === 'SPORNÉ') lines.push(`K ověření: ${row.discrepancy_note.trim() || 'zdroje se neshodují.'}`);
  if (row.match_status === 'NOVÉ') lines.push('Jen v revizi elektrikáře, chybí ve finanční evidenci.');
  for (const id of skippedRevisionIds) lines.push(`ID revize ${id} je uvedeno i u jiné položky.`);
  return lines.filter(Boolean).join('\n') || null;
}

/** Fills an empty database with the inventory, in one transaction; any bad row stops it all. */
export async function importInventory(db: Db, options: ImportOptions): Promise<ImportSummary> {
  const centres = csvRecords(options.locationsCsv, LOCATION_COLUMNS);
  const rows = csvRecords(options.itemsCsv, ITEM_COLUMNS);
  const passwordHash = await hashPassword(options.password);

  return db.transaction(async (tx) => {
    if (!(await isEmpty(tx))) throw new ImportRefusedError();
    const userIds = await insertSeedUsers(tx, passwordHash);
    const by = userIds[0]!;

    const typeIds = new Map((await createLocationTypeRepository(tx).list()).map((t) => [t.code, t.id]));
    const locationRepo = createLocationRepository(tx);
    const locationIds = new Map<string, string>();
    for (const [index, centre] of centres.entries()) {
      const typeId = typeIds.get(centre.type.trim());
      if (!typeId) throw new Error(`locations CSV record ${index + 1}: unknown location type "${centre.type}"`);
      const row = await locationRepo.insert({
        code: locationCode(centre.id.trim()),
        name: centre.name.trim(),
        parentId: null,
        locationTypeId: typeId,
        address: orNull(centre.address),
        note: orNull(centre.note),
        createdBy: by,
      });
      locationIds.set(centre.id.trim(), row.id);
    }

    const manufacturerRepo = createManufacturerRepository(tx);
    const manufacturerIds = new Map<string, string>();
    const manufacturerId = async (name: string): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (!manufacturerIds.has(key)) {
        manufacturerIds.set(key, (await manufacturerRepo.insert({ name: trimmed, note: null, createdBy: by })).id);
      }
      return manufacturerIds.get(key)!;
    };

    const itemRepo = createItemRepository(tx);
    const takenRevisionIds = new Set<string>();
    let externalIds = 0;
    let skippedRevisionIds = 0;
    for (const [index, row] of rows.entries()) {
      const problem = (text: string) => new Error(`items CSV record ${index + 1} (${row.name}): ${text}`);
      const locationId = locationIds.get(row.location_id.trim());
      if (!locationId) throw problem(`unknown location ${row.location_id}`);

      const ids: ExternalIdInput[] = [];
      const skipped: string[] = [];
      for (const value of row.revision_ids.split(',').map((v) => v.trim()).filter(Boolean)) {
        if (takenRevisionIds.has(value.toLowerCase())) skipped.push(value);
        else {
          takenRevisionIds.add(value.toLowerCase());
          ids.push({ source: REVISION_SOURCE, value });
        }
      }

      const inventoryNumber = row.inv_number.trim();
      const parsed = createItemBody.safeParse({
        // Without an inventory number the database assigns the next INV-nnnn.
        ...(inventoryNumber && { code: itemCode(row.location_id.trim(), inventoryNumber) }),
        name: row.name,
        model: orNull(row.model),
        serialNumber: orNull(row.serial_number),
        manufactureYear: row.manufacture_year.trim() ? Number(row.manufacture_year) : null,
        registeredOn: orNull(row.registered_on),
        purchasePrice: row.price_czk.trim() ? Number(row.price_czk) : null,
        note: itemNote(row, skipped),
        externalIds: ids,
      });
      if (!parsed.success) throw problem(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      const item = parsed.data;

      const saved = await itemRepo.insert({
        ...(item.code && { code: item.code }),
        name: item.name,
        locationId,
        manufacturerId: await manufacturerId(row.manufacturer),
        model: item.model ?? null,
        serialNumber: item.serialNumber ?? null,
        manufactureYear: item.manufactureYear ?? null,
        registeredOn: item.registeredOn ?? null,
        purchasePrice: item.purchasePrice ?? null,
        warrantyUntil: null,
        lastServiceOn: null,
        nextServiceOn: null,
        documentsUrl: null,
        note: item.note ?? null,
        createdBy: by,
      });
      externalIds += (await itemRepo.replaceExternalIds(saved.id, item.externalIds ?? [], by)).length;
      skippedRevisionIds += skipped.length;
    }

    return {
      users: userIds.length,
      locations: locationIds.size,
      manufacturers: manufacturerIds.size,
      items: rows.length,
      externalIds,
      skippedRevisionIds,
    };
  });
}
