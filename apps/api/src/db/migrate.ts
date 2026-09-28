import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Must run as the schema owner (MIGRATION_DATABASE_URL), never as the app_runtime login.
export async function runMigrations(ownerConnectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerConnectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
