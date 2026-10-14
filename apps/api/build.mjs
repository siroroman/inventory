// Bundles the server into one file, dist/server.mjs, for the production image.
//
// Node resolving and loading the ~1,000 module files of the server's dependencies took about 0.6 s on
// a laptop and several seconds in a cold Cloud Run container (every file is a read through the
// sandbox). One file loads in about a fifth of the time. The migrations still run from the TypeScript
// sources (`src/db/migrate.cli.ts`), which also need `apps/api/drizzle`.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Readable stack traces in the logs (the image runs with `node --enable-source-maps`).
  sourcemap: true,
  // CommonJS packages that call `require` for Node built-ins need it in an ES module.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
