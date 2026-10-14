// Entry point for `pnpm db:seed`: fills an empty local database with sample data. Never in production.
import { MIN_PASSWORD_LENGTH } from '../auth/auth.ts';
import { createDb } from './client.ts';
import { seed, SeedRefusedError } from './seed/seed.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('db:seed is for local development only');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
const password = process.env.SEED_USER_PASSWORD;
if (!url || !password) {
  console.error('DATABASE_URL and SEED_USER_PASSWORD must be set (see .env.example)');
  process.exit(1);
}
// The hash is written directly, so Better Auth's own length check never sees this password.
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`SEED_USER_PASSWORD must have at least ${MIN_PASSWORD_LENGTH} characters`);
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const summary = await seed(db, { password, today });
  console.log('Seeded', summary);
} catch (error) {
  if (!(error instanceof SeedRefusedError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
