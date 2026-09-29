import type { ServiceProviderDetailDto, ServiceProviderDto, ServicedBrandDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { ServiceProvider, ServicedBrand } from './repository.ts';
import type { ServiceProviderDetail } from './service.ts';

export function toServiceProviderDto(row: ServiceProvider): ServiceProviderDto {
  return {
    ...recordDto(row),
    code: row.code,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    web: row.web,
    note: row.note,
  };
}

export function toServicedBrandDto(row: ServicedBrand): ServicedBrandDto {
  return {
    id: row.id,
    name: row.name,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    priority: row.priority,
  };
}

export function toServiceProviderDetailDto(row: ServiceProviderDetail): ServiceProviderDetailDto {
  return { ...toServiceProviderDto(row), manufacturers: row.manufacturers.map(toServicedBrandDto) };
}
