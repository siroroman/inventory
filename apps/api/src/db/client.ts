import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type DbOptions = {
  statementTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
  max?: number;
};

export function createDb(connectionString: string, options: DbOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs ?? 30_000,
    // Better Auth's generated tables use `timestamp` without time zone; DB-side now() defaults must be UTC.
    options: '-c TimeZone=UTC',
  });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];
