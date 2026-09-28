// Entry point for the Better Auth CLI only (`pnpm auth:generate`). The app builds auth via createAuth().
import { createDb } from '../db/client.ts';
import { createAuth } from './auth.ts';

const { db } = createDb(process.env.DATABASE_URL ?? 'postgres://localhost/unused');

export const auth = createAuth({ db });
