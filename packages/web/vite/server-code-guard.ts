import { readFileSync } from 'node:fs';
import { builtinModules, findPackageJSON } from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin, Rollup } from 'vite';

const builtins = new Set(builtinModules);
type BrowserChunk = Pick<Rollup.OutputChunk, 'type' | 'fileName' | 'imports' | 'dynamicImports'> & {
  modules: Record<string, unknown>;
};
type BrowserBundle = Record<string, BrowserChunk | Pick<Rollup.OutputAsset, 'type'>>;

function isServerModule(rawId: string): boolean {
  const id = rawId.replaceAll('\\', '/').replace(/^\0/, '').split('?')[0] ?? rawId;
  return (
    /(^|\/)packages\/(core|db)\//.test(id) ||
    /(^|\/)node_modules\/(pg|drizzle-orm)(\/|$)/.test(id) ||
    id.startsWith('node:') ||
    builtins.has(id)
  );
}

function hasBrowserStub(source: string, importer: string | undefined): boolean {
  if (!importer || !isAbsolute(importer)) return false;
  const packageFile = findPackageJSON(pathToFileURL(importer));
  if (!packageFile) return false;
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as {
    browser?: Record<string, unknown>;
  };
  // Kokoro disables path and fs/promises in browsers; these are empty modules.
  return pkg.browser?.[source] === false;
}

export function assertBrowserBundle(bundle: BrowserBundle): void {
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    for (const id of [...Object.keys(chunk.modules), ...chunk.imports, ...chunk.dynamicImports]) {
      if (isServerModule(id)) {
        throw new Error(
          `Server code in @silo/web chunk "${chunk.fileName}": "${id}". ` +
            'Browser bundles must not include core, db, pg, drizzle-orm or Node built-ins.',
        );
      }
    }
  }
}

export function serverCodeGuard(): Plugin {
  return {
    name: 'silo-server-code-guard',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      // Vite erases built-in ids when it creates browser stubs, so check them first.
      if (
        (source.startsWith('node:') || builtins.has(source)) &&
        !hasBrowserStub(source, importer)
      ) {
        this.error(`Node built-in "${source}" imported by "${importer ?? 'entry'}" in @silo/web.`);
      }
      return null;
    },
    generateBundle(_options, bundle) {
      assertBrowserBundle(bundle);
    },
  };
}
