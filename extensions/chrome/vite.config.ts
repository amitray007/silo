import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * A plain multi-entry Vite build (no MV3 plugin dependency) — each MV3
 * surface (service worker, options) is its own entry point, output
 * flat into `dist/` with predictable filenames the `public/manifest.json`
 * references directly (`background.js`, `options.html`). No popup entry —
 * the toolbar action has no `default_popup` (instant-save redesign).
 * `public/` (the manifest + icons) is copied as-is by Vite's default
 * `publicDir` behavior.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        options: resolve(__dirname, 'options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
    target: 'esnext',
  },
});
