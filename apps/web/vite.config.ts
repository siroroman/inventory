import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API serves the built SPA in production, so browser and API share one origin. In development
// the dev server proxies `/api` to the local API; keep BETTER_AUTH_URL at http://localhost:5173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});
