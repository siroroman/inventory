import { type ErrorCode, type Problem, problemSchema } from '@inventory/shared';
import { type ClientResponse, hc } from 'hono/client';
import type { AppType } from '../../../api/src/app.ts';

/**
 * API error codes plus the ones the browser makes up: no response at all, an unreadable one, and
 * the two sign-in failures (Better Auth answers those in its own format, not problem+json).
 */
export type ApiErrorCode =
  | ErrorCode
  | 'network'
  | 'unexpected'
  | 'invalid_credentials'
  | 'no_access';

/** A failed API call. The SPA shows `problemMessage(error)`, never the server's English text. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly problem: Problem | undefined;

  constructor(code: ApiErrorCode, status: number, problem?: Problem) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.problem = problem;
  }
}

/**
 * The typed Hono RPC client. `fetchImpl` is for tests; browsers use the global `fetch`, which
 * sends the session cookie because the SPA and the API share one origin.
 */
export function createApiClient(baseUrl = '/', fetchImpl?: typeof fetch) {
  return hc<AppType>(baseUrl, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        return await (fetchImpl ?? fetch)(input, init);
      } catch {
        throw new ApiError('network', 0);
      }
    },
  });
}

export const api = createApiClient();

type Success<R> = Extract<R, { ok: true }>;

/**
 * Resolves a client call to its success body and turns every other outcome into an `ApiError`:
 *
 *   const me = await unwrap(api.api.v1.me.$get());
 */
export async function unwrap<R extends ClientResponse<unknown, number, string>>(
  request: Promise<R>,
): Promise<Awaited<ReturnType<Success<R>['json']>>> {
  const res = await request;
  if (res.ok) {
    return (res.status === 204 ? undefined : await res.json()) as Awaited<
      ReturnType<Success<R>['json']>
    >;
  }
  const problem = problemSchema.safeParse(await res.json().catch(() => undefined));
  if (problem.success) throw new ApiError(problem.data.code, res.status, problem.data);
  throw new ApiError('unexpected', res.status);
}
