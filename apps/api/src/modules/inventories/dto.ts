import type {
  InventoryDto,
  InventoryExportRowDto,
  InventoryListEntryDto,
  InventoryPreviewDto,
  InventoryRowDto,
  ScanResultDto,
} from '@inventory/shared';
import type {
  InventoryDetail,
  InventoryEntry,
  InventoryExportItem,
  InventoryPreview,
  InventoryRunItem,
  ScanResult,
} from './service.ts';

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
    archivedAt: row.archivedAt?.toISOString() ?? null,
    scopeSource: row.scopeSource,
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
    history: row.history.map((event) => ({ action: event.action, at: event.at.toISOString(), by: event.by })),
  };
}

export function toInventoryPreviewDto(preview: InventoryPreview): InventoryPreviewDto {
  return {
    itemCount: preview.itemCount,
    locationCount: preview.locationCount,
    sources: preview.sources,
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
    missing: row.missing,
    registeredPath: row.registeredPath,
    registeredElsewhere: row.registeredElsewhere,
    moved: row.moved,
    externalIds: row.externalIds,
  };
}

export function toInventoryExportRowDto(row: InventoryExportItem): InventoryExportRowDto {
  return {
    id: row.itemId,
    code: row.code,
    name: row.name,
    accountingId: row.accountingId,
    originalCode: row.originalCode,
    otherExternalIds: row.otherExternalIds,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    purchasePrice: row.purchasePrice,
    result: row.result,
    registeredPath: row.registeredPath,
    foundPath: row.foundPath,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    checkedBy: row.checkedBy,
    method: row.method as InventoryExportRowDto['method'],
    archived: row.itemArchived,
  };
}

export function toScanResultDto(result: ScanResult): ScanResultDto {
  switch (result.outcome) {
    case 'found':
    case 'found_elsewhere':
    case 'already_checked':
      return { ...result, row: toInventoryRowDto(result.row) };
    case 'archived':
    case 'out_of_scope':
    case 'unknown_code':
      return result;
  }
}
