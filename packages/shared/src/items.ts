import { z } from 'zod';
import { codeRef, isoDate, pageOf, recordFields, searchQuery } from './fields.ts';
import { pageQuery } from './http.ts';

/** One row of an item list. The detail schema extends it when the item routes arrive. */
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

export const itemListQuery = pageQuery.extend({ q: searchQuery.optional() });
