import { z } from 'zod';
import { codeRef, humanCode, pageOf, timestamp } from './fields.ts';
import { archivedQuery, searchPageQuery } from './http.ts';

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
 * were not on the list; `missing` the items of the list people flagged as missing (a check takes the
 * flag back).
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
  /** Set when an ended run was archived; a run in progress is never archived. */
  archivedAt: timestamp.nullable(),
  counts: inventoryCountsSchema,
  /** The person who started the run, then everyone who checked something. */
  participants: z.array(personRef),
};

/** A run in the Inventura tab. */
export const inventoryListEntrySchema = z.object(runFields);
export type InventoryListEntryDto = z.infer<typeof inventoryListEntrySchema>;

export const inventoryListSchema = pageOf(inventoryListEntrySchema);

/**
 * `open`: runs in progress, newest start first. `closed`: finished and cancelled ones, newest end
 * first. `archived=true` lists the archived runs instead of the active ones (only ended runs can be
 * archived, so `open` is then empty).
 */
export const inventoryListQuery = searchPageQuery
  .extend({ state: z.enum(['open', 'closed']).default('open') })
  .extend(archivedQuery.shape);

/**
 * A location of the run that has rows in it: its path from the top (itself last) and its numbers.
 * `total` and `checked` count only the list taken at the start (the items archived since are left
 * out), so the locations add up to the run's `counts.expected` and `counts.checked`; items found or
 * added there are `extra`.
 */
export const inventoryLocationSchema = z.object({
  ...codeRef.shape,
  path: z.array(codeRef),
  total: count,
  checked: count,
  /** Items found or added in this location (checked ones; they are not on the list). */
  extra: count,
  /** List items flagged as missing. */
  missing: count,
  participants: z.array(personRef),
});
export type InventoryLocationDto = z.infer<typeof inventoryLocationSchema>;

/** What happened to a run after its start. */
export const inventoryEventActions = ['finish', 'cancel', 'reopen'] as const;

export const inventoryEventSchema = z.object({
  action: z.enum(inventoryEventActions),
  at: timestamp,
  /** Null when the person is unknown. */
  by: personRef.nullable(),
});
export type InventoryEventDto = z.infer<typeof inventoryEventSchema>;

export const inventorySchema = z.object({
  ...runFields,
  version: z.number().int().min(1),
  note: z.string().nullable(),
  committee: z.string().nullable(),
  /** People who checked something in the last 15 minutes (a run in progress only). */
  activeNow: z.array(personRef),
  /**
   * Finish, cancel and reopen of the run, oldest first, so a run that was cancelled and reopened
   * still says so (`endedAt` / `endedBy` are cleared by a reopen). The start is `startedAt` / `startedBy`.
   */
  history: z.array(inventoryEventSchema),
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

/** How an item came to be in a run: on the list at the start, found elsewhere, or created during the run. */
export const inventoryRowKinds = ['expected', 'elsewhere', 'new'] as const;
export const inventoryRowKind = z.enum(inventoryRowKinds);
export type InventoryRowKind = z.infer<typeof inventoryRowKind>;

export const checkMethods = ['scan', 'manual'] as const;
export const checkMethod = z.enum(checkMethods);
export type CheckMethod = z.infer<typeof checkMethod>;

/**
 * One item of a run as the checklist shows it. Only rows a person sees are listed: items of the
 * list taken at the start that are still active, and found or added items that are checked.
 */
export const inventoryRowSchema = z.object({
  /** The item's id. */
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: inventoryRowKind,
  /** The location the row belongs to in the run, where it is checked. */
  locationId: z.uuid(),
  checkedAt: timestamp.nullable(),
  checkedBy: personRef.nullable(),
  method: checkMethod.nullable(),
  /**
   * A person flagged the item of the list as missing: looked for and not there. Never true for a
   * checked row (a check takes the flag back) or for an item found elsewhere or added.
   */
  missing: z.boolean(),
  /** Where a found-elsewhere item was registered when it was found, from the top (the location last); empty when it had no location. */
  registeredPath: z.array(codeRef),
  /**
   * A found-elsewhere item that still is registered somewhere other than the row's location. False
   * once its location was changed to the row's: the item is where it was found and shows as an
   * ordinary check. Always false for the other kinds.
   */
  registeredElsewhere: z.boolean(),
  /** The item was moved to the run's location during the run. */
  moved: z.boolean(),
});
export type InventoryRowDto = z.infer<typeof inventoryRowSchema>;

/** All the rows of a run or of one of its locations, not paged: a location holds at most a few hundred. */
export const inventoryRowsSchema = z.object({ items: z.array(inventoryRowSchema) });
export type InventoryRowsDto = z.infer<typeof inventoryRowsSchema>;

export const inventoryRowsQuery = z.object({ locationId: z.uuid().optional() });

export const inventoryRowParams = z.object({ id: z.uuid(), itemId: z.uuid() });

/**
 * A check by the code on a label, which is the item's ID. `locationId` is the location whose
 * checklist the scanner was opened from; without it the run's root is the context and no item
 * counts as being in the wrong place. `manual` is a code typed by hand.
 */
export const scanInventoryBody = z.strictObject({
  code: humanCode,
  locationId: z.uuid().optional(),
  method: checkMethod.default('scan'),
});
export type ScanInventoryBody = z.input<typeof scanInventoryBody>;

/** The scanned item as the result sheet shows it. */
export const scannedItemSchema = z.object({
  /** The item's id. */
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  /** Where the item is registered now, from the top (the location last); empty when it has no location. */
  path: z.array(codeRef),
});
export type ScannedItemDto = z.infer<typeof scannedItemSchema>;

export const scanOutcomes = ['found', 'found_elsewhere', 'already_checked', 'archived', 'unknown_code'] as const;

/**
 * What a scan did, by `outcome`:
 * - `found`: an item of the list was checked. `misplaced`: the scanner was opened from a location
 *   other than the one the item is registered in (`item.path` says where).
 * - `found_elsewhere`: an item that is not on the list was added to the run, checked, at the context
 *   location; `item.path` is where it is registered.
 * - `already_checked`: nothing changed, `row` says who checked it and when.
 * - `archived`: nothing recorded, the item is not counted.
 * - `unknown_code`: no item has this ID, nothing recorded.
 *
 * `wasMissing` is for a check that cleared the Nezvěstná status (always false until that exists).
 */
export const scanResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('found'),
    item: scannedItemSchema,
    row: inventoryRowSchema,
    misplaced: z.boolean(),
    wasMissing: z.boolean(),
  }),
  z.object({
    outcome: z.literal('found_elsewhere'),
    item: scannedItemSchema,
    row: inventoryRowSchema,
    wasMissing: z.boolean(),
  }),
  z.object({ outcome: z.literal('already_checked'), item: scannedItemSchema, row: inventoryRowSchema }),
  z.object({ outcome: z.literal('archived'), item: scannedItemSchema }),
  z.object({ outcome: z.literal('unknown_code') }),
]);
export type ScanResultDto = z.infer<typeof scanResultSchema>;

/**
 * How an item of a run came out, for the export: `found` (on the list, checked), `found_elsewhere`
 * and `new` (checked, not on the list), `missing` (flagged), `not_checked` (left unchecked at the end)
 * and `archived` (on the list, archived since the start, so not counted).
 */
export const exportResults = ['found', 'found_elsewhere', 'new', 'missing', 'not_checked', 'archived'] as const;
export const exportResult = z.enum(exportResults);
export type ExportResult = z.infer<typeof exportResult>;

/**
 * One item of a run with what is needed to compare it with the accounting records: its identifiers
 * (`accountingId` is the accounting inventory number `<centre>-<number>`, `originalCode` the code
 * before the renumbering, `otherExternalIds` the rest as "Source: value"), the make, model and serial
 * number, and where it is registered and where it was found. Paths run from the top-level location
 * (the location last); an item with no location has an empty `registeredPath`.
 */
export const inventoryExportRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  accountingId: z.string().nullable(),
  originalCode: z.string().nullable(),
  otherExternalIds: z.array(z.string()),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  purchasePrice: z.number().nullable(),
  result: exportResult,
  /** Where the item is registered now. */
  registeredPath: z.array(codeRef),
  /** Where it was found (checked), or where the list had it when it was not checked. */
  foundPath: z.array(codeRef),
  checkedAt: timestamp.nullable(),
  checkedBy: personRef.nullable(),
  method: checkMethod.nullable(),
  /** The item is archived now. */
  archived: z.boolean(),
});
export type InventoryExportRowDto = z.infer<typeof inventoryExportRowSchema>;

/** Every item of a run, not paged: a run holds a few thousand items at most. */
export const inventoryExportSchema = z.object({ items: z.array(inventoryExportRowSchema) });
export type InventoryExportDto = z.infer<typeof inventoryExportSchema>;
