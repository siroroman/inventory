import type { LocationDto, LocationTypeDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { LocationSummary } from './service.ts';
import type { LocationType } from './repository.ts';

/** Only the record fields need converting (`recordDto`); the rest the database returns is JSON-ready. */
export function toLocationDto(row: LocationSummary): LocationDto {
  return {
    ...recordDto(row),
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
    ...recordDto(row),
    code: row.code,
    name: row.name,
    sortOrder: row.sortOrder,
  };
}
