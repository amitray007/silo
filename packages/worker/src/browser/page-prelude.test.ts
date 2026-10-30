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
const codeEditors = fileURLToPath(new URL('../extract/code-editors.ts', import.meta.url));
const script = join(dir, 'source.mts');
writeFileSync(
  script,
  `import { prepareCodeLanguages } from ${JSON.stringify(richBlocks)};
   import { prepareCodeEditors, restoreCodeEditors } from ${JSON.stringify(codeEditors)};
   process.stdout.write(JSON.stringify({ languages: prepareCodeLanguages.toString(),
     editors: prepareCodeEditors.toString(), restore: restoreCodeEditors.toString() }));`,
);
const sources: { languages: string; editors: string; restore: string } = JSON.parse(
  execFileSync(process.execPath, ['--import', 'tsx', script], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
  }),
);
const tsxSource = sources.languages;

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

  it('injects editor preparation and restoration without module dependencies', () => {
    const dom = new JSDOM(
      '<div class="cm-editor"><div class="cm-content"><div class="cm-line">  source</div><div class="cm-line"><br></div></div></div>',
    );
    try {
      const document = dom.window.document;
      new Function(
        'document',
        `${PAGE_PRELUDE}
        const originals = (${sources.editors})(document, true);
        (${sources.restore})(document, originals);`,
      )(document);
      expect(document.querySelector('pre > code')?.textContent).toBe('  source\n');
    } finally {
      dom.window.close();
    }
  });
});
