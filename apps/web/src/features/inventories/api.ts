import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';

/** How often a run in progress is fetched again, so everyone sees the others' checks. */
export const inventoryPollMs = 5000;

/**
 * One run with its counts, people and locations. A run in progress is fetched again every few
 * seconds while its screen is visible (TanStack pauses it in a hidden tab); an ended one never changes.
 */
export const inventoryQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['inventories', 'detail', id],
    queryFn: () => unwrap(api.api.v1.inventories[':id'].$get({ param: { id } })),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.status === 'in_progress' ? inventoryPollMs : false),
  });

export const cancelInventory = (id: string, version: number) =>
  unwrap(api.api.v1.inventories[':id'].cancel.$post({ param: { id }, json: { version } }));
