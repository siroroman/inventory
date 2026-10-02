import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { locationQueryOptions } from '@/features/locations/api';
import { itemDetailQueryOptions } from './api';
import { ItemForm } from './item-form';

/** Shown to a user whose role may not change items (the API refuses them too). */
export function NoWriteAccess() {
  const { t } = useTranslation();
  return <ErrorState title={t('errors.forbidden')} />;
}

/** New item screen; with `locationId` the item starts in that location. */
export function ItemCreate({ locationId }: { locationId?: string }) {
  const canWrite = useCanWrite();
  const location = useQuery({ ...locationQueryOptions(locationId ?? ''), enabled: canWrite && locationId !== undefined });
  // The route guard has loaded the session, so the role is known by now.
  if (!canWrite) return <NoWriteAccess />;
  if (locationId && location.isPending) return <FormSkeleton />;
  // A location that cannot be read (deleted link, archived) just leaves the field empty.
  const start = location.data && !location.data.archivedAt
    ? { id: location.data.id, label: location.data.path.map((p) => p.name).join(' › ') }
    : undefined;
  return <ItemForm initialLocation={start} />;
}

export function FormSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Edit item screen: loads the item (fresh, so the version is current), then the form. */
export function ItemEdit({ id }: { id: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery({ ...itemDetailQueryOptions(id), staleTime: 0,
    // A background refetch that brings a newer version would remount the form and drop what was typed.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!canWrite) return <NoWriteAccess />;
  // The detail offers no Edit for an archived item; a typed-in URL gets the same answer up front.
  if (query.data?.archivedAt) return <ErrorState title={t('errors.archived')} />;
  if (query.data) {
    // A new version (after "load current data") remounts the form with the fresh values.
    return <ItemForm key={query.data.version} item={query.data} onReload={() => void query.refetch()} />;
  }
  if (query.isError) {
    const missing =
      query.error instanceof ApiError && (query.error.code === 'not_found' || query.error.code === 'validation_error');
    return missing ? (
      <ErrorState title={t('item.notFoundTitle')} message={t('item.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  }
  return (
    <div role="status" aria-label={t('states.loading')} className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
