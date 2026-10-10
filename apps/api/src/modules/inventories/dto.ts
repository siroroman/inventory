import type {
  InventoryDto,
  InventoryListEntryDto,
  InventoryPreviewDto,
  InventoryRowDto,
  ScanResultDto,
} from '@inventory/shared';
import type { InventoryDetail, InventoryEntry, InventoryPreview, InventoryRunItem, ScanResult } from './service.ts';

function runFields(row: InventoryEntry) {
  return {
    id: row.id,
    status: row.status as InventoryListEntryDto['status'],
    location: row.location,
    path: row.path,
    startedAt: row.createdAt.toISOString(),
    startedBy: row.startedBy,
    endedAt: row.endedAt?.toISOString() ?? null,
    endedBy: row.closedBy,
    counts: row.counts,
    participants: row.participants,
  };
}

export const toInventoryListEntryDto = (row: InventoryEntry): InventoryListEntryDto => runFields(row);

export function toInventoryDto(row: InventoryDetail): InventoryDto {
  return {
    ...runFields(row),
    version: row.version,
    note: row.note,
    committee: row.committee,
    activeNow: row.activeNow,
    locations: row.locations,
  };
}

export function toInventoryPreviewDto(preview: InventoryPreview): InventoryPreviewDto {
  return {
    itemCount: preview.itemCount,
    locationCount: preview.locationCount,
    overlap: preview.overlap && { ...preview.overlap, startedAt: preview.overlap.startedAt.toISOString() },
  };
}

export function toInventoryRowDto(row: InventoryRunItem): InventoryRowDto {
  return {
    id: row.itemId,
    code: row.code,
    name: row.name,
    kind: row.kind as InventoryRowDto['kind'],
    locationId: row.locationId,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    checkedBy: row.checkedBy,
    method: row.method as InventoryRowDto['method'],
    registeredPath: row.registeredPath,
    moved: row.moved,
  };
}

export function toScanResultDto(result: ScanResult): ScanResultDto {
  switch (result.outcome) {
    case 'found':
    case 'found_elsewhere':
    case 'already_checked':
      return { ...result, row: toInventoryRowDto(result.row) };
    case 'archived':
    case 'unknown_code':
      return result;
  }
}
