import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { prepareCodeEditors } from './code-editors.js';
import { extractPageContent } from './reader-page.js';

const prose =
  '<p>A technical article explains this code sample and its behavior in detail.</p>'.repeat(8);
const examples = [
  ['cm6', 'function greet() {\n  const text = "<hello>";\n\n\treturn text;  \n}\n', 'javascript'],
  ['cm5', 'if (ready) {\n  run();\n}', 'javascript'],
  ['monaco', 'const value: number = 1;\n  console.log(value);', 'typescript'],
  ['github', 'if (ready) {\n  run();\n}', 'js'],
  ['rouge', 'if ready\n  run\nend\n', 'ruby'],
  ['pygments', 'if ready:\n    run()\n', 'python'],
  [
    'shopify',
    "const authorizationDetails = JSON.stringify([\n  {\n    type: 'urn:shopify:shop_app:data-sharing:v1',\n    datatypes: [\n      {name: 'phone_number', required: true},\n      {name: 'birthdate', required: false},\n    ],\n  },\n]);",
    'javascript',
  ],
] as const;

describe('code editor normalization', () => {
  it.each(examples)('keeps exact %s code and removes editor chrome', (name, text, language) => {
    const html = readFileSync(
      new URL(`./__fixtures__/code-editor-${name}.html`, import.meta.url),
      'utf8',
    );
    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      prepareCodeEditors(document);
      expect(document.querySelectorAll('pre')).toHaveLength(1);
      expect(document.querySelectorAll('pre > code')).toHaveLength(1);
      expect(document.querySelector('code')?.textContent).toBe(text);
      expect(document.querySelector('code')?.className).toBe(`language-${language}`);
      expect(document.body.textContent?.trim()).toBe(text.trim());
      const once = document.body.innerHTML;
      prepareCodeEditors(document);
      expect(document.body.innerHTML).toBe(once);
    } finally {
      dom.window.close();
    }
  });

  it.each(examples)(
    'stores one exact %s code block and searchable newlines',
    async (name, text, language) => {
      const html = readFileSync(
        new URL(`./__fixtures__/code-editor-${name}.html`, import.meta.url),
        'utf8',
      );
      const result = await extractPageContent(
        `<article>${prose}${html}${prose}</article>`,
        'https://example.com/article',
      );
      const dom = new JSDOM(result.reader?.contentHtml);
      try {
        expect(dom.window.document.querySelectorAll('pre > code')).toHaveLength(1);
        expect(dom.window.document.querySelector('code')?.textContent).toBe(text);
        expect(dom.window.document.querySelector('code')?.getAttribute('data-lang')).toBe(language);
        expect(result.text).toContain(text);
        expect(result.text).not.toMatch(/Copy sample|Duplicate/);
      } finally {
        dom.window.close();
      }
    },
  );

  it('leaves ordinary tables, paragraphs and real pre blocks unchanged', () => {
    const dom = new JSDOM(
      '<p>Ordinary text.</p><table><tr><td>1</td><td>Data</td></tr></table><pre class="language-js"><code>  keep\n\tthis\n</code></pre><pre><code><span class="cm-content"><span class="cm-line">literal</span></span></code></pre>',
    );
    try {
      const before = dom.window.document.body.innerHTML;
      prepareCodeEditors(dom.window.document);
      expect(dom.window.document.body.innerHTML).toBe(before);
    } finally {
      dom.window.close();
    }
  });

  it('keeps empty editors and unpaired highlighter cells unchanged', () => {
    const dom = new JSDOM(
      '<div class="cm-editor"></div><div class="highlight"><table><tr><td class="code">ordinary</td></tr></table></div>',
    );
    try {
      const before = dom.window.document.body.innerHTML;
      prepareCodeEditors(dom.window.document);
      expect(dom.window.document.body.innerHTML).toBe(before);
    } finally {
      dom.window.close();
    }
  });

  it('keeps an outer data table around a nested highlighter', () => {
    const dom = new JSDOM(
      '<table id="data"><tr><td>Record</td><td><table><tr><td class="blob-num">1</td><td class="blob-code">code</td></tr></table></td></tr></table>',
    );
    try {
      prepareCodeEditors(dom.window.document);
      expect(dom.window.document.querySelectorAll('table')).toHaveLength(1);
      expect(dom.window.document.querySelector('#data')?.textContent).toBe('Recordcode');
      expect(dom.window.document.querySelector('pre > code')?.textContent).toBe('code');
    } finally {
      dom.window.close();
    }
  });

  it('keeps standalone content, blank lines and code whitespace without guessing a language', async () => {
    const result = await extractPageContent(
      `<article>${prose}<div class="cm-content"><div class="cm-line"><span><br></span></div><div class="cm-line">  first</div><div class="cm-line">&#8203;</div><div class="cm-line"><br></div><div class="cm-line"><br></div><div class="cm-line">  last</div></div>${prose}</article>`,
      'https://example.com/article',
    );
    const dom = new JSDOM(result.reader?.contentHtml);
    try {
      expect(dom.window.document.querySelector('pre > code')?.textContent).toBe(
        '\n  first\n\n\n\n  last',
      );
      expect(dom.window.document.querySelector('code')?.hasAttribute('data-lang')).toBe(false);
      expect(result.text).not.toContain('silo-editor-');
    } finally {
      dom.window.close();
    }
  });

  it('keeps ordinary extraction and real pre handling unchanged', async () => {
    const result = await extractPageContent(
      '<article><p>Ordinary article.</p><pre><code>const a = 1;\n  run(a);</code></pre></article>',
      'https://example.com/article',
    );
    expect(result.reader?.contentHtml).toBe(
      '<article><p>Ordinary article.</p><pre><code>const a = 1;\n  run(a);</code></pre></article>',
    );
    expect(result.text).toBe('Ordinary article.\nconst a = 1;\n  run(a);');
    const ordinary = await extractPageContent(
      '<article><p>Ordinary   article.</p><p>Second paragraph.</p></article>',
      'https://example.com/article',
    );
    expect(ordinary.reader?.contentHtml).toBe(
      '<article><p>Ordinary article.</p><p>Second paragraph.</p></article>',
    );
    expect(ordinary.text).toBe('Ordinary article.Second paragraph.');
  });
});
