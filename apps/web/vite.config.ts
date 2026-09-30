import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API serves the built SPA in production, so browser and API share one origin. In development
// the dev server proxies `/api` to the local API (`API_ORIGIN`, default http://localhost:8080, for running
// a second checkout next to the first); keep BETTER_AUTH_URL at the dev server's own origin.
export default defineConfig({
  // The router plugin generates src/routeTree.gen.ts from src/routes (committed) and must run first.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': process.env.API_ORIGIN ?? 'http://localhost:8080' } },
});
