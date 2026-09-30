import type { ItemDto, ItemListEntryDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { ItemDetail, ItemListEntry } from './service.ts';

export function toItemListEntryDto(row: ItemListEntry): ItemListEntryDto {
  return {
    ...recordDto(row),
    code: row.code,
    name: row.name,
    model: row.model,
    serialNumber: row.serialNumber,
    manufacturer: row.manufacturer,
    location: row.location,
    path: row.path,
    warrantyUntil: row.warrantyUntil,
    lastServiceOn: row.lastServiceOn,
    nextServiceOn: row.nextServiceOn,
  };
}

export function toItemDto(row: ItemDetail): ItemDto {
  // The path runs from the top down to the item's own location, so the location is its last segment;
  // an item without a location has an empty path.
  const location = row.path.at(-1) ?? null;
  return {
    ...recordDto(row),
    code: row.code,
    name: row.name,
    model: row.model,
    serialNumber: row.serialNumber,
    manufacturer: row.manufacturer,
    location,
    path: row.path,
    manufactureYear: row.manufactureYear,
    registeredOn: row.registeredOn,
    warrantyUntil: row.warrantyUntil,
    lastServiceOn: row.lastServiceOn,
    nextServiceOn: row.nextServiceOn,
    documentsUrl: row.documentsUrl,
    note: row.note,
    externalIds: row.externalIds.map(({ source, value }) => ({ source, value })),
  };
}
