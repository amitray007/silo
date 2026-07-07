import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * `@raycast/api` ships no `main`/`exports` (types-only — resolved by
 * Raycast's own bundler, not a normal Node/Vite resolver), so it cannot be
 * imported directly under Vitest. `resolve.alias` swaps it for a minimal
 * mock (`src/test-support/raycast-api-mock.ts`) at the resolver level —
 * this covers module-scope usages (e.g. `source-icon.ts`'s `Icon` import)
 * that a per-test `vi.mock` can't reach if the failure happens during a
 * transitive, non-mocked import chain. Individual test files still use
 * `vi.mock('@raycast/api', ...)` when they need specific per-test return
 * values (`getPreferenceValues`, `Clipboard.readText`, ...), which vitest
 * layers on top of this alias.
 */
export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@raycast/api': resolve(__dirname, 'src/test-support/raycast-api-mock.ts'),
    },
  },
});
