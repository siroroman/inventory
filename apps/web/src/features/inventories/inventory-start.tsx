import type { InventoryPreviewDto } from '@inventory/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Section } from '@/components/section';
import { type PickerOption, SearchPicker } from '@/components/search-picker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { NoWriteAccess } from '@/features/items/item-edit';
import { formatTimestamp } from '@/lib/format';
import { problemMessage } from '@/lib/problem';
import { invalidateAfterWrite } from '@/lib/query';
import { cn } from '@/lib/utils';
import { inventoryPreviewQueryOptions, inventoryRootPickerOptions, startInventory } from './api';
import { shortName } from './people';

/**
 * What to inventory (SPEC §9.3 rule 18): every item, or only those with an external ID of one of the
 * sources the location's items have, each with how many have one. Left out when no item has any.
 */
function ScopeChoice({
  sources,
  value,
  onChange,
}: {
  sources: InventoryPreviewDto['sources'];
  value: string | null;
  onChange: (source: string | null) => void;
}) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;
  const options = [
    { source: null, label: t('inventoryStart.scopeAll') },
    ...sources.map(({ source, itemCount }) => ({ source, label: t('inventoryStart.scopeSource', { source, count: itemCount }) })),
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t('inventoryStart.scopeLegend')}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <label key={option.source ?? ''} className="cursor-pointer">
            <input
              type="radio"
              name="inventory-scope"
              className="peer sr-only"
              checked={value === option.source}
              onChange={() => onChange(option.source)}
            />
            <span
              className={cn(
                'flex min-h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium',
                'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
                'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {value === null ? t('inventoryStart.scopeHintAll') : t('inventoryStart.scopeHintSource', { source: value })}
      </p>
    </fieldset>
  );
}

/** What a run on the chosen location would check in the chosen scope, or why it cannot start. */
function Preview({
  locationId,
  scopeSource,
  onScopeChange,
}: {
  locationId: string;
  scopeSource: string | null;
  onScopeChange: (source: string | null) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery(inventoryPreviewQueryOptions(locationId, scopeSource));

  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {problemMessage(query.error)}{' '}
        <button type="button" className="underline" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </button>
      </p>
    );
  }
  if (!query.data) return <Skeleton role="status" aria-label={t('states.loading')} className="h-5 w-72 max-w-full" />;

  const { itemCount, locationCount, sources, overlap } = query.data;
  return (
    <>
      <ScopeChoice sources={sources} value={scopeSource} onChange={onScopeChange} />
      {overlap && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-sm text-warning"
        >
          <p className="flex gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {overlap.startedBy
                ? t('inventoryStart.overlap', {
                    location: overlap.location.name,
                    who: shortName(overlap.startedBy),
                    date: formatTimestamp(overlap.startedAt),
                  })
                : t('inventoryStart.overlapNoWho', {
                    location: overlap.location.name,
                    date: formatTimestamp(overlap.startedAt),
                  })}
            </span>
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/inventories/$id" params={{ id: overlap.id }}>
              {t('inventoryStart.open')}
            </Link>
          </Button>
        </div>
      )}
      {itemCount === 0 ? (
        <div className="text-[15px]">
          <p className="font-semibold">{t('inventoryStart.noItems')}</p>
          <p className="text-muted-foreground">{t('inventoryStart.noItemsHint')}</p>
        </div>
      ) : (
        <p role="status" className="text-[15px]">
          {t('inventoryStart.willCheck', { count: itemCount })} {t('inventoryStart.inLocations', { count: locationCount })}.
        </p>
      )}
    </>
  );
}

/** Start a run: pick the location, see what it covers, start. */
export function NewInventory() {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [location, setLocation] = useState<PickerOption | null>(null);
  // Null: every item. The sources to choose from are the chosen location's, so a new location starts over.
  const [scopeSource, setScopeSource] = useState<string | null>(null);
  const preview = useQuery({ ...inventoryPreviewQueryOptions(location?.id ?? '', scopeSource), enabled: location !== null });

  const start = useMutation({
    mutationFn: (locationId: string) => startInventory(locationId, scopeSource),
    // The screen shows the failure itself, above the buttons.
    meta: { silentError: true },
    onSuccess: async (run) => {
      await invalidateAfterWrite(queryClient);
      toast.success(t('inventoryStart.started'));
      await navigate({ to: '/inventories/$id', params: { id: run.id }, replace: true });
    },
    // Somebody started a run first: the warning and its "Otevřít" belong on the screen now.
    onError: () => void queryClient.invalidateQueries({ queryKey: ['inventories', 'preview'] }),
  });

  // The route guard has loaded the session, so the role is known by now.
  if (!canWrite) return <NoWriteAccess />;

  const blocked = !preview.data || preview.data.overlap !== null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (location && !blocked) start.mutate(location.id);
      }}
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4"
    >
      <h1 className="pt-2 text-2xl font-semibold">{t('inventoryStart.title')}</h1>

      <Section>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inventory-location">{t('inventoryStart.location')}</Label>
          <SearchPicker
            id="inventory-location"
            label={t('inventoryStart.location')}
            value={location}
            onChange={(value) => {
              start.reset();
              setLocation(value);
              setScopeSource(null);
            }}
            search={inventoryRootPickerOptions}
            placeholder={t('inventoryStart.locationPlaceholder')}
            emptyText={t('inventoryStart.noLocations')}
          />
        </div>
        {location && (
          <Preview
            locationId={location.id}
            scopeSource={scopeSource}
            onScopeChange={(source) => {
              start.reset();
              setScopeSource(source);
            }}
          />
        )}
      </Section>

      {start.isError && (
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-destructive">
          <p>{problemMessage(start.error)}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link to="/" search={{ tab: 'inventory' }} replace>
            {t('inventoryStart.cancel')}
          </Link>
        </Button>
        <Button type="submit" disabled={location === null || blocked || start.isPending || start.isSuccess}>
          {start.isPending ? t('inventoryStart.submitting') : t('inventoryStart.submit')}
        </Button>
      </div>
    </form>
  );
}
