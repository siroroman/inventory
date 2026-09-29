import {
  createItemBody,
  idParam,
  itemListSchema,
  itemSchema,
  itemSearchQuery,
  updateItemBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toItemDto, toItemListEntryDto } from './dto.ts';
import type { ItemService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/items',
  minRole: 'read',
  tags: ['items'],
  summary:
    'List and search active items by name; the search covers name, code, serial number, model, external IDs, manufacturer and location names',
  request: { query: itemSearchQuery },
  responses: { 200: { description: 'One page of active items', content: jsonContent(itemListSchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/items/{id}',
  minRole: 'read',
  tags: ['items'],
  summary: 'An item with its location path and external IDs; archived ones too',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The item', content: jsonContent(itemSchema) } },
});

const create = defineRoute({
  method: 'post',
  path: '/items',
  minRole: 'write',
  tags: ['items'],
  summary: 'Create an item; the database assigns its INV code',
  request: { body: { required: true, content: jsonContent(createItemBody) } },
  errors: [409, 422],
  responses: { 201: { description: 'The new item', content: jsonContent(itemSchema) } },
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

/** Items. Mounted under /api/v1; `GET /locations/{id}/items` lives with the locations. */
export function createItemRoutes(items: ItemService) {
  return createRouter()
    .openapi(list, async (c) => {
      const { q, locationId, manufacturerId, limit, cursor } = c.req.valid('query');
      const page = await items.list(c.get('actor'), { q, locationId, manufacturerId }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toItemListEntryDto) }, 200);
    })
    .openapi(get, async (c) => {
      const row = await items.get(c.get('actor'), c.req.valid('param').id);
      return c.json(toItemDto(row), 200);
    })
    .openapi(create, async (c) => {
      const row = await items.create(c.get('actor'), c.req.valid('json'));
      return c.json(toItemDto(row), 201);
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
