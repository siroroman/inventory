import { expect } from 'vitest';
import { findPgError, type PgError, PG } from '../../src/db/pg-error.ts';

export { PG, type PgError };

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
