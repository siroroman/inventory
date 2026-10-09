import { queryOptions } from '@tanstack/react-query';
import { pathLabel } from '@/features/locations/path';
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

/**
 * Locations at every level matching `q`, each followed by those below it. The label is the name;
 * the hint tells equal names apart: the ID and the locations above.
 */
export const inventoryRootPickerOptions = (q: string) => ({
  queryKey: ['locations', 'inventory-picker', q] as const,
  queryFn: async () => {
    const query = q ? { q, withSubLocations: 'true' as const, limit: '20' } : { limit: '20' };
    const page = await unwrap(api.api.v1.locations.$get({ query }));
    return page.items.map((location) => ({
      id: location.id,
      label: location.name,
      hint: [location.code, pathLabel(location.path.slice(0, -1))].filter(Boolean).join(' · '),
    }));
  },
});

/** What a run on the location would check, and the run in progress it would clash with. Always fresh. */
export const inventoryPreviewQueryOptions = (locationId: string) =>
  queryOptions({
    queryKey: ['inventories', 'preview', locationId],
    queryFn: () => unwrap(api.api.v1.inventories.preview.$get({ query: { locationId } })),
    staleTime: 0,
  });

export const startInventory = (locationId: string) => unwrap(api.api.v1.inventories.$post({ json: { locationId } }));
