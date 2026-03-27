import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
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
