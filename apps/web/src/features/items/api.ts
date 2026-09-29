import { infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { listPageSize } from '@/lib/query';

/** Pages of items by name; `q` searches name, ID, serial number, external IDs, brand, model and location. */
export const itemListQueryOptions = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['items', 'list', { q }],
    queryFn: ({ pageParam }) =>
      unwrap(api.api.v1.items.$get({ query: { q: q || undefined, cursor: pageParam, limit: String(listPageSize) } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
