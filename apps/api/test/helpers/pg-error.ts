import { expect } from 'vitest';

export type PgError = {
  code: string;
  constraint?: string;
  message: string;
  table?: string;
};

export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  restrictViolation: '23001',
  insufficientPrivilege: '42501',
  queryCanceled: '57014',
} as const;

// Drizzle wraps driver errors; the pg error with SQLSTATE sits somewhere in the `cause` chain.
function findPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as Partial<PgError> & { severity?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && candidate.severity !== undefined) {
      return candidate as PgError;
    }
    current = candidate.cause;
  }
  return undefined;
}

export async function expectPgError(
  action: Promise<unknown>,
  expected: { code: string; constraint?: string; message?: RegExp },
): Promise<PgError> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) {
    throw new Error(`Expected Postgres error ${expected.code}, but the statement succeeded`);
  }
  const pgError = findPgError(caught);
  if (!pgError) throw caught;
  expect(pgError.code, pgError.message).toBe(expected.code);
  if (expected.constraint) expect(pgError.constraint, pgError.message).toBe(expected.constraint);
  if (expected.message) expect(pgError.message).toMatch(expected.message);
  return pgError;
}
