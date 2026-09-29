// Entry point for the Better Auth CLI only (`pnpm auth:generate`). The app builds auth via createAuth().
import { createDb } from '../db/client.ts';
import { createAuth } from './auth.ts';

const { db } = createDb(process.env.DATABASE_URL ?? 'postgres://localhost/unused');

// Placeholder values: the CLI only reads the option shape to generate the schema.
export const auth = createAuth({
  db,
  baseUrl: 'http://localhost:8080',
  secret: 'auth-cli-placeholder-not-a-secret',
  isProduction: false,
});
