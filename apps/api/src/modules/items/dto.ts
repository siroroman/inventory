import type { ItemListEntryDto } from '@inventory/shared';
import type { ItemListEntry } from './service.ts';

export function toItemListEntryDto(row: ItemListEntry): ItemListEntryDto {
  return {
    id: row.id,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
