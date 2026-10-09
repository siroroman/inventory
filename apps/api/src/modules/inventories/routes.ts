import {
  idParam,
  inventoryListQuery,
  inventoryListSchema,
  inventoryPreviewQuery,
  inventoryPreviewSchema,
  inventorySchema,
  startInventoryBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toInventoryDto, toInventoryListEntryDto, toInventoryPreviewDto } from './dto.ts';
import type { InventoryService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/inventories',
  minRole: 'read',
  tags: ['inventories'],
  summary: 'Inventory runs: `state=open` the ones in progress, `state=closed` the finished and cancelled ones',
  request: { query: inventoryListQuery },
  responses: { 200: { description: 'One page of runs', content: jsonContent(inventoryListSchema) } },
});

// Registered before `/inventories/{id}`, or the id would shadow it.
const preview = defineRoute({
  method: 'get',
  path: '/inventories/preview',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'What a run on a location would check, and the run in progress it would clash with',
  request: { query: inventoryPreviewQuery },
  errors: [422],
  responses: { 200: { description: 'Counts and the overlapping run', content: jsonContent(inventoryPreviewSchema) } },
});

const start = defineRoute({
  method: 'post',
  path: '/inventories',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Start a run on a location: takes the list of items to check',
  request: { body: { required: true, content: jsonContent(startInventoryBody) } },
  errors: [409, 422],
  responses: { 201: { description: 'The new run', content: jsonContent(inventorySchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/inventories/{id}',
  minRole: 'read',
  tags: ['inventories'],
  summary: 'A run with its counts, people and the locations it covers',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The run', content: jsonContent(inventorySchema) } },
});

const cancel = defineRoute({
  method: 'post',
  path: '/inventories/{id}/cancel',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Cancel a run in progress; nothing is marked missing and what was checked stays on record',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The cancelled run', content: jsonContent(inventorySchema) } },
});

/** Inventory runs. Mounted under /api/v1. */
export function createInventoryRoutes(inventories: InventoryService) {
  return createRouter()
    .openapi(list, async (c) => {
      const { state, q, limit, cursor } = c.req.valid('query');
      const page = await inventories.list(c.get('actor'), { state, q }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toInventoryListEntryDto) }, 200);
    })
    .openapi(preview, async (c) => {
      const result = await inventories.preview(c.get('actor'), c.req.valid('query').locationId);
      return c.json(toInventoryPreviewDto(result), 200);
    })
    .openapi(start, async (c) => {
      const row = await inventories.start(c.get('actor'), c.req.valid('json'));
      return c.json(toInventoryDto(row), 201);
    })
    .openapi(get, async (c) => {
      const row = await inventories.get(c.get('actor'), c.req.valid('param').id);
      return c.json(toInventoryDto(row), 200);
    })
    .openapi(cancel, async (c) => {
      const row = await inventories.cancel(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toInventoryDto(row), 200);
    });
}
