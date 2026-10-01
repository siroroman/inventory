import type { CreateLocationBody, UpdateLocationBody } from '@inventory/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/**
 * Pages of locations by name: the top-level ones, or with `q` the matches at every level. With
 * `archived`, the archived ones at every level.
 */
export const locationListQueryOptions = (q: string, archived = false) =>
  pagedListQueryOptions('locations', q, (query) => unwrap(api.api.v1.locations.$get({ query })), archived);

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

/** The location types for the form's select: a handful of rows, so no paging. */
export const locationTypesQueryOptions = queryOptions({
  queryKey: ['location-types'],
  queryFn: () => unwrap(api.api.v1['location-types'].$get()),
});

/** The first page of candidates for a parent: top-level locations, or matches at every level with `q`. */
export const locationPickerQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ['locations', 'picker', q],
    queryFn: () => unwrap(api.api.v1.locations.$get({ query: { q: q || undefined, limit: '20' } })),
  });

export const createLocation = (body: CreateLocationBody) => unwrap(api.api.v1.locations.$post({ json: body }));

export const updateLocation = (id: string, body: UpdateLocationBody) =>
  unwrap(api.api.v1.locations[':id'].$patch({ param: { id }, json: body }));

export const archiveLocation = (id: string, version: number) =>
  unwrap(api.api.v1.locations[':id'].archive.$post({ param: { id }, json: { version } }));

export const restoreLocation = (id: string, version: number) =>
  unwrap(api.api.v1.locations[':id'].restore.$post({ param: { id }, json: { version } }));
