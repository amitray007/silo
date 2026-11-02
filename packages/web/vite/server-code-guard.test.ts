import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { assertBrowserBundle, serverCodeGuard } from './server-code-guard';

function bundle({
  modules = ['/repo/packages/web/src/main.tsx'],
  imports = [] as string[],
  dynamicImports = [] as string[],
  code = '',
} = {}) {
  return {
    'main.js': {
      type: 'chunk' as const,
      fileName: 'main.js',
      modules: Object.fromEntries(modules.map((id) => [id, {}])),
      imports,
      dynamicImports,
      code,
    },
    'style.css': { type: 'asset' as const },
  };
}

describe('browser bundle guard', () => {
  it('accepts browser modules and assets', () => {
    expect(() => assertBrowserBundle(bundle({ imports: ['./vendor.js'] }))).not.toThrow();
  });

  it.each([
    '/repo/packages/core/src/links/links.ts',
    '/repo/packages/db/src/client.ts',
    '/repo/node_modules/.pnpm/pg@8.16.3/node_modules/pg/lib/index.js',
    '/repo/node_modules/drizzle-orm/index.js',
    'C:\\repo\\packages\\core\\src\\index.ts',
    '\0/repo/packages/core/src/index.ts?commonjs-proxy',
    'node:fs',
    'fs',
    'fs/promises',
  ])('rejects a server module: %s', (id) => {
    expect(() => assertBrowserBundle(bundle({ modules: [id] }))).toThrow(
      'Server code in @silo/web chunk "main.js"',
    );
  });

  it('rejects an external Node import', () => {
    expect(() => assertBrowserBundle(bundle({ imports: ['node:fs'] }))).toThrow('node:fs');
  });

  it('rejects a dynamic Node import', () => {
    expect(() => assertBrowserBundle(bundle({ dynamicImports: ['node:crypto'] }))).toThrow(
      'node:crypto',
    );
  });

  it.each([
    'pg',
    'pg/lib/client',
    'pg-pool',
    'pg-protocol/dist/parser',
    'postgres',
    'postgres/src/index',
    'drizzle-orm',
    'drizzle-orm/pg-core',
    '@silo/core',
    '@silo/core/capture',
    '@silo/db',
    '@silo/db/migrate',
    'node:fs',
    'fs/promises',
  ])('rejects static and dynamic external server imports: %s', (id) => {
    expect(() => assertBrowserBundle(bundle({ imports: [id] }))).toThrow(id);
    expect(() => assertBrowserBundle(bundle({ dynamicImports: [id] }))).toThrow(id);
  });

  it('accepts the empty browser stubs used by kokoro-js', () => {
    expect(() =>
      assertBrowserBundle(
        bundle({
          modules: ['\0__vite-browser-external:fs/promises', '\0__vite-browser-external:path'],
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['pg', 'export { Client } from "pg";'],
    ['pg', 'import { Client } from "pg"; console.log("browser");'],
    ['drizzle-orm/pg-core', 'export * from "drizzle-orm/pg-core";'],
    ['@silo/core', 'export * from "@silo/core";'],
    ['@silo/db', 'export * from "@silo/db";'],
    ['node:fs', 'import("node:fs").then(console.log);'],
  ])('fails a build with an external server import: %s', async (id, code) => {
    await expect(
      build({
        configFile: false,
        logLevel: 'silent',
        plugins: [
          serverCodeGuard(),
          {
            name: 'guard-test-entry',
            resolveId(source) {
              return source === 'guard-test-entry' ? '\0guard-test-entry' : null;
            },
            load(source) {
              return source === '\0guard-test-entry' ? code : null;
            },
          },
        ],
        build: {
          write: false,
          minify: false,
          rollupOptions: {
            input: 'guard-test-entry',
            external: [id],
            treeshake: { moduleSideEffects: false },
          },
        },
      }),
    ).rejects.toThrow('Server code in @silo/web');
  });

  it('accepts a Node name in a prebuilt worker comment', () => {
    expect(() =>
      assertBrowserBundle(bundle({ code: '/*! node:fs */\nself.postMessage("ready");' })),
    ).not.toThrow();
  });
});
