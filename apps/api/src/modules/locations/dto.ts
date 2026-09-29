import type { LocationDto, LocationTypeDto } from '@inventory/shared';
import type { LocationSummary } from './service.ts';
import type { LocationType } from './repository.ts';

/** Timestamps become ISO strings; everything else the database returns is already JSON-ready. */
export function toLocationDto(row: LocationSummary): LocationDto {
  return {
    id: row.id,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    type: row.type,
    address: row.address,
    note: row.note,
    path: row.path,
    itemCount: row.itemCount,
    childCount: row.childCount,
  };
}

export function toLocationTypeDto(row: LocationType): LocationTypeDto {
  return {
    id: row.id,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    code: row.code,
    name: row.name,
    sortOrder: row.sortOrder,
  };
}
