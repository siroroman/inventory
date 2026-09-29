import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, unwrap } from '../src/lib/api.ts';
import { problemMessage } from '../src/lib/problem.ts';
import { retryQuery } from '../src/lib/query.ts';
import { jsonResponse } from './helpers.tsx';

const me = { id: '0c6f5a4e-8f3b-4a8e-9a55-2f2b1b8a9c11', email: 'a@example.test', name: 'Anna', role: 'admin' };

function clientFor(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  };
  return { api: createApiClient('http://localhost', fetchImpl), requests };
}

describe('unwrap', () => {
  it('returns the typed body of a successful call', async () => {
    const { api, requests } = clientFor(() => jsonResponse(me));
    const body = await unwrap(api.api.v1.me.$get());
    expect(body.role).toBe('admin');
    expect(requests[0]?.url).toBe('http://localhost/api/v1/me');
  });

  it('throws an ApiError with the code of a problem+json answer', async () => {
    const { api } = clientFor(() =>
      jsonResponse(
        { type: 'about:blank', title: 'Forbidden', status: 403, code: 'forbidden' },
        { status: 403, problem: true },
      ),
    );
    const error = await unwrap(api.api.v1.me.$get()).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('treats an answer that is not a problem as unexpected', async () => {
    const { api } = clientFor(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await unwrap(api.api.v1.me.$get()).catch((e) => e);
    expect(error).toMatchObject({ code: 'unexpected', status: 502 });
  });

  it('reports a failed request as a network error', async () => {
    const { api } = clientFor(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = await unwrap(api.api.v1.me.$get()).catch((e) => e);
    expect(error).toMatchObject({ code: 'network', status: 0 });
  });
});

describe('problemMessage', () => {
  it('is Czech text chosen by the error code', () => {
    expect(problemMessage(new ApiError('duplicate_external_id', 409))).toBe(
      'Toto externí ID už je u jiné položky použité.',
    );
    expect(problemMessage(new ApiError('network', 0))).toContain('Server není dostupný');
  });

  it('falls back to a generic message for anything else', () => {
    expect(problemMessage(new Error('boom'))).toBe('Něco se nepovedlo. Zkuste to prosím znovu.');
    expect(problemMessage(undefined)).toBe('Něco se nepovedlo. Zkuste to prosím znovu.');
  });
});

describe('retryQuery', () => {
  it('does not retry client errors', () => {
    expect(retryQuery(0, new ApiError('not_found', 404))).toBe(false);
    expect(retryQuery(0, new ApiError('unauthenticated', 401))).toBe(false);
  });

  it('retries network and server errors twice', () => {
    expect(retryQuery(0, new ApiError('network', 0))).toBe(true);
    expect(retryQuery(1, new ApiError('internal_error', 500))).toBe(true);
    expect(retryQuery(2, new ApiError('internal_error', 500))).toBe(false);
  });
});
