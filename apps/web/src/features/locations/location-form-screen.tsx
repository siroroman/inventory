import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { RouteNotFound, RoutePending } from '@/components/route-states';
import { useCanWrite } from '@/features/auth/use-can-write';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { locationQueryOptions } from './api';
import { LocationForm } from './location-form';
import { pathLabel } from './path';

/** What a failed load of one location means for a form screen. */
function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  // A stale link or a mistyped id: the page does not exist, retrying will not help.
  if (error instanceof ApiError && ['not_found', 'validation_error'].includes(error.code)) return <RouteNotFound />;
  return <ErrorState message={problemMessage(error)} onRetry={retry} />;
}

function Forbidden() {
  const { t } = useTranslation();
  return <ErrorState message={t('errors.forbidden')} />;
}

/** `/locations/new`, with `?parentId=` for a sub-location. */
export function NewLocation({ parentId }: { parentId: string | undefined }) {
  const canWrite = useCanWrite();
  const query = useQuery({ ...locationQueryOptions(parentId ?? ''), enabled: canWrite && parentId !== undefined });

  if (!canWrite) return <Forbidden />;
  if (parentId === undefined) return <LocationForm />;
  if (query.isPending) return <RoutePending />;
  if (query.isError) return <LoadError error={query.error} retry={() => void query.refetch()} />;
  const parent = query.data;
  if (parent.archivedAt) return <ErrorState message={problemMessage(new ApiError('parent_archived', 422))} />;
  return <LocationForm initialParent={{ id: parent.id, label: pathLabel(parent.path) }} />;
}

/** `/locations/$id/edit`. */
export function EditLocation({ id }: { id: string }) {
  const canWrite = useCanWrite();
  // Always ask the server: editing from a 30-second-old copy would only end in a conflict. The form
  // reads its data once, so it waits for the answer instead of starting from the cached copy.
  const [openedAt] = useState(Date.now);
  const query = useQuery({ ...locationQueryOptions(id), enabled: canWrite, refetchOnMount: 'always' });

  if (!canWrite) return <Forbidden />;
  if (query.isError) return <LoadError error={query.error} retry={() => void query.refetch()} />;
  if (query.isPending || query.dataUpdatedAt < openedAt) return <RoutePending />;
  if (query.data.archivedAt) return <ErrorState message={problemMessage(new ApiError('archived', 409))} />;
  return <LocationForm location={query.data} />;
}
