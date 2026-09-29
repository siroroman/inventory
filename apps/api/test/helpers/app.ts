import { createApp } from '../../src/app.ts';
import type { LogEntry } from '../../src/http/logger.ts';

/** The API against in-memory logging. Requests go through `app.request()`; no server is started. */
export function createTestApp(options: { isProduction?: boolean } = {}) {
  const logs: LogEntry[] = [];
  const app = createApp({ isProduction: options.isProduction ?? false, log: (entry) => logs.push(entry) });
  return { app, logs };
}
