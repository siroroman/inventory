import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { parseConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { jsonLogger as log } from './http/logger.ts';
import type { UserInvites } from './modules/users/service.ts';
import { createServices } from './services.ts';
import { createCloudStorage, openBucket } from './storage/cloud-storage.ts';
import type { ObjectStorage } from './storage/storage.ts';

const config = parseConfig(process.env);
const { db, pool } = createDb(config.databaseUrl);
const auth = createAuth({
  db,
  baseUrl: config.auth.baseUrl,
  secret: config.auth.secret,
  isProduction: config.isProduction,
  google: config.auth.google,
});
// Without STORAGE_BUCKET every call that reaches the bucket fails with a logged 500; reading items
// works, since a gallery stays empty without uploads.
const notConfigured = () => Promise.reject(new Error('File storage is not configured'));
let storage: ObjectStorage = {
  createUploadUrl: notConfigured,
  createReadUrl: notConfigured,
  head: notConfigured,
  delete: notConfigured,
};
if (config.storage) {
  const bucket = openBucket({ name: config.storage.bucket, apiEndpoint: config.storage.apiEndpoint });
  // The emulator starts empty; the production bucket is created by deploy/setup.sh.
  if (config.storage.apiEndpoint && !(await bucket.exists())[0]) await bucket.create();
  storage = createCloudStorage(bucket);
}
// Likewise the invitation adapter (Better Auth account plus email): inviting fails with a logged 500
// until it exists. Listing, role changes and deactivation do not need it.
const invites: UserInvites = { invite: () => Promise.reject(new Error('User invitations are not configured')) };
const app = createApp({
  auth,
  baseUrl: config.auth.baseUrl,
  isProduction: config.isProduction,
  log,
  services: createServices({ db, storage, invites }),
  staticRoot: config.staticDir,
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
