import { z } from 'zod';
import { hasChange, recordFields, requiredText } from './fields.ts';
import { versionField } from './http.ts';

/** A short upper-case key such as `HQ` or `WAREHOUSE`; it identifies the type in code and never changes. */
const typeCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{0,19}$/);

const typeFields = {
  code: typeCode,
  name: requiredText(50),
  sortOrder: z.number().int().min(0).max(1000),
  /** Whether locations of this type are divided into sub-locations (Centrála, Provozovna); a shop is not. */
  allowsSubLocations: z.boolean(),
};

export const locationTypeSchema = z.object({ ...recordFields, ...typeFields });
export type LocationTypeDto = z.infer<typeof locationTypeSchema>;

/** Without `allowsSubLocations` a new type does not allow them. */
export const createLocationTypeBody = z.strictObject({
  ...typeFields,
  sortOrder: typeFields.sortOrder.optional(),
  allowsSubLocations: typeFields.allowsSubLocations.optional(),
});
export type CreateLocationTypeBody = z.infer<typeof createLocationTypeBody>;

/** The code is chosen on creation and stays; the name, the order and the sub-location rule change. */
export const updateLocationTypeBody = z
  .strictObject({
    name: typeFields.name,
    sortOrder: typeFields.sortOrder,
    allowsSubLocations: typeFields.allowsSubLocations,
    version: versionField,
  })
  .partial({ name: true, sortOrder: true, allowsSubLocations: true })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateLocationTypeBody = z.infer<typeof updateLocationTypeBody>;

/** `GET /location-types`: a handful of rows, so no paging. */
export const locationTypeListSchema = z.object({ items: z.array(locationTypeSchema) });
