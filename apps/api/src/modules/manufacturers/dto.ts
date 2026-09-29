import type { ManufacturerDetailDto, ManufacturerDto, RankedProviderDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { ManufacturerDetail } from './service.ts';
import type { Manufacturer, RankedProvider } from './repository.ts';

export function toManufacturerDto(row: Manufacturer): ManufacturerDto {
  return { ...recordDto(row), name: row.name, note: row.note };
}

export function toRankedProviderDto(row: RankedProvider): RankedProviderDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    web: row.web,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    priority: row.priority,
  };
}

export function toManufacturerDetailDto(row: ManufacturerDetail): ManufacturerDetailDto {
  return { ...toManufacturerDto(row), providers: row.providers.map(toRankedProviderDto) };
}
