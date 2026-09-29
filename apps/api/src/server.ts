import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { parseConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { jsonLogger as log } from './http/logger.ts';
import { createServices } from './services.ts';

const config = parseConfig(process.env);
const { db, pool } = createDb(config.databaseUrl);
const auth = createAuth({
  db,
  baseUrl: config.auth.baseUrl,
  secret: config.auth.secret,
  isProduction: config.isProduction,
  google: config.auth.google,
});
const app = createApp({
  auth,
  baseUrl: config.auth.baseUrl,
  isProduction: config.isProduction,
  log,
  services: createServices({ db }),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log({ severity: 'INFO', message: 'listening', port: info.port, env: config.env });
});

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then close the pool.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log({ severity: 'INFO', message: 'shutting down', signal });
  // Do not wait for idle keep-alive connections; only requests still being handled.
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  server.close(() => {
    pool.end().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
  // Cloud Run kills the instance after 10 s anyway; exit with a clear status just before.
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
