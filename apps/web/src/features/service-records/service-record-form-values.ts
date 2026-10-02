import type { CreateServiceRecordBody, ServiceRecordDto } from '@inventory/shared';
import { z } from 'zod';

// Messages are i18n keys; the form turns them into Czech. The API validates again with the shared
// schemas, so these only need to catch what the user can fix before sending.
const optionalText = (max: number) => z.string().trim().max(max, 'serviceRecordForm.errors.tooLong');

export const serviceRecordFormSchema = z.object({
  performedOn: z
    .string()
    .min(1, 'serviceRecordForm.errors.required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceRecordForm.errors.date'),
  title: z.string().trim().min(1, 'serviceRecordForm.errors.required').max(200, 'serviceRecordForm.errors.tooLong'),
  performedBy: optionalText(200),
  responsiblePerson: optionalText(120),
  description: optionalText(4000),
});

/** What the form edits: every field is text, an empty optional one means "none". */
export type ServiceRecordFormValues = z.input<typeof serviceRecordFormSchema>;

/** Today as the date input wants it (`2026-10-02`), in the user's own time zone. */
export function today(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export const emptyServiceRecordForm = (): ServiceRecordFormValues => ({
  performedOn: today(),
  title: '',
  performedBy: '',
  responsiblePerson: '',
  description: '',
});

export function recordToFormValues(record: ServiceRecordDto): ServiceRecordFormValues {
  return {
    performedOn: record.performedOn,
    title: record.title,
    performedBy: record.performedBy ?? '',
    responsiblePerson: record.responsiblePerson ?? '',
    description: record.description ?? '',
  };
}

const orNull = (text: string) => text.trim() || null;

/** The API body for validated form values; an empty optional field becomes `null` (clears it on an edit). */
export function formValuesToBody(values: ServiceRecordFormValues): Required<CreateServiceRecordBody> {
  return {
    performedOn: values.performedOn,
    title: values.title.trim(),
    performedBy: orNull(values.performedBy),
    responsiblePerson: orNull(values.responsiblePerson),
    description: orNull(values.description),
  };
}

/** Only the fields whose value differs from the loaded record, so an edit never rewrites what it did not touch. */
export function changedFields(before: ServiceRecordFormValues, after: ServiceRecordFormValues) {
  const previous = formValuesToBody(before);
  const next = formValuesToBody(after);
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => value !== previous[key as keyof typeof previous]),
  );
}
