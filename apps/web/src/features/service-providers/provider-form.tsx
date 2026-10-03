import type { ServiceProviderDetailDto } from '@inventory/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SearchPicker } from '@/components/search-picker';
import { Section } from '@/components/section';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createManufacturer, manufacturerPickerOptions } from '@/features/manufacturers/api';
import { ApiError } from '@/lib/api';
import { invalidateAfterWrite } from '@/lib/query';
import { problemMessage } from '@/lib/problem';
import { createProvider, updateProvider } from './api';
import {
  changedFields,
  emptyProviderForm,
  formValuesToBody,
  type ProviderFormValues,
  providerFormSchema,
  providerToFormValues,
} from './provider-form-values';

type Props = {
  /** The supplier being edited; missing = a new supplier. */
  provider?: ServiceProviderDetailDto;
  /** Called by "load current data" after a conflict; should refetch the supplier. */
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

type TextField = 'name' | 'contactPerson' | 'phone' | 'email' | 'web' | 'note';

/** Add or edit a supplier together with the brands it services. */
export function ProviderForm({ provider, onReload }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaults = provider ? providerToFormValues(provider) : emptyProviderForm;
  const saved = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProviderFormValues>({ resolver: zodResolver(providerFormSchema), defaultValues: defaults });

  // Leaving with unsaved changes asks first; a saved form is not "unsaved" any more.
  const unsaved = () => isDirty && !saved.current;

  const save = useMutation({
    mutationFn: async (values: ProviderFormValues) => {
      if (!provider) return createProvider(formValuesToBody(values));
      const changes = changedFields(defaults, values);
      // A change that trimming undoes (a trailing space) leaves nothing to send.
      if (Object.keys(changes).length === 0) return provider;
      return updateProvider(provider.id, { ...changes, version: provider.version });
    },
    // The form shows the failure itself, above the buttons.
    meta: { silentError: true },
    onSuccess: async (result) => {
      saved.current = true;
      // The brands' contact orders changed along with the supplier.
      await invalidateAfterWrite(queryClient);
      toast.success(t('common.saved'));
      await navigate({ to: '/service-providers/$id', params: { id: result.id }, replace: true });
    },
  });

  const fieldError = (message: string | undefined) => (message ? t(message as never) : undefined);
  const props = (name: TextField) => ({
    id: `provider-${name}`,
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `provider-${name}-error` : undefined,
    ...register(name),
  });

  const conflict = save.error instanceof ApiError && save.error.code === 'conflict';
  const cancelTo = provider
    ? ({ to: '/service-providers/$id', params: { id: provider.id } } as const)
    : ({ to: '/', search: { tab: 'suppliers' } } as const);

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => save.mutate(values))}
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4"
    >
      <UnsavedChangesGuard changed={unsaved} />
      <h1 className="pt-2 text-2xl font-semibold">{provider ? t('providerForm.editTitle') : t('providerForm.newTitle')}</h1>

      <Section>
        <Field id="provider-name" label={t('providerForm.fields.name')} error={fieldError(errors.name?.message)}>
          <Input {...props('name')} autoComplete="off" maxLength={120} placeholder={t('providerForm.namePlaceholder')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="provider-contactPerson"
            label={t('providerForm.fields.contactPerson')}
            error={fieldError(errors.contactPerson?.message)}
          >
            <Input {...props('contactPerson')} autoComplete="off" maxLength={120} />
          </Field>
          <Field id="provider-phone" label={t('providerForm.fields.phone')} error={fieldError(errors.phone?.message)}>
            <Input
              {...props('phone')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={40}
              placeholder={t('providerForm.phonePlaceholder')}
            />
          </Field>
          <Field id="provider-email" label={t('providerForm.fields.email')} error={fieldError(errors.email?.message)}>
            <Input {...props('email')} type="email" inputMode="email" autoComplete="off" maxLength={254} />
          </Field>
          <Field id="provider-web" label={t('providerForm.fields.web')} error={fieldError(errors.web?.message)}>
            <Input
              {...props('web')}
              type="text"
              inputMode="url"
              autoComplete="off"
              maxLength={2048}
              placeholder={t('providerForm.webPlaceholder')}
            />
          </Field>
        </div>

        <Controller
          control={control}
          name="brands"
          render={({ field }) => {
            const chosen = field.value;
            return (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="provider-brands">{t('providerForm.fields.brands')}</Label>
                <SearchPicker
                  id="provider-brands"
                  label={t('providerForm.fields.brands')}
                  value={null}
                  onChange={(brand) => {
                    if (brand && !chosen.some((c) => c.id === brand.id)) field.onChange([...chosen, brand]);
                  }}
                  search={(q) => manufacturerPickerOptions(q, chosen.map((c) => c.id))}
                  placeholder={t('providerForm.brandPlaceholder')}
                  emptyText={t('providerForm.noBrands')}
                  create={{
                    label: (name) => t('providerForm.createBrand', { name }),
                    exists: (name) => chosen.some((c) => c.label.toLowerCase() === name.toLowerCase()),
                    run: async (name) => {
                      const created = await createManufacturer(name);
                      void queryClient.invalidateQueries({ queryKey: ['manufacturers'] });
                      return created;
                    },
                  }}
                />
                {chosen.length > 0 && (
                  <ul aria-label={t('providerForm.fields.brands')} className="flex flex-wrap gap-2">
                    {chosen.map((brand) => (
                      <li
                        key={brand.id}
                        className="flex min-h-11 items-center gap-1 rounded-full bg-muted pl-3.5 text-sm font-semibold"
                      >
                        <span className="break-all">{brand.label}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          aria-label={t('providerForm.removeBrand', { name: brand.label })}
                          onClick={() => field.onChange(chosen.filter((c) => c.id !== brand.id))}
                        >
                          <X aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">{t('providerForm.brandsHint')}</p>
              </div>
            );
          }}
        />

        <Field id="provider-note" label={t('providerForm.fields.note')} error={fieldError(errors.note?.message)}>
          <Textarea {...props('note')} maxLength={2000} placeholder={t('providerForm.notePlaceholder')} />
        </Field>
      </Section>

      {save.isError && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-destructive">
          <p>{problemMessage(save.error)}</p>
          {conflict && onReload && (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              {t('providerForm.reload')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link {...cancelTo}>{t('providerForm.cancel')}</Link>
        </Button>
        <Button type="submit" disabled={save.isPending || save.isSuccess || (provider !== undefined && !isDirty)}>
          {save.isPending ? t('providerForm.saving') : t('providerForm.save')}
        </Button>
      </div>
    </form>
  );
}
