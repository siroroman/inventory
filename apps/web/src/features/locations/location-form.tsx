import { zodResolver } from '@hookform/resolvers/zod';
import { type LocationDto, locationCode, locationLimits } from '@inventory/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { invalidateAfterWrite } from '@/lib/query';
import { createLocation, locationQueryOptions, locationTypesQueryOptions, updateLocation } from './api';
import { LocationPicker, type ParentChoice } from './location-picker';
import { pathLabel } from './path';

// Messages are i18n keys; the form turns them into Czech. The API checks the same limits again.
const formSchema = z
  .object({
    // Empty means "assign one for me"; a value must be one the API accepts (it upper-cases it).
    code: z
      .string()
      .trim()
      .refine((value) => value === '' || locationCode.safeParse(value).success, 'locationForm.codeInvalid'),
    parent: z.object({ id: z.uuid(), label: z.string() }).nullable(),
    name: z.string().trim().min(1, 'locationForm.nameRequired').max(locationLimits.name, 'locationForm.nameTooLong'),
    locationTypeId: z.string(),
    address: z.string().trim().max(locationLimits.address, 'locationForm.addressTooLong'),
    note: z.string().trim().max(locationLimits.note, 'locationForm.noteTooLong'),
  })
  // Only a top-level location has a type, and it must have one.
  .refine((values) => values.parent !== null || values.locationTypeId !== '', {
    path: ['locationTypeId'],
    message: 'locationForm.typeRequired',
  });
type FormValues = z.infer<typeof formSchema>;
// The API's name for a field (`issues[].path` of a 400) and the form field it belongs to.
const formFieldByApiPath = {
  code: 'code',
  name: 'name',
  parentId: 'parent',
  locationTypeId: 'locationTypeId',
  address: 'address',
  note: 'note',
} as const;

/** The form fields the API named in a `validation_error`, so the message can sit next to them. */
function refusedFields(error: unknown): (typeof formFieldByApiPath)[keyof typeof formFieldByApiPath][] {
  if (!(error instanceof ApiError) || error.code !== 'validation_error') return [];
  const issues = error.problem?.details?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: { path?: string }) => {
    const path = issue?.path;
    return typeof path === 'string' && Object.hasOwn(formFieldByApiPath, path)
      ? [formFieldByApiPath[path as keyof typeof formFieldByApiPath]]
      : [];
  });
}

type FieldMessage =
  | 'locationForm.fieldInvalid'
  | 'locationForm.codeInvalid'
  | 'locationForm.nameRequired'
  | 'locationForm.nameTooLong'
  | 'locationForm.typeRequired'
  | 'locationForm.addressTooLong'
  | 'locationForm.noteTooLong';

function valuesOf(location: LocationDto | undefined, parent: ParentChoice | null): FormValues {
  if (!location) return { code: '', parent, name: '', locationTypeId: '', address: '', note: '' };
  const above = location.path.slice(0, -1);
  return {
    code: location.code,
    parent: location.parentId ? { id: location.parentId, label: pathLabel(above) } : null,
    name: location.name,
    locationTypeId: location.type?.id ?? '',
    address: location.address ?? '',
    note: location.note ?? '',
  };
}

/**
 * The request body: empty text becomes `null`, and a sub-location never sends a type. The ID is not
 * part of it: it is added on creation only, since it is fixed afterwards.
 */
function bodyOf(values: FormValues) {
  return {
    name: values.name,
    parentId: values.parent?.id ?? null,
    locationTypeId: values.parent ? null : values.locationTypeId,
    address: values.address || null,
    note: values.note || null,
  };
}

type Props = {
  /** The location being edited; missing when adding one. */
  location?: LocationDto;
  /** The parent a new location starts under (the "Add sub-location" button); ignored when editing. */
  initialParent?: ParentChoice | null;
};

function FieldError({ id, children }: { id: string; children: string | undefined }) {
  return (
    children && (
      <p id={id} className="text-sm text-destructive">
        {children}
      </p>
    )
  );
}

/** Form to add a location or change one. On save it opens the location's detail. */
export function LocationForm({ location, initialParent = null }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const types = useQuery(locationTypesQueryOptions);
  // The version the form's values are based on; a reload after a conflict replaces it.
  const [version, setVersion] = useState(location?.version ?? 0);
  const saved = useRef(false);
  // Whether the last failure was put on specific fields (then the general alert would repeat it).
  const [marked, setMarked] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: valuesOf(location, location ? null : initialParent),
  });
  const topLevel = watch('parent') === null;

  // Leaving with unsaved changes asks first; a saved form is not "unsaved" any more.
  const unsaved = () => isDirty && !saved.current;

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = bodyOf(values);
      return location
        ? updateLocation(location.id, { ...body, version })
        : createLocation({ ...body, ...(values.code && { code: values.code }) }); // empty = assign one
    },
    // The form shows the failure itself, above the buttons.
    meta: { silentError: true },
    onMutate: () => setMarked(false),
    onError: (error) => {
      const fields = refusedFields(error);
      for (const field of fields) setError(field, { message: 'locationForm.fieldInvalid' });
      setMarked(fields.length > 0);
    },
    onSuccess: (result) => {
      saved.current = true;
      toast.success(t('common.saved'));
      // The detail opens with the saved data at once; every other cached list and path is stale.
      queryClient.setQueryData(locationQueryOptions(result.id).queryKey, result);
      void invalidateAfterWrite(queryClient);
      void navigate({ to: '/locations/$id', params: { id: result.id }, replace: true });
    },
  });

  // The ID that was refused as taken is marked on its field until it is changed.
  const codeRefused = save.error instanceof ApiError && save.error.code === 'duplicate_location_code';
  // An empty ID field means the database picked the ID: it ran into one chosen by hand earlier, so
  // the field has nothing to blame, and trying again takes the next number.
  const autoCodeClash = codeRefused && save.variables?.code === '';
  const codeTaken = codeRefused && !autoCodeClash && save.variables?.code === watch('code').trim();
  const conflict = save.error instanceof ApiError && save.error.code === 'conflict';
  const reload = async () => {
    if (!location) return;
    try {
      const fresh = await queryClient.fetchQuery({ ...locationQueryOptions(location.id), staleTime: 0 });
      reset(valuesOf(fresh, null));
      setVersion(fresh.version);
      save.reset();
    } catch (error) {
      toast.error(problemMessage(error));
    }
  };

  // Back to where the form came from: the location, its future parent, or the list.
  const cancelTo = location
    ? ({ to: '/locations/$id', params: { id: location.id } } as const)
    : initialParent
      ? ({ to: '/locations/$id', params: { id: initialParent.id } } as const)
      : ({ to: '/' } as const);

  const message = (key: FieldMessage | undefined, max: number) => key && t(key, { max });

  return (
    <div className="mx-auto w-full max-w-4xl pb-8">
      <UnsavedChangesGuard changed={unsaved} />
      <h1 className="px-4 pt-4 pb-4 text-xl font-semibold">
        {location ? t('locationForm.editTitle') : initialParent ? t('locationForm.createSubTitle') : t('locationForm.createTitle')}
      </h1>
      <form
        noValidate
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="mx-4 flex flex-col gap-4 rounded-lg border bg-card p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-code">{t('locationForm.code')}</Label>
          {location ? (
            // Fixed once created; shown so it can be read and copied.
            <Input id="location-code" value={location.code} readOnly disabled />
          ) : (
            <Input
              id="location-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              aria-invalid={errors.code || codeTaken ? true : undefined}
              aria-describedby="location-code-hint location-code-error"
              {...register('code')}
            />
          )}
          {!location && (
            <p id="location-code-hint" className="text-xs text-muted-foreground">
              {t('locationForm.codeHint')}
            </p>
          )}
          <FieldError id="location-code-error">
            {codeTaken ? t('locationForm.codeTaken') : message(errors.code?.message as FieldMessage | undefined, 0)}
          </FieldError>
        </div>

        {/* A new top-level location has no parent to choose; the picker is for editing and for "Add sub-location". */}
        {(location || initialParent) && (
          <>
            <Controller
              control={control}
              name="parent"
              render={({ field }) => (
                <LocationPicker value={field.value} onChange={field.onChange} excludeId={location?.id} />
              )}
            />
            <FieldError id="location-parent-error">
              {message(errors.parent?.message as FieldMessage | undefined, 0)}
            </FieldError>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-name">{t('locationForm.name')}</Label>
          <Input
            id="location-name"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'location-name-error' : undefined}
            {...register('name')}
          />
          <FieldError id="location-name-error">
            {message(errors.name?.message as FieldMessage | undefined, locationLimits.name)}
          </FieldError>
        </div>

        {topLevel && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location-type">{t('locationForm.type')}</Label>
            {types.isPending ? (
              <Skeleton className="h-11 w-full" />
            ) : types.isError ? (
              <Button type="button" variant="outline" onClick={() => void types.refetch()}>
                {t('common.retry')}
              </Button>
            ) : (
              <Select
                id="location-type"
                aria-invalid={errors.locationTypeId ? true : undefined}
                aria-describedby={errors.locationTypeId ? 'location-type-error' : undefined}
                {...register('locationTypeId')}
              >
                <option value="">{t('locationForm.typePlaceholder')}</option>
                {types.data.items.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            )}
            <FieldError id="location-type-error">
              {message(errors.locationTypeId?.message as FieldMessage | undefined, 0)}
            </FieldError>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-address">{t('locationForm.address')}</Label>
          <Input
            id="location-address"
            autoComplete="off"
            aria-invalid={errors.address ? true : undefined}
            aria-describedby={errors.address ? 'location-address-error' : undefined}
            {...register('address')}
          />
          <FieldError id="location-address-error">
            {message(errors.address?.message as FieldMessage | undefined, locationLimits.address)}
          </FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-note">{t('locationForm.note')}</Label>
          <Textarea
            id="location-note"
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? 'location-note-error' : undefined}
            {...register('note')}
          />
          <FieldError id="location-note-error">
            {message(errors.note?.message as FieldMessage | undefined, locationLimits.note)}
          </FieldError>
        </div>

        {save.isError && (!codeRefused || autoCodeClash) && !marked && (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-destructive">
            <p>{autoCodeClash ? t('locationForm.codeAutoClash') : problemMessage(save.error)}</p>
            {conflict && (
              <Button type="button" variant="outline" onClick={() => void reload()}>
                {t('locationForm.reload')}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link {...cancelTo}>{t('locationForm.cancel')}</Link>
          </Button>
          <Button type="submit" disabled={save.isPending || save.isSuccess}>
            {save.isPending ? t('locationForm.saving') : t('locationForm.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
