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
import { inventoryPreviewQueryOptions, inventoryRootPickerOptions, startInventory } from './api';
import { shortName } from './people';

/** What a run on the chosen location would check, or why it cannot start. */
function Preview({ locationId }: { locationId: string }) {
  const { t } = useTranslation();
  const query = useQuery(inventoryPreviewQueryOptions(locationId));

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

  const { itemCount, locationCount, overlap } = query.data;
  return (
    <>
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
  const preview = useQuery({ ...inventoryPreviewQueryOptions(location?.id ?? ''), enabled: location !== null });

  const start = useMutation({
    mutationFn: (locationId: string) => startInventory(locationId),
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
            }}
            search={inventoryRootPickerOptions}
            placeholder={t('inventoryStart.locationPlaceholder')}
            emptyText={t('inventoryStart.noLocations')}
          />
        </div>
        {location && <Preview locationId={location.id} />}
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
