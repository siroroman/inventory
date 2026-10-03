import {
  createServiceProviderBody,
  idParam,
  serviceProviderDetailSchema,
  serviceProviderListQuery,
  serviceProviderListSchema,
  serviceProviderSchema,
  setManufacturersBody,
  updateServiceProviderBody,
  versionBody,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toServiceProviderDetailDto, toServiceProviderDto } from './dto.ts';
import type { ServiceProviderService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/service-providers',
  minRole: 'read',
  tags: ['service-providers'],
  summary:
    'List and search active service providers by name (`archived=true`: the archived ones), each with the brands it services; the search covers name, code, phone and the brands serviced',
  request: { query: serviceProviderListQuery },
  responses: { 200: { description: 'One page of service providers', content: jsonContent(serviceProviderListSchema) } },
});

const get = defineRoute({
  method: 'get',
  path: '/service-providers/{id}',
  minRole: 'read',
  tags: ['service-providers'],
  summary: 'A service provider with the brands it services; archived ones too',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The service provider', content: jsonContent(serviceProviderDetailSchema) } },
});

const create = defineRoute({
  method: 'post',
  path: '/service-providers',
  minRole: 'write',
  tags: ['service-providers'],
  summary: 'Create a service provider, optionally with the brands it services; the database assigns its SUP code',
  request: { body: { required: true, content: jsonContent(createServiceProviderBody) } },
  errors: [409, 422],
  responses: {
    201: { description: 'The new service provider with its brands', content: jsonContent(serviceProviderDetailSchema) },
  },
});

const update = defineRoute({
  method: 'patch',
  path: '/service-providers/{id}',
  minRole: 'write',
  tags: ['service-providers'],
  summary: 'Edit a service provider and, when `manufacturerIds` is sent, the brands it services, in one save',
  request: { params: idParam, body: { required: true, content: jsonContent(updateServiceProviderBody) } },
  errors: [404, 409, 422],
  responses: {
    200: { description: 'The updated service provider with its brands', content: jsonContent(serviceProviderDetailSchema) },
  },
});

const archive = defineRoute({
  method: 'post',
  path: '/service-providers/{id}/archive',
  minRole: 'write',
  tags: ['service-providers'],
  summary: 'Archive a service provider; it stays ranked (and marked) until removed from a contact order',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The archived service provider', content: jsonContent(serviceProviderSchema) } },
});

const restore = defineRoute({
  method: 'post',
  path: '/service-providers/{id}/restore',
  minRole: 'write',
  tags: ['service-providers'],
  summary: 'Restore an archived service provider',
  request: { params: idParam, body: { required: true, content: jsonContent(versionBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The restored service provider', content: jsonContent(serviceProviderSchema) } },
});

const setManufacturers = defineRoute({
  method: 'put',
  path: '/service-providers/{id}/manufacturers',
  minRole: 'write',
  tags: ['service-providers'],
  summary:
    'Save the whole set of brands the provider services; a new brand ranks it last, a dropped brand closes the gap. A change bumps the provider version',
  request: { params: idParam, body: { required: true, content: jsonContent(setManufacturersBody) } },
  errors: [404, 409, 422],
  responses: {
    200: { description: 'The provider with its brands and their new version', content: jsonContent(serviceProviderDetailSchema) },
  },
});

/** Service providers and the brands they service. Mounted under /api/v1. */
export function createServiceProviderRoutes(serviceProviders: ServiceProviderService) {
  return createRouter()
    .openapi(list, async (c) => {
      const { q, archived, limit, cursor } = c.req.valid('query');
      const page = await serviceProviders.list(c.get('actor'), { q, archived: archived === 'true' }, { limit, cursor });
      return c.json({ ...page, items: page.items.map(toServiceProviderDetailDto) }, 200);
    })
    .openapi(get, async (c) => {
      const row = await serviceProviders.get(c.get('actor'), c.req.valid('param').id);
      return c.json(toServiceProviderDetailDto(row), 200);
    })
    .openapi(create, async (c) => {
      const row = await serviceProviders.create(c.get('actor'), c.req.valid('json'));
      return c.json(toServiceProviderDetailDto(row), 201);
    })
    .openapi(update, async (c) => {
      const row = await serviceProviders.update(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toServiceProviderDetailDto(row), 200);
    })
    .openapi(archive, async (c) => {
      const row = await serviceProviders.archive(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toServiceProviderDto(row), 200);
    })
    .openapi(restore, async (c) => {
      const row = await serviceProviders.restore(c.get('actor'), c.req.valid('param').id, c.req.valid('json').version);
      return c.json(toServiceProviderDto(row), 200);
    })
    .openapi(setManufacturers, async (c) => {
      const { version, manufacturerIds } = c.req.valid('json');
      const row = await serviceProviders.setManufacturers(c.get('actor'), c.req.valid('param').id, version, manufacturerIds);
      return c.json(toServiceProviderDetailDto(row), 200);
    });
}
