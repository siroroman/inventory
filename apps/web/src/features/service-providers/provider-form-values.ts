import {
  type CreateServiceProviderBody,
  type ServiceProviderDetailDto,
  serviceProviderEmail,
  serviceProviderWeb,
} from '@inventory/shared';
import { z } from 'zod';

// Messages are i18n keys; the form turns them into Czech. The API validates again with the shared
// schemas, so these only need to catch what the user can fix before sending.
const optionalText = (max: number) => z.string().trim().max(max, 'providerForm.errors.tooLong');
const picked = z.object({ id: z.string(), label: z.string() });

/** "novak-servis.cz" is meant as a web address: without a scheme, https is assumed. */
const withScheme = (address: string) => (/^[a-z][a-z\d+.-]*:/i.test(address) ? address : `https://${address}`);

export const providerFormSchema = z.object({
  name: z.string().trim().min(1, 'providerForm.errors.required').max(120, 'providerForm.errors.tooLong'),
  contactPerson: optionalText(120),
  phone: optionalText(40),
  // The shared rule would let "servis@novak" through; no real supplier's address lacks a dot after the @.
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (serviceProviderEmail.safeParse(v).success && v.split('@').at(-1)!.includes('.')),
      'providerForm.errors.email',
    ),
  web: z
    .string()
    .trim()
    .refine((v) => v === '' || serviceProviderWeb.safeParse(withScheme(v)).success, 'providerForm.errors.web'),
  note: optionalText(2000),
  /** The brands the provider services. */
  brands: z.array(picked).max(100),
});

/** What the form edits: every field is text (or the picked brands), an empty one means "none". */
export type ProviderFormValues = z.input<typeof providerFormSchema>;

export const emptyProviderForm: ProviderFormValues = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  web: '',
  note: '',
  brands: [],
};

export function providerToFormValues(provider: ServiceProviderDetailDto): ProviderFormValues {
  return {
    name: provider.name,
    contactPerson: provider.contactPerson ?? '',
    phone: provider.phone ?? '',
    email: provider.email ?? '',
    web: provider.web ?? '',
    note: provider.note ?? '',
    brands: provider.manufacturers.map(({ id, name }) => ({ id, label: name })),
  };
}

const orNull = (text: string) => text.trim() || null;

/** The API body for validated form values; an empty field becomes `null` (clears it on an edit). */
export function formValuesToBody(values: ProviderFormValues): CreateServiceProviderBody & { name: string } {
  return {
    name: values.name.trim(),
    contactPerson: orNull(values.contactPerson),
    phone: orNull(values.phone),
    email: orNull(values.email),
    web: values.web.trim() === '' ? null : withScheme(values.web.trim()),
    note: orNull(values.note),
    manufacturerIds: values.brands.map((brand) => brand.id),
  };
}

/**
 * Only what differs from the loaded supplier, so an edit never rewrites what it did not touch. The
 * brands count as one field and only as changed when the set differs, whatever the order they were
 * added in.
 */
export function changedFields(before: ProviderFormValues, after: ProviderFormValues) {
  const previous = formValuesToBody(before);
  const next = formValuesToBody(after);
  const sorted = (ids: string[] | undefined) => JSON.stringify([...(ids ?? [])].sort());
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) =>
      key === 'manufacturerIds'
        ? sorted(next.manufacturerIds) !== sorted(previous.manufacturerIds)
        : JSON.stringify(value) !== JSON.stringify(previous[key as keyof typeof previous]),
    ),
  );
}
