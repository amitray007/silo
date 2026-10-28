import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterAll, describe, expect, it } from 'vitest';
import { PAGE_PRELUDE } from './page.js';

// Production runs the worker under tsx, which adds `__name(...)` calls to function
// source; vitest does not. Read the source the way production produces it.
const dir = mkdtempSync(join(tmpdir(), 'silo-prelude-'));
const richBlocks = fileURLToPath(new URL('../extract/rich-blocks.ts', import.meta.url));
const script = join(dir, 'source.mts');
writeFileSync(
  script,
  `import { prepareCodeLanguages } from ${JSON.stringify(richBlocks)};\nprocess.stdout.write(prepareCodeLanguages.toString());\n`,
);
const tsxSource = execFileSync(process.execPath, ['--import', 'tsx', script], {
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
  encoding: 'utf8',
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runInPage(prelude: string) {
  const { document } = new JSDOM('<pre class="language-js"><code>const answer = 42;</code></pre>')
    .window;
  new Function('document', `${prelude}(${tsxSource})(document);`)(document);
  return document;
}

describe('page script prelude', () => {
  it('runs tsx-transformed helpers that call __name', () => {
    expect(tsxSource).toContain('__name');
    expect(() => runInPage('')).toThrow(/__name is not defined/);
    const document = runInPage(PAGE_PRELUDE);
    expect(document.querySelector('code')?.getAttribute('data-lang')).toBe('js');
  });
});
