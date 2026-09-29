import { z } from 'zod';
import { nullableText, pageOf, recordFields, requiredText, searchQuery } from './fields.ts';
import { pageQuery, versionField } from './http.ts';

/** One step of a location's path from the top-level location down. */
export const pathSegmentSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
export type PathSegmentDto = z.infer<typeof pathSegmentSchema>;

export const locationSchema = z.object({
  ...recordFields,
  code: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  /** Set on top-level locations only. */
  type: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  /** From the top-level location down to this one, itself included. */
  path: z.array(pathSegmentSchema),
  /** Active items in this location and everything below it. */
  itemCount: z.number().int().min(0),
  /** Active direct sub-locations. */
  childCount: z.number().int().min(0),
});
export type LocationDto = z.infer<typeof locationSchema>;

export const locationListSchema = pageOf(locationSchema);

const locationFields = {
  name: requiredText(120),
  /** Empty for a top-level location. */
  parentId: z.uuid().nullable(),
  /** Required for a top-level location, not allowed for a sub-location. */
  locationTypeId: z.uuid().nullable(),
  address: nullableText(200),
  note: nullableText(2000),
};

export const createLocationBody = z.strictObject({
  ...locationFields,
  parentId: locationFields.parentId.optional(),
  locationTypeId: locationFields.locationTypeId.optional(),
  address: locationFields.address.optional(),
  note: locationFields.note.optional(),
});
export type CreateLocationBody = z.infer<typeof createLocationBody>;

/** Only the fields present change; `null` clears one. Moving under a parent drops the type. */
export const updateLocationBody = z
  .strictObject({ ...locationFields, version: versionField })
  .partial({ name: true, parentId: true, locationTypeId: true, address: true, note: true });
export type UpdateLocationBody = z.infer<typeof updateLocationBody>;

/**
 * `?parentId=` lists that location's direct children. Without it the list is the top-level
 * locations, or, when `q` is given, every level (to pick a location for an item).
 */
export const locationListQuery = pageQuery.extend({
  parentId: z.uuid().optional(),
  q: searchQuery.optional(),
});
