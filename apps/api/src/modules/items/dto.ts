import type { ItemListEntryDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { ItemListEntry } from './service.ts';

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
