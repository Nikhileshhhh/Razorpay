import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(rootDir, 'src/web');

// The React/Vite web application is rooted at src/web and is a browser-only
// bundle. It must never pull in server-side modules, config, or secrets;
// that boundary is enforced in tests/unit/architecture-boundaries.test.ts.
export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: {
    outDir: resolve(rootDir, 'dist-web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/v1': 'http://127.0.0.1:3000',
      '/ready': 'http://127.0.0.1:3000',
    },
  },
});
