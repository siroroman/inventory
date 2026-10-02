import type { CreateServiceRecordBody, UpdateServiceRecordBody } from '@inventory/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of an item's active service records, newest first. */
export const itemServiceRecordsQueryOptions = (itemId: string) =>
  pagedListQueryOptions(`service-records:${itemId}`, '', ({ cursor, limit }) =>
    unwrap(api.api.v1.items[':id']['service-records'].$get({ param: { id: itemId }, query: { cursor, limit } })),
  );

/** One service record with its item; archived records included. */
export const serviceRecordQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['service-records', 'detail', id],
    queryFn: () => unwrap(api.api.v1['service-records'][':id'].$get({ param: { id } })),
  });

export const archiveServiceRecord = (id: string, version: number) =>
  unwrap(api.api.v1['service-records'][':id'].archive.$post({ param: { id }, json: { version } }));

export const restoreServiceRecord = (id: string, version: number) =>
  unwrap(api.api.v1['service-records'][':id'].restore.$post({ param: { id }, json: { version } }));

export const createServiceRecord = (itemId: string, json: CreateServiceRecordBody) =>
  unwrap(api.api.v1.items[':id']['service-records'].$post({ param: { id: itemId }, json }));

export const updateServiceRecord = (id: string, json: UpdateServiceRecordBody) =>
  unwrap(api.api.v1['service-records'][':id'].$patch({ param: { id }, json }));
