import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type DomainErrorCode, domainErrorCodes, type ErrorCode, errorCodes, pageQuery, problemSchema } from '@inventory/shared';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { InvalidCursorError } from '../../src/db/pagination.ts';
import { DomainError } from '../../src/errors.ts';
import type { AppEnv } from '../../src/http/env.ts';
import { applyErrorHandling, statusByCode, validationHook } from '../../src/http/errors.ts';
import type { LogEntry } from '../../src/http/logger.ts';
import { createRouter } from '../../src/http/router.ts';

/** A tiny app with the real error handling and routes that fail on demand. */
function setup() {
  const logs: LogEntry[] = [];
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(requestId());
  applyErrorHandling(app, { log: (entry) => logs.push(entry) });

  app.get('/domain/:code', (c) => {
    throw new DomainError(c.req.param('code') as DomainErrorCode, { field: 'name' });
  });
  app.get('/cursor', () => {
    throw new InvalidCursorError();
  });
  app.get('/http/:status', (c) => {
    throw new HTTPException(Number(c.req.param('status')) as 413);
  });
  app.get('/boom', () => {
    throw new Error('boom: internal detail');
  });
  app.get('/db/:constraint', (c) => {
    // Shaped like Drizzle's wrapper around a pg DatabaseError; the message carries the parameters.
    const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      severity: 'ERROR',
      constraint: c.req.param('constraint'),
      table: 'some_table',
    });
    throw new Error('Failed query: insert into "user" ... params: hunter2-password-hash', { cause: driver });
  });
  app.route(
    '/validated',
    createRouter().openapi(
      createRoute({
        method: 'get',
        path: '/',
        request: { query: pageQuery },
        responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({}) } } } },
      }),
      (c) => c.json({}, 200),
    ),
  );
  return { app, logs };
}

async function problemOf(res: Response) {
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  return problemSchema.parse(await res.json());
}

describe('statusByCode', () => {
  // Reviewed by hand: the contract the SPA and the tests below rely on.
  const expected = {
    400: ['validation_error', 'invalid_cursor'],
    401: ['unauthenticated'],
    403: ['forbidden', 'cannot_modify_self'],
    404: ['not_found'],
    409: [
      'conflict',
      'archived',
      'not_archived',
      'location_cycle',
      'duplicate_provider',
      'duplicate_manufacturer',
      'duplicate_external_id',
      'email_taken',
      'last_admin',
    ],
    413: ['payload_too_large'],
    422: [
      'parent_not_found',
      'parent_archived',
      'location_type_required',
      'location_type_not_allowed',
      'location_type_not_found',
      'provider_not_found',
      'provider_archived',
      'manufacturer_not_found',
      'manufacturer_archived',
      'location_not_found',
      'location_archived',
      'invalid_photo_key',
      'photo_not_uploaded',
      'photo_too_large',
      'photo_type_not_allowed',
      'invalid_photo_order',
    ],
    429: ['rate_limited'],
    500: ['internal_error'],
  } satisfies Record<number, readonly ErrorCode[]>;

  it('maps every code to the reviewed status, exactly once', () => {
    const listed = Object.values(expected).flat();
    expect([...listed].sort()).toEqual([...errorCodes].sort());
    for (const [status, codes] of Object.entries(expected)) {
      for (const code of codes) expect(statusByCode[code as ErrorCode], code).toBe(Number(status));
    }
  });
});

describe('domain errors', () => {
  it.each(domainErrorCodes)('%s becomes problem+json with its status', async (code) => {
    const { app } = setup();
    const res = await app.request(`/domain/${code}`);
    expect(res.status).toBe(statusByCode[code]);
    const problem = await problemOf(res);
    expect(problem).toMatchObject({
      type: 'about:blank',
      status: statusByCode[code],
      code,
      instance: `/domain/${code}`,
      requestId: res.headers.get('x-request-id'),
      details: { field: 'name' },
    });
  });

  it('maps an invalid cursor to 400', async () => {
    const res = await setup().app.request('/cursor');
    expect(res.status).toBe(400);
    expect((await problemOf(res)).code).toBe('invalid_cursor');
  });

  it('maps HTTP exceptions from middleware', async () => {
    const res = await setup().app.request('/http/413');
    expect(res.status).toBe(413);
    expect((await problemOf(res)).code).toBe('payload_too_large');
  });

  it('answers unknown routes with a 404 problem', async () => {
    const res = await setup().app.request('/nope');
    expect(res.status).toBe(404);
    expect((await problemOf(res)).code).toBe('not_found');
  });
});

describe('database errors', () => {
  it.each([
    ['item_external_ids_source_value_key', 409, 'duplicate_external_id'],
    ['manufacturers_name_lower_key', 409, 'duplicate_manufacturer'],
    ['item_photos_storage_key_key', 409, 'conflict'],
    ['user_email_lower_key', 409, 'email_taken'],
  ] as const)('maps unique violation %s', async (constraint, status, code) => {
    const res = await setup().app.request(`/db/${constraint}`);
    expect(res.status).toBe(status);
    expect((await problemOf(res)).code).toBe(code);
  });

  it('treats an unmapped constraint as an internal error and keeps the parameters out of the log', async () => {
    const { app, logs } = setup();
    const res = await app.request('/db/some_other_key');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toMatch(/hunter2|23505|some_table/);
    expect(problemSchema.parse(JSON.parse(body))).toMatchObject({ code: 'internal_error', status: 500 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ severity: 'ERROR', pgCode: '23505', constraint: 'some_other_key', table: 'some_table' });
    expect(JSON.stringify(logs)).not.toMatch(/hunter2/);
  });
});

describe('unexpected errors', () => {
  it('returns a generic 500 and logs the cause with the request id', async () => {
    const { app, logs } = setup();
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/internal detail/);
    expect(problemSchema.parse(JSON.parse(text)).code).toBe('internal_error');
    expect(logs).toEqual([
      expect.objectContaining({
        severity: 'ERROR',
        message: 'unhandled error',
        requestId: res.headers.get('x-request-id'),
        errorMessage: 'boom: internal detail',
      }),
    ]);
  });
});

describe('request validation', () => {
  it('rejects a bad query with 400 and names the field', async () => {
    const res = await setup().app.request('/validated?limit=abc');
    expect(res.status).toBe(400);
    const problem = await problemOf(res);
    expect(problem.code).toBe('validation_error');
    expect(problem.details).toMatchObject({ target: 'query', issues: [expect.objectContaining({ path: 'limit' })] });
  });

  it('accepts a valid query', async () => {
    const res = await setup().app.request('/validated?limit=10');
    expect(res.status).toBe(200);
  });
});
