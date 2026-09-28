import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.ts';
import { useTestDb } from '../helpers/db.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('createDb', () => {
  const t = useTestDb();

  it('sets statement and idle-in-transaction timeouts by default', async () => {
    const result = await t().app.execute(
      sql`SELECT current_setting('statement_timeout') AS statement, current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    expect(result.rows[0]).toEqual({ statement: '15s', idle: '30s' });
  });

  it('cancels a statement that runs past the timeout', async () => {
    const { db, pool } = createDb(t().appUrl, { statementTimeoutMs: 200 });
    try {
      await expectPgError(db.execute(sql`SELECT pg_sleep(2)`), { code: PG.queryCanceled });
    } finally {
      await pool.end();
    }
  });

  it('pins the session time zone to UTC even if the database default differs', async () => {
    await t().owner.execute(sql.raw(`ALTER DATABASE ${t().name} SET timezone = 'America/New_York'`));
    const { db, pool } = createDb(t().appUrl);
    try {
      const result = await db.execute(sql`SELECT current_setting('TimeZone') AS tz`);
      expect(result.rows[0]).toEqual({ tz: 'UTC' });
    } finally {
      await pool.end();
    }
  });
});
