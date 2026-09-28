import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // A non-UTC zone makes date/timezone shifts visible in tests.
    env: { TZ: 'America/New_York' },
  },
});
