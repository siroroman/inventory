import type { CreateItemBody, ItemDetailDto } from '@inventory/shared';
import { documentsUrl, humanCode } from '@inventory/shared';
import { z } from 'zod';

// Messages are i18n keys; the form turns them into Czech. The API validates again with the shared
// schemas, so these only need to catch what the user can fix before sending.
const optionalText = (max: number) => z.string().trim().max(max, 'itemForm.errors.tooLong');
const optionalDate = z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'itemForm.errors.date');
const picked = z.object({ id: z.string(), label: z.string() });

export const itemFormSchema = z.object({
  // Only used on creation (empty = the database assigns INV-nnnnn); it never goes into an edit.
  code: z.string().refine((v) => v.trim() === '' || humanCode.safeParse(v).success, 'itemForm.errors.code'),
  name: z.string().trim().min(1, 'itemForm.errors.required').max(200, 'itemForm.errors.tooLong'),
  location: picked.nullable(),
  manufacturer: picked.nullable(),
  model: optionalText(120),
  serialNumber: optionalText(120),
  manufactureYear: z.string().refine((v) => {
    const year = v.trim();
    if (year === '') return true;
    return /^\d{4}$/.test(year) && Number(year) >= 1950 && Number(year) <= new Date().getFullYear();
  }, 'itemForm.errors.year'),
  registeredOn: optionalDate,
  warrantyUntil: optionalDate,
  lastServiceOn: optionalDate,
  nextServiceOn: optionalDate,
  documentsUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || documentsUrl.safeParse(v).success, 'itemForm.errors.documentsUrl'),
  note: optionalText(2000),
  externalIds: z
    .array(
      z.object({
        source: z.string().trim().max(60, 'itemForm.errors.tooLong'),
        value: z.string().trim().max(120, 'itemForm.errors.tooLong'),
      }),
    )
    .max(20)
    .superRefine((rows, ctx) => {
      rows.forEach((row, index) => {
        // A row with one half filled in is a mistake; a completely empty row is just dropped.
        if ((row.source === '') !== (row.value === '')) {
          ctx.addIssue({
            code: 'custom',
            path: [index, row.source === '' ? 'source' : 'value'],
            message: 'itemForm.errors.required',
          });
        }
      });
    }),
});

/** What the form edits: every field is text (or a picked record), an empty one means "none". */
export type ItemFormValues = z.input<typeof itemFormSchema>;

// One empty external ID row is shown so the field is there to type in; empty rows are not sent.
const emptyExternalId = { source: '', value: '' };

export const emptyItemForm: ItemFormValues = {
  code: '',
  name: '',
  location: null,
  manufacturer: null,
  model: '',
  serialNumber: '',
  manufactureYear: '',
  registeredOn: '',
  warrantyUntil: '',
  lastServiceOn: '',
  nextServiceOn: '',
  documentsUrl: '',
  note: '',
  externalIds: [emptyExternalId],
};

export function itemToFormValues(item: ItemDetailDto): ItemFormValues {
  return {
    code: item.code,
    name: item.name,
    location: item.location ? { id: item.location.id, label: item.path.map((p) => p.name).join(' › ') } : null,
    manufacturer: item.manufacturer ? { id: item.manufacturer.id, label: item.manufacturer.name } : null,
    model: item.model ?? '',
    serialNumber: item.serialNumber ?? '',
    manufactureYear: item.manufactureYear === null ? '' : String(item.manufactureYear),
    registeredOn: item.registeredOn ?? '',
    warrantyUntil: item.warrantyUntil ?? '',
    lastServiceOn: item.lastServiceOn ?? '',
    nextServiceOn: item.nextServiceOn ?? '',
    documentsUrl: item.documentsUrl ?? '',
    note: item.note ?? '',
    externalIds: item.externalIds.length > 0 ? item.externalIds.map(({ source, value }) => ({ source, value })) : [emptyExternalId],
  };
}

const orNull = (text: string) => text.trim() || null;

/** The API body for validated form values; an empty field becomes `null` (clears it on an edit). */
export function formValuesToBody(values: ItemFormValues): CreateItemBody & { name: string; locationId: string | null } {
  return {
    name: values.name.trim(),
    locationId: values.location?.id ?? null,
    manufacturerId: values.manufacturer?.id ?? null,
    model: orNull(values.model),
    serialNumber: orNull(values.serialNumber),
    manufactureYear: values.manufactureYear.trim() === '' ? null : Number(values.manufactureYear),
    registeredOn: orNull(values.registeredOn),
    warrantyUntil: orNull(values.warrantyUntil),
    lastServiceOn: orNull(values.lastServiceOn),
    nextServiceOn: orNull(values.nextServiceOn),
    documentsUrl: orNull(values.documentsUrl),
    note: orNull(values.note),
    externalIds: values.externalIds
      .filter((row) => row.source.trim() !== '')
      .map((row) => ({ source: row.source.trim(), value: row.value.trim() })),
  };
}

/** Only the fields whose value differs from the loaded item, so an edit never rewrites what it did not touch. */
export function changedFields(before: ItemFormValues, after: ItemFormValues) {
  const previous = formValuesToBody(before);
  const next = formValuesToBody(after);
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key as keyof typeof previous])),
  );
}
