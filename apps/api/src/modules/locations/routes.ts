import {
  createLocationBody,
  createLocationTypeBody,
  idParam,
  itemListQuery,
  itemListSchema,
  locationListQuery,
  locationListSchema,
  locationSchema,
  locationTypeListSchema,
  locationTypeSchema,
  updateLocationBody,
  updateLocationTypeBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toItemListEntryDto } from '../items/dto.ts';
import type { ItemService } from '../items/service.ts';
import { toLocationDto, toLocationTypeDto } from './dto.ts';
import type { LocationService, LocationTypeService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/locations',
  minRole: 'read',
  tags: ['locations'],
  summary: 'List locations: top level, the children of one location, or a search across all levels',
  request: { query: locationListQuery },
  responses: { 200: { description: 'One page of active locations', content: jsonContent(locationListSchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/locations/{id}',
  minRole: 'read',
  tags: ['locations'],
  summary: 'A location with its path and counts; archived ones too',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The location', content: jsonContent(locationSchema) } },
});

const listItems = defineRoute({
  method: 'get',
  path: '/locations/{id}/items',
  minRole: 'read',
  tags: ['locations'],
  summary: 'Items in a location and all its sub-locations',
  request: { params: idParam, query: itemListQuery },
  errors: [404],
  responses: { 200: { description: 'One page of active items', content: jsonContent(itemListSchema) } },
});

const create = defineRoute({
  method: 'post',
  path: '/locations',
  minRole: 'write',
  tags: ['locations'],
  summary: 'Create a location or sub-location',
  request: { body: { required: true, content: jsonContent(createLocationBody) } },
  errors: [422],
  responses: { 201: { description: 'The new location', content: jsonContent(locationSchema) } },
});

const update = defineRoute({
  method: 'patch',
  path: '/locations/{id}',
  minRole: 'write',
  tags: ['locations'],
  summary: 'Edit a location, including moving it under another parent',
  request: { params: idParam, body: { required: true, content: jsonContent(updateLocationBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The updated location', content: jsonContent(locationSchema) } },
});

const archive = defineRoute({
  method: 'post',
  path: '/locations/{id}/archive',
  minRole: 'write',
  tags: ['locations'],
  summary: 'Archive a location',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The archived location', content: jsonContent(locationSchema) } },
});

const restore = defineRoute({
  method: 'post',
  path: '/locations/{id}/restore',
  minRole: 'write',
  tags: ['locations'],
  summary: 'Restore an archived location',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The restored location', content: jsonContent(locationSchema) } },
});

type LocationServices = { locations: LocationService; items: ItemService };

/** Locations and their items. Mounted under /api/v1. */
export function createLocationRoutes({ locations, items }: LocationServices) {
  return createRouter()
    .openapi(list, async (c) => {
      const { parentId, q, limit, cursor } = c.req.valid('query');
      const page = await locations.list(c.get('actor'), { parentId, q }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toLocationDto) }, 200);
    })
    .openapi(get, async (c) => {
      const row = await locations.get(c.get('actor'), c.req.valid('param').id);
      return c.json(toLocationDto(row), 200);
    })
    .openapi(listItems, async (c) => {
      const actor = c.get('actor');
      const { id } = c.req.valid('param');
      const { q, limit, cursor } = c.req.valid('query');
      const page = await items.listInLocation(actor, id, { q }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toItemListEntryDto) }, 200);
    })
    .openapi(create, async (c) => {
      const row = await locations.create(c.get('actor'), c.req.valid('json'));
      return c.json(toLocationDto(row), 201);
    })
    .openapi(update, async (c) => {
      const row = await locations.update(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toLocationDto(row), 200);
    })
    .openapi(archive, async (c) => {
      const row = await locations.archive(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toLocationDto(row), 200);
    })
    .openapi(restore, async (c) => {
      const row = await locations.restore(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toLocationDto(row), 200);
    });
}

const listTypes = defineRoute({
  method: 'get',
  path: '/location-types',
  minRole: 'read',
  tags: ['location-types'],
  summary: 'List location types in display order',
  responses: { 200: { description: 'Active location types', content: jsonContent(locationTypeListSchema) } },
});

const createType = defineRoute({
  method: 'post',
  path: '/location-types',
  minRole: 'admin',
  tags: ['location-types'],
  summary: 'Create a location type',
  request: { body: { required: true, content: jsonContent(createLocationTypeBody) } },
  errors: [409],
  responses: { 201: { description: 'The new type', content: jsonContent(locationTypeSchema) } },
});

const updateType = defineRoute({
  method: 'patch',
  path: '/location-types/{id}',
  minRole: 'admin',
  tags: ['location-types'],
  summary: 'Edit a location type',
  request: { params: idParam, body: { required: true, content: jsonContent(updateLocationTypeBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The updated type', content: jsonContent(locationTypeSchema) } },
});

/** Location types: read by everyone, managed by admins. Mounted under /api/v1. */
export function createLocationTypeRoutes(types: LocationTypeService) {
  return createRouter()
    .openapi(listTypes, async (c) => {
      const rows = await types.list(c.get('actor'));
      return c.json({ items: rows.map(toLocationTypeDto) }, 200);
    })
    .openapi(createType, async (c) => {
      const row = await types.create(c.get('actor'), c.req.valid('json'));
      return c.json(toLocationTypeDto(row), 201);
    })
    .openapi(updateType, async (c) => {
      const row = await types.update(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toLocationTypeDto(row), 200);
    });
}
