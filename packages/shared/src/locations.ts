import { z } from 'zod';
import { codeRef, humanCode, hasChange, nullableText, pageOf, recordFields, requiredText } from './fields.ts';
import { archivedQuery, searchPageQuery, versionField } from './http.ts';

export const locationSchema = z.object({
  ...recordFields,
  code: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  /** Set on top-level locations only. */
  type: codeRef.nullable(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  /** From the top-level location down to this one, itself included. */
  path: z.array(codeRef),
  /** Active items in this location and everything below it. */
  itemCount: z.number().int().min(0),
  /** Active direct sub-locations. */
  childCount: z.number().int().min(0),
});
export type LocationDto = z.infer<typeof locationSchema>;

export const locationListSchema = pageOf(locationSchema);

/** Longest text each field takes; the location form checks the same limits before sending. */
export const locationLimits = { name: 120, address: 200, note: 2000 } as const;

/** A location's human ID, chosen on creation and fixed afterwards. */
export const locationCode = humanCode;

const locationFields = {
  name: requiredText(locationLimits.name),
  /** Empty for a top-level location. */
  parentId: z.uuid().nullable(),
  /** Required for a top-level location, not allowed for a sub-location. */
  locationTypeId: z.uuid().nullable(),
  address: nullableText(locationLimits.address),
  note: nullableText(locationLimits.note),
};

/** `code` is optional: without it the database assigns the next LOC-nnn. */
export const createLocationBody = z
  .strictObject({ ...locationFields, code: locationCode })
  .partial({ code: true, parentId: true, locationTypeId: true, address: true, note: true });
export type CreateLocationBody = z.infer<typeof createLocationBody>;

/** Only the fields present change; `null` clears one. Moving under a parent drops the type. */
export const updateLocationBody = z
  .strictObject({ ...locationFields, version: versionField })
  .partial({ name: true, parentId: true, locationTypeId: true, address: true, note: true })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateLocationBody = z.infer<typeof updateLocationBody>;

/**
 * `?parentId=` lists that location's direct children. Without it the list is the top-level
 * locations, or, when `q` is given, every level (to pick a location for an item). With
 * `archived=true` it is the archived locations at every level, narrowed by `parentId` and `q`.
 */
export const locationListQuery = searchPageQuery.extend({ ...archivedQuery.shape, parentId: z.uuid().optional() });
