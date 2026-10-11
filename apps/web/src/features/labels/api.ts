import { MAX_LABELS } from '@inventory/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';

/** Step 1: the top-level locations, or with `q` the matches at every level with everything below them. */
export const labelLocationsQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ['locations', 'label-picker', q],
    queryFn: () =>
      unwrap(
        api.api.v1.locations.$get({
          query: q ? { q, withSubLocations: 'true', limit: '20' } : { limit: '20' },
        }),
      ),
  });

/** Step 2: every active item of a location and its subtree (at most 1 000), and how many there are. */
export const locationLabelsQueryOptions = (locationId: string) =>
  queryOptions({
    queryKey: ['items', 'labels', 'location', locationId],
    queryFn: () => unwrap(api.api.v1.items.labels.$get({ query: { locationId, limit: String(MAX_LABELS) } })),
  });

/** Step 2: the quick add searches the whole inventory. */
export const quickAddQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ['items', 'labels', 'search', q],
    queryFn: () => unwrap(api.api.v1.items.labels.$get({ query: { q, limit: '20' } })),
  });
