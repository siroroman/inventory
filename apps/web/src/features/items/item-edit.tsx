import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { itemDetailQueryOptions } from './api';
import { ItemForm } from './item-form';

/** Shown to a user whose role may not change items (the API refuses them too). */
export function NoWriteAccess() {
  const { t } = useTranslation();
  return <ErrorState title={t('errors.forbidden')} />;
}

/** New item screen. */
export function ItemCreate() {
  // The route guard has loaded the session, so the role is known by now.
  return useCanWrite() ? <ItemForm /> : <NoWriteAccess />;
}

/** Edit item screen: loads the item (fresh, so the version is current), then the form. */
export function ItemEdit({ id }: { id: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery({ ...itemDetailQueryOptions(id), staleTime: 0, refetchOnWindowFocus: false });

  if (!canWrite) return <NoWriteAccess />;
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
    <div role="status" aria-label={t('states.loading')} className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
