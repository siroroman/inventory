import {
  idParam,
  inventoryListQuery,
  inventoryListSchema,
  inventoryPreviewQuery,
  inventoryPreviewSchema,
  inventoryRowParams,
  inventoryRowSchema,
  inventoryRowsQuery,
  inventoryRowsSchema,
  inventorySchema,
  scanInventoryBody,
  scanResultSchema,
  startInventoryBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import {
  toInventoryDto,
  toInventoryListEntryDto,
  toInventoryPreviewDto,
  toInventoryRowDto,
  toScanResultDto,
} from './dto.ts';
import type { InventoryService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/inventories',
  minRole: 'read',
  tags: ['inventories'],
  summary:
    'Inventory runs: `state=open` the ones in progress, `state=closed` the finished and cancelled ones; ' +
    '`archived=true` lists the archived ones instead',
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

const listItems = defineRoute({
  method: 'get',
  path: '/inventories/{id}/items',
  minRole: 'read',
  tags: ['inventories'],
  summary: 'The rows of a run, or of one of its locations (`locationId`): not paged, by item name',
  request: { params: idParam, query: inventoryRowsQuery },
  errors: [404],
  responses: { 200: { description: 'The rows a person sees in the run', content: jsonContent(inventoryRowsSchema) } },
});

const scan = defineRoute({
  method: 'post',
  path: '/inventories/{id}/scans',
  minRole: 'write',
  tags: ['inventories'],
  summary:
    'Check an item of a run in progress by the code on its label. The answer says what happened (`outcome`): ' +
    'an item that is not on the list is added to the run as found elsewhere',
  request: { params: idParam, body: { required: true, content: jsonContent(scanInventoryBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'What the scan did', content: jsonContent(scanResultSchema) } },
});

const check = defineRoute({
  method: 'post',
  path: '/inventories/{id}/items/{itemId}/check',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Tick an item of a run in progress by hand; an item that is already checked is left as it is',
  request: { params: inventoryRowParams },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The row, with who checked it and when', content: jsonContent(inventoryRowSchema) } },
});

const uncheck = defineRoute({
  method: 'post',
  path: '/inventories/{id}/items/{itemId}/uncheck',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Untick an item of a run in progress; an item found elsewhere or added drops out of the run',
  request: { params: inventoryRowParams },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The row, unchecked', content: jsonContent(inventoryRowSchema) } },
});

const markMissing = defineRoute({
  method: 'post',
  path: '/inventories/{id}/items/{itemId}/mark-missing',
  minRole: 'write',
  tags: ['inventories'],
  summary:
    'Flag an unchecked item of the list of a run in progress as missing; an item that is already checked is left ' +
    'as it is, and an item found elsewhere or added cannot be flagged',
  request: { params: inventoryRowParams },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The row, flagged as missing', content: jsonContent(inventoryRowSchema) } },
});

const unmarkMissing = defineRoute({
  method: 'post',
  path: '/inventories/{id}/items/{itemId}/unmark-missing',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Take the missing flag of an item of a run in progress back; the item is not checked',
  request: { params: inventoryRowParams },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The row, not flagged', content: jsonContent(inventoryRowSchema) } },
});

const cancel = defineRoute({
  method: 'post',
  path: '/inventories/{id}/cancel',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Cancel a run in progress; nothing more is marked missing and what was checked or flagged stays on record',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The cancelled run', content: jsonContent(inventorySchema) } },
});

const finish = defineRoute({
  method: 'post',
  path: '/inventories/{id}/finish',
  minRole: 'write',
  tags: ['inventories'],
  summary:
    'Finish a run in progress: the items flagged as missing are the ones missing, the other unchecked ones ' +
    'stay not checked, and nothing can be checked afterwards',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The finished run', content: jsonContent(inventorySchema) } },
});

const reopen = defineRoute({
  method: 'post',
  path: '/inventories/{id}/reopen',
  minRole: 'write',
  tags: ['inventories'],
  summary:
    'Take a finished run back into progress; checks and missing flags stay. ' +
    'Refused while another run is in progress on the location',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The reopened run', content: jsonContent(inventorySchema) } },
});

const archive = defineRoute({
  method: 'post',
  path: '/inventories/{id}/archive',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Archive a finished or cancelled run: it leaves the lists and can be restored',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The archived run', content: jsonContent(inventorySchema) } },
});

const restore = defineRoute({
  method: 'post',
  path: '/inventories/{id}/restore',
  minRole: 'write',
  tags: ['inventories'],
  summary: 'Restore an archived run',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The restored run', content: jsonContent(inventorySchema) } },
});

/** Inventory runs. Mounted under /api/v1. */
export function createInventoryRoutes(inventories: InventoryService) {
  return createRouter()
    .openapi(list, async (c) => {
      const { state, q, archived, limit, cursor } = c.req.valid('query');
      const page = await inventories.list(c.get('actor'), { state, q, archived: archived === 'true' }, { limit, cursor });
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
    .openapi(listItems, async (c) => {
      const { id } = c.req.valid('param');
      const rows = await inventories.listItems(c.get('actor'), id, c.req.valid('query').locationId);
      return c.json({ items: rows.map(toInventoryRowDto) }, 200);
    })
    .openapi(scan, async (c) => {
      const result = await inventories.scan(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toScanResultDto(result), 200);
    })
    .openapi(check, async (c) => {
      const { id, itemId } = c.req.valid('param');
      return c.json(toInventoryRowDto(await inventories.check(c.get('actor'), id, itemId)), 200);
    })
    .openapi(uncheck, async (c) => {
      const { id, itemId } = c.req.valid('param');
      return c.json(toInventoryRowDto(await inventories.uncheck(c.get('actor'), id, itemId)), 200);
    })
    .openapi(markMissing, async (c) => {
      const { id, itemId } = c.req.valid('param');
      return c.json(toInventoryRowDto(await inventories.markMissing(c.get('actor'), id, itemId)), 200);
    })
    .openapi(unmarkMissing, async (c) => {
      const { id, itemId } = c.req.valid('param');
      return c.json(toInventoryRowDto(await inventories.unmarkMissing(c.get('actor'), id, itemId)), 200);
    })
    .openapi(cancel, async (c) => {
      const row = await inventories.cancel(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toInventoryDto(row), 200);
    })
    .openapi(finish, async (c) => {
      const row = await inventories.finish(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toInventoryDto(row), 200);
    })
    .openapi(reopen, async (c) => {
      const row = await inventories.reopen(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toInventoryDto(row), 200);
    })
    .openapi(archive, async (c) => {
      const row = await inventories.archive(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toInventoryDto(row), 200);
    })
    .openapi(restore, async (c) => {
      const row = await inventories.restore(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toInventoryDto(row), 200);
    });
}
