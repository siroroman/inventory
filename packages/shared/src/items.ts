import { z } from 'zod';
import {
  codeRef,
  documentsUrl,
  hasChange,
  humanCode,
  isoDate,
  nullableText,
  pageOf,
  recordFields,
  requiredText,
  searchQuery,
} from './fields.ts';
import { archivedQuery, searchPageQuery, versionField } from './http.ts';

/** One row of an item list; `itemSchema` extends it with the rest of the item. */
export const itemListEntrySchema = z.object({
  ...recordFields,
  code: z.string(),
  name: z.string(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  manufacturer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The location the item is in, and its path from the top; null with an empty path while it has none. */
  location: codeRef.nullable(),
  path: z.array(codeRef),
  warrantyUntil: isoDate.nullable(),
  lastServiceOn: isoDate.nullable(),
  nextServiceOn: isoDate.nullable(),
});
export type ItemListEntryDto = z.infer<typeof itemListEntrySchema>;

export const itemListSchema = pageOf(itemListEntrySchema);

export const itemListQuery = searchPageQuery;

const currentYear = () => new Date().getFullYear();

/** 1950 up to this year; the database only bounds it to 2100 because a CHECK must be immutable. */
const manufactureYear = z
  .number()
  .int()
  .min(1950)
  .refine((year) => year <= currentYear(), { message: 'Manufacture year is in the future' });

/** CZK with at most two decimals; numeric(12, 2) in the database. */
const purchasePrice = z.number().nonnegative().max(9_999_999_999.99).multipleOf(0.01);

/** An identifier the item has at another party, e.g. source "Elektrikář", value "EL-4821". */
export const externalIdSchema = z.strictObject({ source: requiredText(60), value: requiredText(120) });
export type ExternalIdDto = z.infer<typeof externalIdSchema>;

const itemFields = {
  name: requiredText(200),
  locationId: z.uuid().nullable(),
  manufacturerId: z.uuid().nullable(),
  model: nullableText(120),
  serialNumber: nullableText(120),
  manufactureYear: manufactureYear.nullable(),
  registeredOn: isoDate.nullable(),
  purchasePrice: purchasePrice.nullable(),
  warrantyUntil: isoDate.nullable(),
  lastServiceOn: isoDate.nullable(),
  nextServiceOn: isoDate.nullable(),
  documentsUrl: documentsUrl.nullable(),
  note: nullableText(2000),
  /** At most 20 per item; a pair may not repeat, and may not belong to another item. */
  externalIds: z.array(externalIdSchema).max(20),
};

/** An item's own fields; `itemDetailSchema` (photos.ts) adds the gallery for the detail screen. */
export const itemSchema = itemListEntrySchema.extend({
  manufactureYear: z.number().int().nullable(),
  registeredOn: isoDate.nullable(),
  purchasePrice: z.number().nullable(),
  documentsUrl: z.string().nullable(),
  note: z.string().nullable(),
  externalIds: z.array(externalIdSchema),
});
export type ItemDto = z.infer<typeof itemSchema>;

const optionalItemFields = {
  manufacturerId: true,
  model: true,
  serialNumber: true,
  manufactureYear: true,
  registeredOn: true,
  purchasePrice: true,
  warrantyUntil: true,
  lastServiceOn: true,
  nextServiceOn: true,
  documentsUrl: true,
  note: true,
  externalIds: true,
} as const;

/**
 * `code` is optional: without it the database assigns the next INV-nnnnn. Fixed once the item exists.
 * `inventoryId` is the run the item is created for (from a checklist): when it is still in progress
 * and the item's location is in it, the item is added to it as a checked *Nové* row, in the same
 * transaction. Otherwise the item is only created (`addedToInventory` in the answer says which).
 */
export const createItemBody = z
  .strictObject({ ...itemFields, code: humanCode, inventoryId: z.uuid() })
  .partial({ code: true, locationId: true, inventoryId: true, ...optionalItemFields });
export type CreateItemBody = z.infer<typeof createItemBody>;

/** The answer to `POST /items`: the item, and whether it was added to the run named by `inventoryId`. */
export const createdItemSchema = itemSchema.extend({ addedToInventory: z.boolean() });
export type CreatedItemDto = z.infer<typeof createdItemSchema>;

/**
 * Only the fields present change; `null` clears one (not the name). Sending
 * `externalIds` replaces the whole list, `[]` clears it.
 */
export const updateItemBody = z
  .strictObject({ ...itemFields, version: versionField })
  .partial({ name: true, locationId: true, ...optionalItemFields })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateItemBody = z.infer<typeof updateItemBody>;

/** `GET /items`: `locationId` includes everything below that location. */
export const itemSearchQuery = itemListQuery.extend({
  ...archivedQuery.shape,
  locationId: z.uuid().optional(),
  manufacturerId: z.uuid().optional(),
});

/** The most labels one PDF holds (SPEC §9.4.12), and so the largest `limit` of `GET /items/labels`. */
export const MAX_LABELS = 1000;

/**
 * `GET /items/labels`: `locationId` takes everything below that location, `q` is the item search.
 * Not paged: `limit` caps the answer and `total` says how many matched.
 */
export const itemLabelsQuery = z.object({
  q: searchQuery.optional(),
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LABELS).default(MAX_LABELS),
});

/** What a label needs of an item; `path` is the names of its location from the top, joined by " › " ("" = no location). */
export const itemLabelSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string(), path: z.string() });
export type ItemLabelDto = z.infer<typeof itemLabelSchema>;

export const itemLabelsSchema = z.object({ items: z.array(itemLabelSchema), total: z.number().int().min(0) });
export type ItemLabelsDto = z.infer<typeof itemLabelsSchema>;
