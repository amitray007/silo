import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev-only tooling (`agentation`, the annotation toolbar) must never reach the
// production bundle. A runtime `import.meta.env.DEV` guard stops it LOADING in
// prod, but Rollup still code-splits the dynamic `import('agentation')` into an
// emitted chunk. So in a production BUILD we alias `agentation` to an empty
// stub — the dynamic import resolves to nothing and no chunk is emitted. In dev
// (`serve`) the alias is absent, so the real toolbar loads.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias:
      command === 'build'
        ? [{ find: /^agentation$/, replacement: '/src/dev/agentation-stub.ts' }]
        : [],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
}));
