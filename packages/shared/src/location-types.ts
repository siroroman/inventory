import { z } from 'zod';
import { recordFields, requiredText } from './fields.ts';
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
};

export const locationTypeSchema = z.object({ ...recordFields, ...typeFields });
export type LocationTypeDto = z.infer<typeof locationTypeSchema>;

export const createLocationTypeBody = z.strictObject({ ...typeFields, sortOrder: typeFields.sortOrder.optional() });
export type CreateLocationTypeBody = z.infer<typeof createLocationTypeBody>;

export const updateLocationTypeBody = z.strictObject({ ...typeFields, version: versionField }).partial({
  code: true,
  name: true,
  sortOrder: true,
});
export type UpdateLocationTypeBody = z.infer<typeof updateLocationTypeBody>;

/** `GET /location-types`: a handful of rows, so no paging. */
export const locationTypeListSchema = z.object({ items: z.array(locationTypeSchema) });
