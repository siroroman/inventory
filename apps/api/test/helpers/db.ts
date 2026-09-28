import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, inject } from 'vitest';
import { createDb, type Db, type DbOptions } from '../../src/db/client.ts';

export type TestDb = {
  name: string;
  /** Drizzle client connected as the least-privilege runtime role. Use this by default. */
  app: Db;
  appPool: pg.Pool;
  /** Drizzle client connected as the schema owner. Only for introspection and owner-level checks. */
  owner: Db;
  ownerPool: pg.Pool;
  appUrl: string;
  ownerUrl: string;
};

const cfg = () => inject('pg');

export function urlFor(database: string, role: 'app' | 'owner'): string {
  const c = cfg();
  const [user, password] = role === 'app' ? [c.appUser, c.appPassword] : [c.ownerUser, c.ownerPassword];
  return `postgres://${user}:${password}@${c.host}:${c.port}/${database}`;
}

let adminPool: pg.Pool | undefined;
function admin(): pg.Pool {
  adminPool ??= new pg.Pool({ connectionString: urlFor('postgres', 'owner'), max: 1 });
  return adminPool;
}

export async function createDatabase(options: { template?: boolean } = {}): Promise<string> {
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const template = options.template === false ? 'template0' : cfg().templateDb;
  const client = await admin().connect();
  try {
    // Serializes clones across parallel test files; CREATE DATABASE cannot run in a transaction.
    await client.query('SELECT pg_advisory_lock(42)');
    await client.query(`CREATE DATABASE ${name} TEMPLATE ${template} STRATEGY FILE_COPY`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(42)');
    client.release();
  }
  return name;
}

// Waits for closing connections to exit instead of FORCE, which would kill them mid-shutdown and
// surface as unhandled "terminating connection" errors in the pg client.
export async function dropDatabase(name: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await admin().query(`DROP DATABASE IF EXISTS ${name}`);
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006') throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  await admin().query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}

/** Registers hooks that give every test a fresh, migrated and seeded database. */
export function useTestDb(options: DbOptions = {}): () => TestDb {
  let current: TestDb | undefined;

  beforeEach(async () => {
    const name = await createDatabase();
    const appUrl = urlFor(name, 'app');
    const ownerUrl = urlFor(name, 'owner');
    const app = createDb(appUrl, options);
    const owner = createDb(ownerUrl, options);
    current = { name, app: app.db, appPool: app.pool, owner: owner.db, ownerPool: owner.pool, appUrl, ownerUrl };
  });

  afterEach(async () => {
    if (!current) return;
    await Promise.all([current.appPool.end(), current.ownerPool.end()]);
    await dropDatabase(current.name);
    current = undefined;
  });

  afterAll(async () => {
    await adminPool?.end();
    adminPool = undefined;
  });

  return () => {
    if (!current) throw new Error('useTestDb() is only available inside a test');
    return current;
  };
}
