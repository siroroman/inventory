import {
  createManufacturerBody,
  idParam,
  manufacturerDetailSchema,
  manufacturerListQuery,
  manufacturerListSchema,
  manufacturerSchema,
  rankedProviderListSchema,
  setProvidersBody,
  updateManufacturerBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toManufacturerDetailDto, toManufacturerDto, toRankedProviderDto } from './dto.ts';
import type { ManufacturerService } from './service.ts';

const json = <T extends object>(schema: T) => ({ 'application/json': { schema } });

const list = defineRoute({
  method: 'get',
  path: '/manufacturers',
  minRole: 'read',
  tags: ['manufacturers'],
  summary: 'List active manufacturers by name',
  request: { query: manufacturerListQuery },
  responses: { 200: { description: 'One page of manufacturers', content: json(manufacturerListSchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/manufacturers/{id}',
  minRole: 'read',
  tags: ['manufacturers'],
  summary: 'A manufacturer with its service providers in contact order; archived ones too',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The manufacturer', content: json(manufacturerDetailSchema) } },
});

const create = defineRoute({
  method: 'post',
  path: '/manufacturers',
  minRole: 'write',
  tags: ['manufacturers'],
  summary: 'Create a manufacturer; the name must be new, ignoring case',
  request: { body: { required: true, content: json(createManufacturerBody) } },
  errors: [409],
  responses: { 201: { description: 'The new manufacturer', content: json(manufacturerSchema) } },
});

const update = defineRoute({
  method: 'patch',
  path: '/manufacturers/{id}',
  minRole: 'write',
  tags: ['manufacturers'],
  summary: 'Edit a manufacturer',
  request: { params: idParam, body: { required: true, content: json(updateManufacturerBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The updated manufacturer', content: json(manufacturerSchema) } },
});

const archive = defineRoute({
  method: 'post',
  path: '/manufacturers/{id}/archive',
  minRole: 'write',
  tags: ['manufacturers'],
  summary: 'Archive a manufacturer',
  request: { params: idParam, body: { required: true, content: json(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The archived manufacturer', content: json(manufacturerSchema) } },
});

const restore = defineRoute({
  method: 'post',
  path: '/manufacturers/{id}/restore',
  minRole: 'write',
  tags: ['manufacturers'],
  summary: 'Restore an archived manufacturer',
  request: { params: idParam, body: { required: true, content: json(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The restored manufacturer', content: json(manufacturerSchema) } },
});

const setProviders = defineRoute({
  method: 'put',
  path: '/manufacturers/{id}/service-providers',
  minRole: 'write',
  tags: ['manufacturers'],
  summary: 'Save the whole contact order of service providers at once; the last save wins',
  request: { params: idParam, body: { required: true, content: json(setProvidersBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The providers in their new order', content: json(rankedProviderListSchema) } },
});

/** Manufacturers and the contact order of their service providers. Mounted under /api/v1. */
export function createManufacturerRoutes(manufacturers: ManufacturerService) {
  return createRouter()
    .openapi(list, async (c) => {
      const { q, limit, cursor } = c.req.valid('query');
      const page = await manufacturers.list(c.get('actor'), { q }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toManufacturerDto) }, 200);
    })
    .openapi(get, async (c) => {
      const row = await manufacturers.get(c.get('actor'), c.req.valid('param').id);
      return c.json(toManufacturerDetailDto(row), 200);
    })
    .openapi(create, async (c) => {
      const row = await manufacturers.create(c.get('actor'), c.req.valid('json'));
      return c.json(toManufacturerDto(row), 201);
    })
    .openapi(update, async (c) => {
      const row = await manufacturers.update(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toManufacturerDto(row), 200);
    })
    .openapi(archive, async (c) => {
      const row = await manufacturers.archive(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toManufacturerDto(row), 200);
    })
    .openapi(restore, async (c) => {
      const row = await manufacturers.restore(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toManufacturerDto(row), 200);
    })
    .openapi(setProviders, async (c) => {
      const rows = await manufacturers.setProviders(c.get('actor'), c.req.valid('param').id, c.req.valid('json').providerIds);
      return c.json({ items: rows.map(toRankedProviderDto) }, 200);
    });
}
