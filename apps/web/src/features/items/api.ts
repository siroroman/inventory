import type { CreateItemBody, UpdateItemBody } from '@inventory/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of items by name; `q` searches name, ID, serial number, external IDs, brand, model and location. */
export const itemListQueryOptions = (q: string) =>
  pagedListQueryOptions('items', q, (query) => unwrap(api.api.v1.items.$get({ query })));

/** One item with its photos (signed read links, valid for 15 minutes); archived items included. */
export const itemDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['items', 'detail', id],
    queryFn: () => unwrap(api.api.v1.items[':id'].$get({ param: { id } })),
  });

/** Locations at every level matching `q` (the top-level ones without it), labelled with their full path. */
export const locationPickerOptions = (q: string) => ({
  queryKey: ['locations', 'item-picker', q] as const,
  queryFn: async () => {
    const page = await unwrap(api.api.v1.locations.$get({ query: { q: q || undefined, limit: '20' } }));
    return page.items.map((location) => ({ id: location.id, label: location.path.map((p) => p.name).join(' › ') }));
  },
});

/** Manufacturers matching `q`. */
export const manufacturerPickerOptions = (q: string) => ({
  queryKey: ['manufacturers', 'item-picker', q] as const,
  queryFn: async () => {
    const page = await unwrap(api.api.v1.manufacturers.$get({ query: { q: q || undefined, limit: '20' } }));
    return page.items.map((manufacturer) => ({ id: manufacturer.id, label: manufacturer.name }));
  },
});

export async function createManufacturer(name: string) {
  const created = await unwrap(api.api.v1.manufacturers.$post({ json: { name } }));
  return { id: created.id, label: created.name };
}

export const createItem = (json: CreateItemBody) => unwrap(api.api.v1.items.$post({ json }));

export const updateItem = (id: string, json: UpdateItemBody) =>
  unwrap(api.api.v1.items[':id'].$patch({ param: { id }, json }));

export const archiveItem = (id: string, version: number) =>
  unwrap(api.api.v1.items[':id'].archive.$post({ param: { id }, json: { version } }));

export const restoreItem = (id: string, version: number) =>
  unwrap(api.api.v1.items[':id'].restore.$post({ param: { id }, json: { version } }));
