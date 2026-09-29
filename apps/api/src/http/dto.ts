import type { recordFields } from '@inventory/shared';
import type { z } from 'zod';

type StoredRecord = { id: string; version: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date };

/** The fields every stored record carries, as the API returns them: timestamps become ISO strings. */
export function recordDto(row: StoredRecord): z.infer<z.ZodObject<typeof recordFields>> {
  return {
    id: row.id,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
