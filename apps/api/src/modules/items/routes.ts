import {
  createdItemSchema,
  createItemBody,
  idParam,
  itemDetailSchema,
  itemLabelsQuery,
  itemLabelsSchema,
  itemListSchema,
  itemSchema,
  itemSearchQuery,
  updateItemBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toPhotoDto } from '../photos/dto.ts';
import type { PhotoService } from '../photos/service.ts';
import { toItemDto, toItemLabelDto, toItemListEntryDto } from './dto.ts';
import type { ItemService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/items',
  minRole: 'read',
  tags: ['items'],
  summary:
    'List and search active items by name (`archived=true`: the archived ones); the search covers name, code, serial number, model, external IDs, manufacturer and location names',
  request: { query: itemSearchQuery },
  responses: { 200: { description: 'One page of items', content: jsonContent(itemListSchema) } },
});

const labels = defineRoute({
  method: 'get',
  path: '/items/labels',
  minRole: 'read',
  tags: ['items'],
  summary:
    'Active items for QR labels: those below `locationId` and/or matching `q`, at most `limit` (1 000), ' +
    'by ID with the numbers in it compared by value, with the total; not paged',
  request: { query: itemLabelsQuery },
  errors: [404],
  responses: { 200: { description: 'The items and how many matched', content: jsonContent(itemLabelsSchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/items/{id}',
  minRole: 'read',
  tags: ['items'],
  summary: 'An item with its location path, external IDs and photos (read URLs valid for 15 minutes); archived ones too',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The item', content: jsonContent(itemDetailSchema) } },
});

const create = defineRoute({
  method: 'post',
  path: '/items',
  minRole: 'write',
  tags: ['items'],
  summary:
    'Create an item; the database assigns its INV code. With `inventoryId` the item is also added to that run ' +
    'as an item added during the inventory, when the run is in progress and the location is in it',
  request: { body: { required: true, content: jsonContent(createItemBody) } },
  errors: [409, 422],
  responses: {
    201: { description: 'The new item, and whether it was added to the run', content: jsonContent(createdItemSchema) },
  },
});

const update = defineRoute({
  method: 'patch',
  path: '/items/{id}',
  minRole: 'write',
  tags: ['items'],
  summary: 'Edit an item; sending externalIds replaces the whole list',
  request: { params: idParam, body: { required: true, content: jsonContent(updateItemBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The updated item', content: jsonContent(itemSchema) } },
});

const archive = defineRoute({
  method: 'post',
  path: '/items/{id}/archive',
  minRole: 'write',
  tags: ['items'],
  summary: 'Archive an item; its external IDs stay reserved',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The archived item', content: jsonContent(itemSchema) } },
});

const restore = defineRoute({
  method: 'post',
  path: '/items/{id}/restore',
  minRole: 'write',
  tags: ['items'],
  summary: 'Restore an archived item',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The restored item', content: jsonContent(itemSchema) } },
});

type ItemServices = { items: ItemService; photos: PhotoService };

/** Items. Mounted under /api/v1; `GET /locations/{id}/items` lives with the locations, the photo writes with the photos. */
export function createItemRoutes({ items, photos }: ItemServices) {
  return createRouter()
    .openapi(list, async (c) => {
      const { q, locationId, manufacturerId, archived, limit, cursor } = c.req.valid('query');
      const filter = { q, locationId, manufacturerId, archived: archived === 'true' };
      const page = await items.list(c.get('actor'), filter, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toItemListEntryDto) }, 200);
    })
    // Before `/items/{id}`, which would take "labels" for an id and answer 400.
    .openapi(labels, async (c) => {
      const { q, locationId, limit } = c.req.valid('query');
      const result = await items.listLabels(c.get('actor'), { q, locationId }, limit);
      return c.json({ items: result.items.map(toItemLabelDto), total: result.total }, 200);
    })
    .openapi(get, async (c) => {
      const actor = c.get('actor');
      const { id } = c.req.valid('param');
      const [row, gallery] = await Promise.all([items.get(actor, id), photos.list(actor, id)]);
      return c.json({ ...toItemDto(row), photos: gallery.map(toPhotoDto) }, 200);
    })
    .openapi(create, async (c) => {
      const { addedToInventory, ...row } = await items.create(c.get('actor'), c.req.valid('json'));
      return c.json({ ...toItemDto(row), addedToInventory }, 201);
    })
    .openapi(update, async (c) => {
      const row = await items.update(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toItemDto(row), 200);
    })
    .openapi(archive, async (c) => {
      const row = await items.archive(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toItemDto(row), 200);
    })
    .openapi(restore, async (c) => {
      const row = await items.restore(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toItemDto(row), 200);
    });
}
