import { describe, expect, it } from 'vitest';
import { assertBrowserBundle } from './server-code-guard';

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

  it('accepts a Node name in a prebuilt worker comment', () => {
    expect(() =>
      assertBrowserBundle(bundle({ code: '/*! node:fs */\nself.postMessage("ready");' })),
    ).not.toThrow();
  });
});
