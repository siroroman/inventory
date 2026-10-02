import type { ServiceRecordDto } from '@inventory/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SearchPicker } from '@/components/search-picker';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { itemPickerOptions } from '@/features/items/api';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { invalidateAfterWrite } from '@/lib/query';
import { createServiceRecord, updateServiceRecord } from './api';
import {
  changedFields,
  emptyServiceRecordForm,
  formValuesToBody,
  recordToFormValues,
  type ServiceRecordFormValues,
  serviceRecordFormSchema,
} from './service-record-form-values';

type Props = {
  /** The item the record belongs to; missing on a new record, which then asks for the item (the Maintenance tab). */
  item?: { id: string; name: string };
  /** The record being edited; missing = a new record. */
  record?: ServiceRecordDto;
  /** Called by "load current data" after a conflict; should refetch the record. */
  onReload?: () => void;
};

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Add a service record to an item, or edit one. The item is fixed, except on a new record without one. */
export function ServiceRecordForm({ item, record, onReload }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaults = record
    ? recordToFormValues(record)
    : emptyServiceRecordForm(item ? { id: item.id, label: item.name } : null);
  const saved = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ServiceRecordFormValues>({ resolver: zodResolver(serviceRecordFormSchema), defaultValues: defaults });

  // Leaving with unsaved changes asks first; a saved form is not "unsaved" any more.
  const unsaved = () => isDirty && !saved.current;

  const save = useMutation({
    mutationFn: async (values: ServiceRecordFormValues) => {
      if (!record) return createServiceRecord(values.item!.id, formValuesToBody(values));
      const changes = changedFields(defaults, values);
      // A change that trimming undoes (a trailing space) leaves nothing to send.
      if (Object.keys(changes).length === 0) return record;
      return updateServiceRecord(record.id, { ...changes, version: record.version });
    },
    // The form shows the failure itself, above the buttons.
    meta: { silentError: true },
    onSuccess: async (result) => {
      saved.current = true;
      await invalidateAfterWrite(queryClient);
      toast.success(t('common.saved'));
      await navigate({ to: '/service-records/$id', params: { id: result.id } });
    },
  });

  const fieldError = (message: string | undefined) => (message ? t(message as never) : undefined);
  const props = (name: keyof ServiceRecordFormValues) => ({
    id: `service-record-${name}`,
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `service-record-${name}-error` : undefined,
    ...register(name),
  });

  const conflict = save.error instanceof ApiError && save.error.code === 'conflict';
  const cancelTo = record
    ? ({ to: '/service-records/$id', params: { id: record.id } } as const)
    : item
      ? ({ to: '/items/$id', params: { id: item.id } } as const)
      : ({ to: '/', search: { tab: 'maintenance' } } as const);

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => save.mutate(values))}
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4"
    >
      <UnsavedChangesGuard changed={unsaved} />
      <h1 className="pt-2 text-xl font-semibold">
        {record ? t('serviceRecordForm.editTitle') : t('serviceRecordForm.newTitle')}
      </h1>

      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        {item ? (
          <div>
            <p className="text-sm text-muted-foreground">{t('serviceRecord.fields.item')}</p>
            <p className="text-[15px]">{item.name}</p>
          </div>
        ) : (
          <Field
            id="service-record-item"
            label={t('serviceRecord.fields.item')}
            error={fieldError(errors.item?.message)}
          >
            <Controller
              control={control}
              name="item"
              render={({ field }) => (
                <SearchPicker
                  id="service-record-item"
                  label={t('serviceRecord.fields.item')}
                  value={field.value}
                  onChange={field.onChange}
                  search={itemPickerOptions}
                  placeholder={t('serviceRecordForm.itemPlaceholder')}
                  emptyText={t('serviceRecordForm.noItems')}
                  error={fieldError(errors.item?.message)}
                />
              )}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="service-record-performedOn"
            label={t('serviceRecord.fields.date')}
            error={fieldError(errors.performedOn?.message)}
          >
            <Input {...props('performedOn')} type="date" />
          </Field>
          <Field
            id="service-record-title"
            label={t('serviceRecord.fields.title')}
            error={fieldError(errors.title?.message)}
          >
            <Input {...props('title')} autoComplete="off" placeholder={t('serviceRecordForm.titlePlaceholder')} />
          </Field>
          <Field
            id="service-record-performedBy"
            label={t('serviceRecord.fields.performedBy')}
            error={fieldError(errors.performedBy?.message)}
          >
            <Input
              {...props('performedBy')}
              autoComplete="off"
              placeholder={t('serviceRecordForm.performedByPlaceholder')}
            />
          </Field>
          <Field
            id="service-record-responsiblePerson"
            label={t('serviceRecord.fields.responsiblePerson')}
            error={fieldError(errors.responsiblePerson?.message)}
          >
            <Input
              {...props('responsiblePerson')}
              autoComplete="off"
              placeholder={t('serviceRecordForm.responsiblePersonPlaceholder')}
            />
          </Field>
        </div>

        <Field
          id="service-record-description"
          label={t('serviceRecord.fields.description')}
          error={fieldError(errors.description?.message)}
        >
          <Textarea
            {...props('description')}
            maxLength={4000}
            rows={5}
            placeholder={t('serviceRecordForm.descriptionPlaceholder')}
          />
        </Field>
      </div>

      {save.isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-destructive"
        >
          <p>{problemMessage(save.error)}</p>
          {conflict && onReload && (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              {t('serviceRecordForm.reload')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link {...cancelTo}>{t('common.cancel')}</Link>
        </Button>
        <Button type="submit" disabled={save.isPending || save.isSuccess || (record !== undefined && !isDirty)}>
          {save.isPending ? t('serviceRecordForm.saving') : t('serviceRecordForm.save')}
        </Button>
      </div>
    </form>
  );
}
