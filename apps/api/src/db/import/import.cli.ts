// Entry point for `pnpm --filter api db:import <locations.csv> <items.csv>`: fills an empty database
// with the company's inventory and the admin@, write@ and read@example.test users.
// deploy/import.sh runs it against Cloud SQL.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MIN_PASSWORD_LENGTH } from '../../auth/auth.ts';
import { createDb } from '../client.ts';
import { ImportRefusedError, importInventory } from './inventory.ts';

const [locationsPath, itemsPath] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
const password = process.env.SEED_USER_PASSWORD;
if (!locationsPath || !itemsPath || !url || !password) {
  console.error('Usage: db:import <locations.csv> <items.csv>, with DATABASE_URL and SEED_USER_PASSWORD set');
  process.exit(1);
}
// The hash is written directly, so Better Auth's own length check never sees this password.
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`SEED_USER_PASSWORD must have at least ${MIN_PASSWORD_LENGTH} characters`);
  process.exit(1);
}
// pnpm runs the script in apps/api; relative paths mean the directory it was started from.
const fromStart = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

const { db, pool } = createDb(url);
try {
  const summary = await importInventory(db, {
    locationsCsv: await readFile(fromStart(locationsPath), 'utf8'),
    itemsCsv: await readFile(fromStart(itemsPath), 'utf8'),
    password,
  });
  console.log('Imported', summary);
} catch (error) {
  if (!(error instanceof ImportRefusedError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
