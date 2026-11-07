import type { LocationContactDto, LocationDetailDto, LocationDto, LocationTypeDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { LocationDetail, LocationSummary } from './service.ts';
import type { LocationContact, LocationType } from './repository.ts';

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

function toContactDto(row: LocationContact): LocationContactDto {
  return { role: row.role, name: row.name, phone: row.phone, email: row.email };
}

export function toLocationDetailDto(row: LocationDetail): LocationDetailDto {
  return {
    ...toLocationDto(row),
    contacts: row.contacts.map(toContactDto),
    inheritedContacts: row.inheritedContacts.map(({ location, contacts }) => ({
      location: { id: location.id, code: location.code, name: location.name },
      contacts: contacts.map(toContactDto),
    })),
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
