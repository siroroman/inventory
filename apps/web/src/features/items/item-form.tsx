import type { ItemDetailDto } from '@inventory/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SearchPicker } from '@/components/search-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import {
  createItem,
  createManufacturer,
  locationPickerOptions,
  manufacturerPickerOptions,
  updateItem,
} from './api';
import {
  changedFields,
  emptyItemForm,
  formValuesToBody,
  type ItemFormValues,
  itemFormSchema,
  itemToFormValues,
} from './item-form-values';

type Props = {
  /** The item being edited; missing = a new item. */
  item?: ItemDetailDto;
  /** Called by "load current data" after a conflict; should refetch the item. */
  onReload?: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <legend className="-mx-1 px-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

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

/** Add or edit an item. Photos are not part of it yet. */
export function ItemForm({ item, onReload }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaults = item ? itemToFormValues(item) : emptyItemForm;
  const saved = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ItemFormValues>({ resolver: zodResolver(itemFormSchema), defaultValues: defaults });
  const externalIds = useFieldArray({ control, name: 'externalIds' });

  // Leaving with unsaved changes asks first (in-app navigation and closing the tab).
  useBlocker({
    shouldBlockFn: () => isDirty && !saved.current && !window.confirm(t('itemForm.discardConfirm')),
    enableBeforeUnload: () => isDirty && !saved.current,
  });

  const save = useMutation({
    mutationFn: async (values: ItemFormValues) => {
      if (!item) return createItem(formValuesToBody(values));
      const changes = changedFields(defaults, values);
      // A change that trimming undoes (a trailing space) leaves nothing to send.
      if (Object.keys(changes).length === 0) return item;
      return updateItem(item.id, { ...changes, version: item.version });
    },
    // The form shows the failure itself, above the buttons.
    meta: { silentError: true },
    onSuccess: async (saved_) => {
      saved.current = true;
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      // Item counts of the locations changed too.
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
      toast.success(t('common.saved'));
      await navigate({ to: '/items/$id', params: { id: saved_.id } });
    },
  });

  const fieldError = (message: string | undefined) => (message ? t(message as never) : undefined);
  const props = (name: 'name' | 'model' | 'serialNumber' | 'manufactureYear' | 'documentsUrl' | 'registeredOn' | 'warrantyUntil' | 'lastServiceOn' | 'nextServiceOn' | 'note') => ({
    id: `item-${name}`,
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `item-${name}-error` : undefined,
    ...register(name),
  });

  const conflict = save.error instanceof ApiError && save.error.code === 'conflict';
  const cancelTo = item ? ({ to: '/items/$id', params: { id: item.id } } as const) : ({ to: '/', search: { tab: 'items' } } as const);

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => save.mutate(values))}
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4"
    >
      <h1 className="text-xl font-semibold">{item ? t('itemForm.editTitle') : t('itemForm.newTitle')}</h1>

      <Section title={t('item.sections.basic')}>
        <Field id="item-name" label={t('item.fields.name')} error={fieldError(errors.name?.message)}>
          <Input {...props('name')} autoComplete="off" maxLength={200} />
        </Field>

        <Field id="item-location" label={t('item.fields.location')} error={fieldError(errors.location?.message)}>
          <Controller
            control={control}
            name="location"
            render={({ field }) => (
              <SearchPicker
                id="item-location"
                label={t('item.fields.location')}
                value={field.value}
                onChange={field.onChange}
                search={locationPickerOptions}
                placeholder={t('itemForm.locationPlaceholder')}
                emptyText={t('itemForm.noLocations')}
                error={fieldError(errors.location?.message)}
              />
            )}
          />
        </Field>

        <Field id="item-manufacturer" label={t('item.fields.manufacturer')}>
          <Controller
            control={control}
            name="manufacturer"
            render={({ field }) => (
              <SearchPicker
                id="item-manufacturer"
                label={t('item.fields.manufacturer')}
                value={field.value}
                onChange={field.onChange}
                search={manufacturerPickerOptions}
                placeholder={t('itemForm.manufacturerPlaceholder')}
                emptyText={t('itemForm.noManufacturers')}
                create={{
                  label: (name) => t('itemForm.createManufacturer', { name }),
                  run: async (name) => {
                    const created = await createManufacturer(name);
                    void queryClient.invalidateQueries({ queryKey: ['manufacturers'] });
                    return created;
                  },
                }}
              />
            )}
          />
        </Field>

        <Field id="item-model" label={t('item.fields.model')} error={fieldError(errors.model?.message)}>
          <Input {...props('model')} autoComplete="off" maxLength={120} />
        </Field>
        <Field id="item-serialNumber" label={t('item.fields.serialNumber')} error={fieldError(errors.serialNumber?.message)}>
          <Input {...props('serialNumber')} autoComplete="off" maxLength={120} />
        </Field>
        <Field id="item-manufactureYear" label={t('item.fields.manufactureYear')} error={fieldError(errors.manufactureYear?.message)}>
          <Input {...props('manufactureYear')} inputMode="numeric" autoComplete="off" maxLength={4} />
        </Field>

        <div className="flex flex-col gap-2">
          <Label id="item-externalIds-label">{t('item.fields.externalIds')}</Label>
          <ul aria-labelledby="item-externalIds-label" className="flex flex-col gap-3">
            {externalIds.fields.map((row, index) => {
              const rowErrors = errors.externalIds?.[index];
              return (
                <li key={row.id} className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <Input
                        aria-label={t('itemForm.externalSource', { n: index + 1 })}
                        placeholder={t('itemForm.externalSourcePlaceholder')}
                        maxLength={60}
                        autoComplete="off"
                        aria-invalid={rowErrors?.source ? true : undefined}
                        {...register(`externalIds.${index}.source`)}
                      />
                      {rowErrors?.source && <p className="text-sm text-destructive">{fieldError(rowErrors.source.message)}</p>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Input
                        aria-label={t('itemForm.externalValue', { n: index + 1 })}
                        placeholder={t('itemForm.externalValuePlaceholder')}
                        maxLength={120}
                        autoComplete="off"
                        aria-invalid={rowErrors?.value ? true : undefined}
                        {...register(`externalIds.${index}.value`)}
                      />
                      {rowErrors?.value && <p className="text-sm text-destructive">{fieldError(rowErrors.value.message)}</p>}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('itemForm.removeExternalId', { n: index + 1 })}
                    onClick={() => externalIds.remove(index)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
          {externalIds.fields.length < 20 && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => externalIds.append({ source: '', value: '' })}
            >
              <Plus aria-hidden />
              {t('itemForm.addExternalId')}
            </Button>
          )}
        </div>

        <Field id="item-documentsUrl" label={t('itemForm.documentsUrl')} error={fieldError(errors.documentsUrl?.message)}>
          <Input {...props('documentsUrl')} type="url" inputMode="url" autoComplete="off" placeholder="https://drive.google.com/…" />
        </Field>
      </Section>

      <Section title={t('itemForm.sections.registration')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="item-registeredOn" label={t('item.fields.registeredOn')} error={fieldError(errors.registeredOn?.message)}>
            <Input {...props('registeredOn')} type="date" />
          </Field>
          <Field id="item-warrantyUntil" label={t('item.fields.warrantyUntil')} error={fieldError(errors.warrantyUntil?.message)}>
            <Input {...props('warrantyUntil')} type="date" />
          </Field>
          <Field id="item-lastServiceOn" label={t('item.fields.lastServiceOn')} error={fieldError(errors.lastServiceOn?.message)}>
            <Input {...props('lastServiceOn')} type="date" />
          </Field>
          <Field id="item-nextServiceOn" label={t('item.fields.nextServiceOn')} error={fieldError(errors.nextServiceOn?.message)}>
            <Input {...props('nextServiceOn')} type="date" />
          </Field>
        </div>
      </Section>

      <Section title={t('item.sections.note')}>
        <Field id="item-note" label={t('item.sections.note')} error={fieldError(errors.note?.message)}>
          <Textarea {...props('note')} maxLength={2000} />
        </Field>
      </Section>

      {save.isError && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-destructive">
          <p>{problemMessage(save.error)}</p>
          {conflict && onReload && (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              {t('itemForm.reload')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link {...cancelTo}>{t('itemForm.cancel')}</Link>
        </Button>
        <Button type="submit" disabled={save.isPending || save.isSuccess || (item !== undefined && !isDirty)}>
          {save.isPending ? t('itemForm.saving') : t('itemForm.save')}
        </Button>
      </div>
    </form>
  );
}
