import type { CreateServiceProviderBody, UpdateServiceProviderBody } from '@inventory/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of the service providers by name (the archived ones with `archived`); `q` searches name, ID and phone. */
export const providerListQueryOptions = (q: string, archived = false) =>
  pagedListQueryOptions('service-providers', q, (query) => unwrap(api.api.v1['service-providers'].$get({ query })), archived);

/** One provider with the brands it services; archived providers included. */
export const providerQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['service-providers', 'detail', id],
    queryFn: () => unwrap(api.api.v1['service-providers'][':id'].$get({ param: { id } })),
  });

export const archiveProvider = (id: string, version: number) =>
  unwrap(api.api.v1['service-providers'][':id'].archive.$post({ param: { id }, json: { version } }));

export const restoreProvider = (id: string, version: number) =>
  unwrap(api.api.v1['service-providers'][':id'].restore.$post({ param: { id }, json: { version } }));

export const createProvider = (json: CreateServiceProviderBody) =>
  unwrap(api.api.v1['service-providers'].$post({ json }));

export const updateProvider = (id: string, json: UpdateServiceProviderBody) =>
  unwrap(api.api.v1['service-providers'][':id'].$patch({ param: { id }, json }));
