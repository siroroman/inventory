// Entry point for `pnpm --filter api db:seed:bulk`: adds 100 locations and 2000 items to a seeded
// local database, for trying out lists, paging and search. Never in production.
import { createDb } from '../client.ts';
import { BulkSeedRefusedError, seedBulk } from './bulk.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('db:seed:bulk is for local development only');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL must be set (see .env.example)');
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  console.log('Added', await seedBulk(db, { locations: 100, items: 2000, today }));
} catch (error) {
  if (!(error instanceof BulkSeedRefusedError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
