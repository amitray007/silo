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
  it('keeps real Gist blank rows without adding extra lines', async () => {
    const html = readFileSync(
      new URL('./__fixtures__/code-editor-gist.html', import.meta.url),
      'utf8',
    );
    const dom = new JSDOM(html);
    try {
      prepareCodeEditors(dom.window.document);
      const code = dom.window.document.querySelector('code')?.textContent ?? '';
      expect(code.split('\n')).toHaveLength(31);
      expect(code).toContain('animating\n\n// requestAnimationFrame');
      expect(code).toContain('// MIT license\n\n(function() {');
      expect(code).not.toContain('\n\n\n');
      const result = await extractPageContent(
        `<article>${prose}${html}${prose}</article>`,
        'https://gist.github.com/paulirish/1579671',
      );
      const stored = new JSDOM(result.reader?.contentHtml);
      try {
        expect(stored.window.document.querySelector('code')?.textContent).toBe(code);
      } finally {
        stored.window.close();
      }
    } finally {
      dom.window.close();
    }
  });

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
        expect(result.text).toContain(text.replace(/[ \t]+/g, ' '));
        expect(result.text).not.toMatch(/Copy sample|Duplicate/);
      } finally {
        dom.window.close();
      }
    },
  );

  it('leaves unified and split diff tables unchanged', () => {
    const html = readFileSync(
      new URL('./__fixtures__/code-editor-diff.html', import.meta.url),
      'utf8',
    );
    const dom = new JSDOM(html);
    try {
      const before = dom.window.document.body.innerHTML;
      prepareCodeEditors(dom.window.document);
      expect(dom.window.document.body.innerHTML).toBe(before);
      expect(dom.window.document.querySelectorAll('pre')).toHaveLength(0);
    } finally {
      dom.window.close();
    }
  });

  it.each(['blob-code-addition', 'blob-code-deletion', 'blob-code-hunk', 'marker', 'split'])(
    'rejects a diff with only the %s signal',
    (signal) => {
      const attr = signal === 'marker' ? 'data-code-marker="+"' : '';
      const extra =
        signal === 'split' ? '<td class="blob-num">2</td><td class="blob-code">right</td>' : '';
      const dom = new JSDOM(
        `<table><tr><td class="blob-num">1</td><td class="blob-code ${signal}" ${attr}>source</td>${extra}</tr></table>`,
      );
      try {
        const before = dom.window.document.body.innerHTML;
        prepareCodeEditors(dom.window.document);
        expect(dom.window.document.body.innerHTML).toBe(before);
      } finally {
        dom.window.close();
      }
    },
  );

  it.each([
    'data-lang="en"',
    'lang="en"',
    'class="lang-en"',
    'class="lang-js"',
    'data-lang="javascript"',
    'data-language="en"',
    'class="language-en"',
    'class="highlight-source-fr"',
  ])('ignores generic and natural language wrapper hints: %s', async (attribute) => {
    const html = `<div ${attribute}><div class="cm-editor"><div class="cm-content"><div class="cm-line">source</div></div></div></div>`;
    const dom = new JSDOM(html);
    try {
      prepareCodeEditors(dom.window.document);
      expect(dom.window.document.querySelector('code')?.hasAttribute('data-lang')).toBe(false);
      const result = await extractPageContent(
        `<article>${prose}${html}${prose}</article>`,
        'https://example.com/article',
      );
      const stored = new JSDOM(result.reader?.contentHtml);
      try {
        expect(stored.window.document.querySelector('code')?.hasAttribute('data-lang')).toBe(false);
      } finally {
        stored.window.close();
      }
    } finally {
      dom.window.close();
    }
  });

  it.each(['hidden', 'style="display:none"', 'aria-hidden="true"'])(
    'omits an editor hidden by %s, including inactive panels',
    async (attribute) => {
      const hidden = `<div class="cm-editor" ${attribute}><div class="cm-line">inactive sample</div></div>`;
      const panel = `<div ${attribute}><div class="cm-editor"><div class="cm-line">inactive panel</div></div></div>`;
      const visible = '<div class="cm-editor"><div class="cm-line">active sample</div></div>';
      const result = await extractPageContent(
        `<article>${prose}${hidden}${panel}${visible}${prose}</article>`,
        'https://example.com/article',
      );
      expect(result.reader?.contentHtml).toContain('active sample');
      expect(result.reader?.contentHtml).not.toContain('inactive');
      expect(result.text).not.toContain('inactive');
    },
  );

  it('restores CodeMirror 5 tab characters and orders Monaco lines by their top offset', () => {
    const dom =
      new JSDOM(`<div class="CodeMirror"><div class="CodeMirror-code"><pre class="CodeMirror-line">if (ready) {</pre><pre class="CodeMirror-line"><span cm-text="&#9;">    </span>run();</pre><pre class="CodeMirror-line">}</pre></div></div>
      <div class="monaco-editor"><div class="view-lines"><div class="view-line" style="top:40px">third</div><div class="view-line" style="top:0px">first</div><div class="view-line" style="top:20px">second</div></div></div>`);
    try {
      prepareCodeEditors(dom.window.document);
      expect(
        [...dom.window.document.querySelectorAll('code')].map((code) => code.textContent),
      ).toEqual(['if (ready) {\n\trun();\n}', 'first\nsecond\nthird']);
    } finally {
      dom.window.close();
    }
  });

  it.each(['\n', '<br>'])('treats a GitHub blank cell %j as one empty line', (blank) => {
    const dom = new JSDOM(
      `<table><tr><td class="blob-num">1</td><td class="blob-code">first</td></tr><tr><td class="blob-num">2</td><td class="blob-code">${blank}</td></tr><tr><td class="blob-num">3</td><td class="blob-code">last</td></tr></table>`,
    );
    try {
      prepareCodeEditors(dom.window.document);
      expect(dom.window.document.querySelector('code')?.textContent).toBe('first\n\nlast');
    } finally {
      dom.window.close();
    }
  });

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
    expect(result.text).toBe('Ordinary article.\nconst a = 1;\n run(a);');
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
