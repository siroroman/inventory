import { z } from 'zod';
import { hasChange, nullableText, pageOf, recordFields, requiredText, timestamp } from './fields.ts';
import { searchPageQuery, versionField } from './http.ts';

const manufacturerFields = {
  name: requiredText(120),
  note: nullableText(2000),
};

export const manufacturerSchema = z.object({ ...recordFields, name: manufacturerFields.name, note: manufacturerFields.note });
export type ManufacturerDto = z.infer<typeof manufacturerSchema>;

export const manufacturerListSchema = pageOf(manufacturerSchema);

/**
 * A service provider in a manufacturer's contact order. Archived providers stay ranked (and are
 * marked) until someone removes them from the order.
 */
export const rankedProviderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  web: z.string().nullable(),
  archivedAt: timestamp.nullable(),
  /** 1 is contacted first. */
  priority: z.number().int().min(1),
});
export type RankedProviderDto = z.infer<typeof rankedProviderSchema>;

export const rankedProviderListSchema = z.object({ items: z.array(rankedProviderSchema) });

/** A manufacturer with its service providers in the order to contact them. */
export const manufacturerDetailSchema = manufacturerSchema.extend({ providers: z.array(rankedProviderSchema) });
export type ManufacturerDetailDto = z.infer<typeof manufacturerDetailSchema>;

export const createManufacturerBody = z.strictObject(manufacturerFields).partial({ note: true });
export type CreateManufacturerBody = z.infer<typeof createManufacturerBody>;

/** Only the fields present change; `null` clears the note. */
export const updateManufacturerBody = z
  .strictObject({ ...manufacturerFields, version: versionField })
  .partial({ name: true, note: true })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateManufacturerBody = z.infer<typeof updateManufacturerBody>;

export const manufacturerListQuery = searchPageQuery;

/** The whole new order at once: the first id gets priority 1, an empty list clears the order. */
export const setProvidersBody = z.strictObject({ providerIds: z.array(z.uuid()).max(100) });
export type SetProvidersBody = z.infer<typeof setProvidersBody>;
