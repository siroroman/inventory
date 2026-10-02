import type { ServiceRecordDto, ServiceRecordListEntryDto, ServiceRecordSummaryDto } from '@inventory/shared';
import { recordDto } from '../../http/dto.ts';
import type { ServiceRecord } from './repository.ts';
import type { ServiceRecordDetail, ServiceRecordListEntry } from './service.ts';

export function toServiceRecordSummaryDto(row: ServiceRecord): ServiceRecordSummaryDto {
  return { id: row.id, performedOn: row.performedOn, title: row.title };
}

export function toServiceRecordDto(row: ServiceRecordDetail): ServiceRecordDto {
  return {
    ...recordDto(row),
    performedOn: row.performedOn,
    title: row.title,
    performedBy: row.performedBy,
    responsiblePerson: row.responsiblePerson,
    description: row.description,
    item: { ...row.item, archivedAt: row.item.archivedAt?.toISOString() ?? null },
  };
}

export function toServiceRecordListEntryDto(row: ServiceRecordListEntry): ServiceRecordListEntryDto {
  return {
    ...recordDto(row),
    performedOn: row.performedOn,
    title: row.title,
    item: row.item,
    location: row.location,
    path: row.path,
  };
}
