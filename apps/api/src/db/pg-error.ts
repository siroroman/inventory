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

/**
 * Drizzle wraps driver errors; the pg error with its SQLSTATE sits somewhere in the `cause` chain.
 * Only a pg DatabaseError has both a string `code` and a `severity`.
 */
export function findPgError(error: unknown): PgError | undefined {
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
