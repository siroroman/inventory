import { pathLabel } from '@/features/locations/path';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { SearchBox } from '@/components/search-box';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';
import { labelLocationsQueryOptions } from './api';
import type { ChosenLocation } from './selection';

type Props = {
  location: ChosenLocation | null;
  /** Whether choosing another location throws away choices of step 2, so it asks first. */
  needsConfirm: boolean;
  onChoose: (location: ChosenLocation) => void;
};

/** Step 1: search for the location whose items get labels, or pick a top-level one. */
export function LocationStep({ location, needsConfirm, onChoose }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  // Changing a chosen location shows the search again; the choice stays until another one is picked.
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState<ChosenLocation | null>(null);
  const searching = location === null || changing;
  const query = useQuery({ ...labelLocationsQueryOptions(q), enabled: searching });

  const choose = (next: ChosenLocation) => {
    if (location && next.id === location.id) {
      setChanging(false);
      return;
    }
    if (location && needsConfirm) {
      setPending(next);
      return;
    }
    commit(next);
  };
  const commit = (next: ChosenLocation) => {
    onChoose(next);
    setChanging(false);
    setQ('');
    setPending(null);
  };

  return (
    <section aria-labelledby="labels-step-heading" className="flex flex-col gap-4">
      <h3 id="labels-step-heading" className="text-lg font-semibold">
        {t('labels.location.heading')}
      </h3>

      {location && !changing && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card p-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t('labels.location.chosen')}</p>
            <p className="text-[17px] font-semibold break-words">{location.name}</p>
            {location.path !== location.name && (
              <p className="text-sm break-words text-muted-foreground">
                {location.path.slice(0, location.path.length - location.name.length - 3)}
              </p>
            )}
            <p className="mt-1 text-sm">
              {location.code} · {t('labels.location.itemCount', { count: location.itemCount })}
            </p>
          </div>
          <Button variant="outline" onClick={() => setChanging(true)}>
            {t('labels.location.change')}
          </Button>
        </div>
      )}

      {searching && (
        <>
          <SearchBox
            value={q}
            onSearch={setQ}
            label={t('labels.location.searchLabel')}
            placeholder={t('labels.location.searchPlaceholder')}
          />
          {query.isError ? (
            <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : query.data === undefined ? (
            <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : query.data.items.length === 0 ? (
            <div className="rounded-xl border border-line bg-card px-6 py-8 text-center">
              <p className="font-semibold">{t('labels.location.nothingFound')}</p>
              <p className="text-sm text-muted-foreground">
                {q ? t('labels.location.nothingFoundHint') : t('labels.location.noLocations')}
              </p>
            </div>
          ) : (
            <ul aria-label={t('labels.location.results')} className="divide-y overflow-hidden rounded-xl border border-line bg-card">
              {query.data.items.map((row) => {
                const above = pathLabel(row.path.slice(0, -1));
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() =>
                        choose({
                          id: row.id,
                          code: row.code,
                          name: row.name,
                          path: pathLabel(row.path),
                          itemCount: row.itemCount,
                        })
                      }
                      className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold break-words">{row.name}</span>
                        {above && <span className="block text-sm break-words text-muted-foreground">{above}</span>}
                        <span className="block text-sm text-muted-foreground">
                          {row.code} · {t('labels.location.itemCount', { count: row.itemCount })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {query.data && query.data.nextCursor !== null && (
            <p className="text-sm text-muted-foreground">
              {t('labels.location.truncated', { shown: query.data.items.length, total: query.data.total })}
            </p>
          )}
        </>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('labels.location.changeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('labels.location.changeHint')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('labels.location.changeCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && commit(pending)}>
              {t('labels.location.changeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
