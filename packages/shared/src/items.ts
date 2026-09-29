import { z } from 'zod';
import { codeRef, documentsUrl, hasChange, isoDate, nullableText, pageOf, recordFields, requiredText } from './fields.ts';
import { searchPageQuery, versionField } from './http.ts';

/** One row of an item list; `itemSchema` extends it with the rest of the item. */
export const itemListEntrySchema = z.object({
  ...recordFields,
  code: z.string(),
  name: z.string(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  manufacturer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The location the item is in, and its path from the top. */
  location: codeRef,
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

/** An identifier the item has at another party, e.g. source "Elektrikář", value "EL-4821". */
export const externalIdSchema = z.strictObject({ source: requiredText(60), value: requiredText(120) });
export type ExternalIdDto = z.infer<typeof externalIdSchema>;

const itemFields = {
  name: requiredText(200),
  locationId: z.uuid(),
  manufacturerId: z.uuid().nullable(),
  model: nullableText(120),
  serialNumber: nullableText(120),
  manufactureYear: manufactureYear.nullable(),
  registeredOn: isoDate.nullable(),
  warrantyUntil: isoDate.nullable(),
  lastServiceOn: isoDate.nullable(),
  nextServiceOn: isoDate.nullable(),
  documentsUrl: documentsUrl.nullable(),
  note: nullableText(2000),
  /** At most 20 per item; a pair may not repeat, and may not belong to another item. */
  externalIds: z.array(externalIdSchema).max(20),
};

/** An item with everything the detail screen shows. Photos join with the photo routes. */
export const itemSchema = itemListEntrySchema.extend({
  manufactureYear: z.number().int().nullable(),
  registeredOn: isoDate.nullable(),
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
  warrantyUntil: true,
  lastServiceOn: true,
  nextServiceOn: true,
  documentsUrl: true,
  note: true,
  externalIds: true,
} as const;

export const createItemBody = z.strictObject(itemFields).partial(optionalItemFields);
export type CreateItemBody = z.infer<typeof createItemBody>;

/**
 * Only the fields present change; `null` clears one (not the name or the location). Sending
 * `externalIds` replaces the whole list, `[]` clears it.
 */
export const updateItemBody = z
  .strictObject({ ...itemFields, version: versionField })
  .partial({ name: true, locationId: true, ...optionalItemFields })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateItemBody = z.infer<typeof updateItemBody>;

/** `GET /items`: `locationId` includes everything below that location. */
export const itemSearchQuery = itemListQuery.extend({
  locationId: z.uuid().optional(),
  manufacturerId: z.uuid().optional(),
});
