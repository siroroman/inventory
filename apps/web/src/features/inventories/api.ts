import { queryOptions } from '@tanstack/react-query';
import { pathLabel } from '@/features/locations/path';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

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

export const inventoryItemsQueryKey = (id: string, locationId: string) =>
  ['inventories', 'items', id, locationId] as const;

/**
 * Every row of one location of a run (not paged: a location holds at most a few hundred). Fetched
 * again every few seconds while the run is in progress and its screen is visible, like the run.
 */
export const inventoryItemsQueryOptions = (id: string, locationId: string, inProgress: boolean) =>
  queryOptions({
    queryKey: inventoryItemsQueryKey(id, locationId),
    queryFn: () => unwrap(api.api.v1.inventories[':id'].items.$get({ param: { id }, query: { locationId } })),
    staleTime: 0,
    refetchInterval: inProgress ? inventoryPollMs : false,
  });

/** Ticks an item by hand. An item somebody else ticked first is left as it is; the answer says who. */
export const checkInventoryItem = (id: string, itemId: string) =>
  unwrap(api.api.v1.inventories[':id'].items[':itemId'].check.$post({ param: { id, itemId } }));

export const uncheckInventoryItem = (id: string, itemId: string) =>
  unwrap(api.api.v1.inventories[':id'].items[':itemId'].uncheck.$post({ param: { id, itemId } }));

/**
 * Checks an item by the code on its label. `locationId` is the checklist the scanner was opened
 * from (nothing for the overview). The answer says what happened, see `scanResultSchema`.
 */
export const scanInventory = (id: string, body: { code: string; locationId?: string }) =>
  unwrap(api.api.v1.inventories[':id'].scans.$post({ param: { id }, json: { ...body, method: 'scan' } }));

export const cancelInventory = (id: string, version: number) =>
  unwrap(api.api.v1.inventories[':id'].cancel.$post({ param: { id }, json: { version } }));

/** Ends a run in progress; the unchecked items of the list are marked missing. */
export const finishInventory = (id: string, version: number) =>
  unwrap(api.api.v1.inventories[':id'].finish.$post({ param: { id }, json: { version } }));

/** Takes a finished run back into progress; what the finish marked missing waits for a check again. */
export const reopenInventory = (id: string, version: number) =>
  unwrap(api.api.v1.inventories[':id'].reopen.$post({ param: { id }, json: { version } }));

export const archiveInventory = (id: string, version: number) =>
  unwrap(api.api.v1.inventories[':id'].archive.$post({ param: { id }, json: { version } }));

export const restoreInventory = (id: string, version: number) =>
  unwrap(api.api.v1.inventories[':id'].restore.$post({ param: { id }, json: { version } }));

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

/**
 * Pages of the runs in progress (`open`, newest start first) or the finished and cancelled ones
 * (`closed`, newest end first), or with `archived` the archived runs; `q` searches the root
 * location. Always fetched fresh, so the tab shows the others' runs when it is opened or focused.
 */
export const inventoryListQueryOptions = (state: 'open' | 'closed', q: string, archived = false) => ({
  ...pagedListQueryOptions(
    `inventories:${state}`,
    q,
    ({ q: search, archived: onlyArchived, cursor, limit }) =>
      unwrap(api.api.v1.inventories.$get({ query: { q: search, archived: onlyArchived, cursor, limit, state } })),
    archived,
  ),
  staleTime: 0,
});
