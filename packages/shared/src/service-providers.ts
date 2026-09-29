import { z } from 'zod';
import { hasChange, nullableText, pageOf, recordFields, requiredText, timestamp } from './fields.ts';
import { searchPageQuery, versionField } from './http.ts';

/** A valid address, internationalised ones included (`servis@příklad.cz`). */
const email = z.string().trim().max(254).pipe(z.email({ pattern: z.regexes.unicodeEmail }));

/**
 * A web link the SPA renders as an anchor: only http(s), so a `javascript:` link never gets in,
 * and no `user:pass@`, so `https://known-supplier.cz@elsewhere.test` cannot pose as a trusted host.
 */
const web = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/ }))
  .refine((link) => {
    // Runs even when the URL check failed, so an unparsable link is left to that check.
    const url = URL.canParse(link) ? new URL(link) : undefined;
    return !url?.username && !url?.password;
  });

const providerFields = {
  name: requiredText(120),
  contactPerson: nullableText(120),
  phone: nullableText(40),
  email: email.nullable(),
  web: web.nullable(),
  note: nullableText(2000),
};

export const serviceProviderSchema = z.object({
  ...recordFields,
  code: z.string(),
  ...providerFields,
});
export type ServiceProviderDto = z.infer<typeof serviceProviderSchema>;

export const serviceProviderListSchema = pageOf(serviceProviderSchema);

/** A brand the provider services, with this provider's priority for it (1 is contacted first). */
export const servicedBrandSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archivedAt: timestamp.nullable(),
  priority: z.number().int().min(1),
});
export type ServicedBrandDto = z.infer<typeof servicedBrandSchema>;

/** A provider with the brands it services. */
export const serviceProviderDetailSchema = serviceProviderSchema.extend({
  manufacturers: z.array(servicedBrandSchema),
});
export type ServiceProviderDetailDto = z.infer<typeof serviceProviderDetailSchema>;

const optionalFields = { contactPerson: true, phone: true, email: true, web: true, note: true } as const;

export const createServiceProviderBody = z.strictObject(providerFields).partial(optionalFields);
export type CreateServiceProviderBody = z.infer<typeof createServiceProviderBody>;

/** Only the fields present change; `null` clears a contact field or the note. */
export const updateServiceProviderBody = z
  .strictObject({ ...providerFields, version: versionField })
  .partial({ name: true, ...optionalFields })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateServiceProviderBody = z.infer<typeof updateServiceProviderBody>;

export const serviceProviderListQuery = searchPageQuery;

/**
 * The whole set of brands at once, based on the provider's `version`. A new brand ranks the
 * provider last for it; the order per brand is changed on the manufacturer. An empty list drops
 * the provider from every brand.
 */
export const setManufacturersBody = z.strictObject({
  version: versionField,
  manufacturerIds: z.array(z.uuid()).max(100),
});
export type SetManufacturersBody = z.infer<typeof setManufacturersBody>;
