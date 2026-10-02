import {
  createServiceRecordBody,
  idParam,
  serviceRecordListQuery,
  serviceRecordListSchema,
  serviceRecordSchema,
  serviceRecordSearchListSchema,
  serviceRecordSearchQuery,
  updateServiceRecordBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toServiceRecordDto, toServiceRecordListEntryDto, toServiceRecordSummaryDto } from './dto.ts';
import type { ServiceRecordService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/service-records',
  minRole: 'read',
  tags: ['service-records'],
  summary: 'Service records of all items, newest first; `archived=true` lists the archived ones',
  request: { query: serviceRecordSearchQuery },
  responses: { 200: { description: 'One page of service records', content: jsonContent(serviceRecordSearchListSchema) } },
});

const listByItem = defineRoute({
  method: 'get',
  path: '/items/{id}/service-records',
  minRole: 'read',
  tags: ['service-records'],
  summary: "An item's active service records, newest first; an archived item lists its records too",
  request: { params: idParam, query: serviceRecordListQuery },
  errors: [404],
  responses: { 200: { description: 'One page of service records', content: jsonContent(serviceRecordListSchema) } },
});

const create = defineRoute({
  method: 'post',
  path: '/items/{id}/service-records',
  minRole: 'write',
  tags: ['service-records'],
  summary: 'Add a service record to an active item',
  request: { params: idParam, body: { required: true, content: jsonContent(createServiceRecordBody) } },
  errors: [404, 409],
  responses: { 201: { description: 'The new service record', content: jsonContent(serviceRecordSchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/service-records/{id}',
  minRole: 'read',
  tags: ['service-records'],
  summary: 'A service record with its item; archived ones too',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The service record', content: jsonContent(serviceRecordSchema) } },
});

const update = defineRoute({
  method: 'patch',
  path: '/service-records/{id}',
  minRole: 'write',
  tags: ['service-records'],
  summary: 'Edit a service record of an active item',
  request: { params: idParam, body: { required: true, content: jsonContent(updateServiceRecordBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The updated service record', content: jsonContent(serviceRecordSchema) } },
});

const archive = defineRoute({
  method: 'post',
  path: '/service-records/{id}/archive',
  minRole: 'write',
  tags: ['service-records'],
  summary: 'Archive a service record; it leaves the item history',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The archived service record', content: jsonContent(serviceRecordSchema) } },
});

const restore = defineRoute({
  method: 'post',
  path: '/service-records/{id}/restore',
  minRole: 'write',
  tags: ['service-records'],
  summary: 'Restore an archived service record',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The restored service record', content: jsonContent(serviceRecordSchema) } },
});

/** Service history of items. Mounted under /api/v1. */
export function createServiceRecordRoutes(serviceRecords: ServiceRecordService) {
  return createRouter()
    .openapi(list, async (c) => {
      const { q, archived, limit, cursor } = c.req.valid('query');
      const page = await serviceRecords.list(c.get('actor'), { q, archived: archived === 'true' }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toServiceRecordListEntryDto) }, 200);
    })
    .openapi(listByItem, async (c) => {
      const { limit, cursor } = c.req.valid('query');
      const page = await serviceRecords.listByItem(c.get('actor'), c.req.valid('param').id, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toServiceRecordSummaryDto) }, 200);
    })
    .openapi(create, async (c) => {
      const row = await serviceRecords.create(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toServiceRecordDto(row), 201);
    })
    .openapi(get, async (c) => {
      const row = await serviceRecords.get(c.get('actor'), c.req.valid('param').id);
      return c.json(toServiceRecordDto(row), 200);
    })
    .openapi(update, async (c) => {
      const row = await serviceRecords.update(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toServiceRecordDto(row), 200);
    })
    .openapi(archive, async (c) => {
      const row = await serviceRecords.archive(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toServiceRecordDto(row), 200);
    })
    .openapi(restore, async (c) => {
      const row = await serviceRecords.restore(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toServiceRecordDto(row), 200);
    });
}
