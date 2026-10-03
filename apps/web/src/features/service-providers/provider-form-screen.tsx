import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { useCanWrite } from '@/features/auth/use-can-write';
import { FormSkeleton, NoWriteAccess } from '@/features/items/item-edit';
import { isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { providerQueryOptions } from './api';
import { ProviderForm } from './provider-form';

/** New supplier screen. */
export function NewServiceProvider() {
  // The route guard has loaded the session, so the role is known by now.
  if (!useCanWrite()) return <NoWriteAccess />;
  return <ProviderForm />;
}

/** Edit supplier screen: loads the supplier (fresh, so the version is current), then the form. */
export function EditServiceProvider({ id }: { id: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery({
    ...providerQueryOptions(id),
    staleTime: 0,
    // A background refetch that brings a newer version would remount the form and drop what was typed.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!canWrite) return <NoWriteAccess />;
  // The detail offers no Edit for an archived supplier; a typed-in URL gets the same answer up front.
  if (query.data?.archivedAt) return <ErrorState title={t('errors.archived')} />;
  if (query.data) {
    // A new version (after "load current data") remounts the form with the fresh values.
    return <ProviderForm key={query.data.version} provider={query.data} onReload={() => void query.refetch()} />;
  }
  if (query.isError) {
    const missing = isMissingRecord(query.error);
    return missing ? (
      <ErrorState title={t('provider.notFoundTitle')} message={t('provider.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  }
  return <FormSkeleton />;
}
