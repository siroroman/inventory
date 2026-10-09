import { z } from 'zod';
import { codeRef, pageOf, timestamp } from './fields.ts';
import { searchPageQuery } from './http.ts';

// Inventory runs (SPEC §9): a physical check of a location and everything below it.

export const inventoryStatuses = ['in_progress', 'finished', 'cancelled'] as const;
export const inventoryStatus = z.enum(inventoryStatuses);
export type InventoryStatus = z.infer<typeof inventoryStatus>;

/** A user as shown next to a run: the avatar's initials come from the name. */
export const personRef = z.object({ id: z.uuid(), name: z.string() });
export type PersonRef = z.infer<typeof personRef>;

const count = z.number().int().min(0);

/**
 * What a run's rows add up to. `expected` is the list taken at the start, without the items archived
 * since; `checked` is how many of those were checked. `elsewhere` and `new` are checked items that
 * were not on the list; `missing` those marked Nezvěstná at the finish.
 */
export const inventoryCountsSchema = z.object({
  expected: count,
  checked: count,
  elsewhere: count,
  new: count,
  missing: count,
});
export type InventoryCountsDto = z.infer<typeof inventoryCountsSchema>;

const runFields = {
  id: z.uuid(),
  status: inventoryStatus,
  /** The root of the run, and the path to it from the top-level location (the root last). */
  location: codeRef,
  path: z.array(codeRef),
  startedAt: timestamp,
  startedBy: personRef.nullable(),
  endedAt: timestamp.nullable(),
  endedBy: personRef.nullable(),
  counts: inventoryCountsSchema,
  /** The person who started the run, then everyone who checked something. */
  participants: z.array(personRef),
};

/** A run in the Inventura tab. */
export const inventoryListEntrySchema = z.object(runFields);
export type InventoryListEntryDto = z.infer<typeof inventoryListEntrySchema>;

export const inventoryListSchema = pageOf(inventoryListEntrySchema);

/** `open`: runs in progress, newest start first. `closed`: finished and cancelled ones, newest end first. */
export const inventoryListQuery = searchPageQuery.extend({ state: z.enum(['open', 'closed']).default('open') });

/** A location of the run that has rows in it: its path from the top (itself last) and its numbers. */
export const inventoryLocationSchema = z.object({
  ...codeRef.shape,
  path: z.array(codeRef),
  /** The rows a person sees there: the list taken at the start plus items found or added. */
  total: count,
  checked: count,
  participants: z.array(personRef),
});
export type InventoryLocationDto = z.infer<typeof inventoryLocationSchema>;

export const inventorySchema = z.object({
  ...runFields,
  version: z.number().int().min(1),
  note: z.string().nullable(),
  committee: z.string().nullable(),
  /** People who checked something in the last 15 minutes (a run in progress only). */
  activeNow: z.array(personRef),
  /** In path order (Czech collation), a location before the ones below it. */
  locations: z.array(inventoryLocationSchema),
});
export type InventoryDto = z.infer<typeof inventorySchema>;

export const inventoryPreviewQuery = z.object({ locationId: z.uuid() });

/** The start screen: what a run on the location would check, and the run in progress it would clash with. */
export const inventoryPreviewSchema = z.object({
  itemCount: count,
  locationCount: count,
  overlap: z
    .object({ id: z.uuid(), location: codeRef, startedBy: personRef.nullable(), startedAt: timestamp })
    .nullable(),
});
export type InventoryPreviewDto = z.infer<typeof inventoryPreviewSchema>;

export const startInventoryBody = z.strictObject({ locationId: z.uuid() });
export type StartInventoryBody = z.infer<typeof startInventoryBody>;
