import { infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { listPageSize } from '@/lib/query';

/**
 * Pages of locations by name. Without `q` these are the top-level locations; with it, matches at
 * every level. The previous search's rows stay while the next one loads.
 */
export const locationListQueryOptions = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['locations', 'list', { q }],
    queryFn: ({ pageParam }) =>
      unwrap(api.api.v1.locations.$get({ query: { q: q || undefined, cursor: pageParam, limit: String(listPageSize) } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
