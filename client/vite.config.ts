import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vite';

const configDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(configDir, '../package.json'), 'utf-8'),
) as { version: string };

// Load `.env` from the monorepo root (parent of `client/`), not only `client/.env`.
export default defineConfig({
  root: __dirname,
  envDir: '..',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5200,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    port: 5300,
    host: '0.0.0.0',
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    reportCompressedSize: true,
  },
});
