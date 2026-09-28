// Entry point for `pnpm db:migrate` (locally and as the Cloud Run migration job).
import { runMigrations } from './migrate.ts';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set');
  process.exit(1);
}

await runMigrations(url);
console.log('Migrations applied');
