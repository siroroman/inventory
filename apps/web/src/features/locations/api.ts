import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of locations by name: the top-level ones, or with `q` the matches at every level. */
export const locationListQueryOptions = (q: string) =>
  pagedListQueryOptions('locations', q, (query) => unwrap(api.api.v1.locations.$get({ query })));

/** One location with its path, counts and (top-level only) type; archived ones too. */
export const locationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['locations', 'detail', id],
    queryFn: () => unwrap(api.api.v1.locations[':id'].$get({ param: { id } })),
  });

/** Pages of the direct (active) sub-locations of a location. */
export const locationChildrenQueryOptions = (id: string) =>
  pagedListQueryOptions(`location-children:${id}`, '', (query) =>
    unwrap(api.api.v1.locations.$get({ query: { ...query, parentId: id } })),
  );

/** Pages of the items in a location and all its sub-locations. */
export const locationItemsQueryOptions = (id: string) =>
  pagedListQueryOptions(`location-items:${id}`, '', (query) =>
    unwrap(api.api.v1.locations[':id'].items.$get({ param: { id }, query })),
  );
