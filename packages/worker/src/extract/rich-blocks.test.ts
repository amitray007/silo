import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../fetch/safe-fetch.js';
import { sanitizeRenderedContent } from './reader-content.js';
import { extractPageContent } from './reader-page.js';
import { enrichRichBlocks, prepareCodeLanguages, prepareGists } from './rich-blocks.js';

vi.mock('../fetch/safe-fetch.js', () => ({ safeFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const url = 'https://article.example/post';
const prose =
  '<p>This technical article explains an example and its practical implications in detail.</p>'.repeat(
    10,
  );
const gistScript = '<script src="https://gist.github.com/author/abc123.js"></script>';
function reply(files: Record<string, unknown>) {
  return {
    ok: true as const,
    status: 200,
    html: JSON.stringify({ files }),
    finalUrl: 'https://api.github.com/gists/abc123',
    contentType: 'application/json',
  };
}

describe('leftover TeX', () => {
  it.each([
    ['$$x^2$$', 'block'],
    [String.raw`\[\frac{1}{2}\]`, 'block'],
    [String.raw`\(\alpha + x\)`, null],
    ['$x_i$', null],
    ['$x^2$', null],
    [String.raw`$\alpha$`, null],
  ])('converts %s in both worker paths', async (tex, display) => {
    const html = `<article>${prose}<p>${tex}</p></article>`;
    for (const result of [
      await extractPageContent(html, url),
      await sanitizeRenderedContent(html, url),
    ]) {
      const dom = new JSDOM(result.reader?.contentHtml);
      try {
        expect(dom.window.document.querySelector('math')).not.toBeNull();
        expect(dom.window.document.querySelector('math')?.getAttribute('display')).toBe(display);
        expect(dom.window.document.querySelector('math [style]')).toBeNull();
      } finally {
        dom.window.close();
      }
    }
  });
  it('keeps prices, unqualified dollars, escaped delimiters, edge spaces and invalid TeX', async () => {
    const text = String.raw`$5 and $10, $plain$, $ x^2$, $x^2 $, \$x^2\$, $\notARealCommand{x}$`;
    const result = await sanitizeRenderedContent(`<p>${text}</p>`, url);
    expect(result.reader?.contentHtml).not.toContain('<math');
    expect(result.text).toBe(text);
  });
  it('skips code, pre, kbd, samp and existing MathML', async () => {
    const html =
      '<code>$x^2$</code><pre>$$x^2$$</pre><kbd>\\(x\\)</kbd><samp>\\[x\\]</samp><math><mtext>$x^2$</mtext></math>';
    const result = await sanitizeRenderedContent(html, url);
    expect(result.reader?.contentHtml).toBe(html);
  });
  it('converts separate text nodes without eating intervening markup or error text', async () => {
    const result = await sanitizeRenderedContent(
      String.raw`<p>Before $x^2$ <em>and</em> $\notACommand$ after $y_1$.</p>`,
      url,
    );
    expect(result.reader?.contentHtml.match(/<math/g)).toHaveLength(2);
    expect(result.reader?.contentHtml).toContain('<em>and</em>');
    expect(result.reader?.contentHtml).toContain(String.raw`$\notACommand$ after`);
  });
});

describe('Gist expansion', () => {
  it('extracts script embeds through the static capture path with filenames and inert code', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      reply({
        'one.ts': {
          filename: 'one.ts',
          language: 'TypeScript',
          content: 'const html = "<script>alert(1)</script>";',
        },
      }),
    );
    const result = await extractPageContent(`<article>${prose}${gistScript}</article>`, url);
    expect(safeFetch).toHaveBeenCalledWith(
      'https://api.github.com/gists/abc123',
      expect.objectContaining({
        accept: 'application/vnd.github+json',
        maxBodyBytes: 2 * 1024 * 1024,
        timeoutMs: 2_000,
      }),
    );
    expect(result.reader?.contentHtml).toContain('>one.ts</a></figcaption>');
    expect(result.reader?.contentHtml).toContain('data-lang="typescript"');
    expect(result.reader?.contentHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('honors file selection, handles C++ and C#, and shares one request per id', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      reply({
        one: { filename: 'one.cpp', language: 'C++', content: 'int x;' },
        two: { filename: 'two.cs', language: 'C#', content: 'class Thing {}' },
      }),
    );
    const result = await sanitizeRenderedContent(
      '<pre><code data-lang="silo-gist">https://gist.github.com/a/abc123?file=two.cs</code></pre><pre><code data-lang="silo-gist">https://gist.github.com/a/abc123</code></pre>',
      url,
    );
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(result.reader?.contentHtml.match(/<figure>/g)).toHaveLength(3);
    expect(result.reader?.contentHtml).toContain('data-lang="cpp"');
    expect(result.reader?.contentHtml).toContain('data-lang="csharp"');
  });
  it('caps expansion at five slots, retaining a link for the sixth', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      reply({ one: { filename: 'a.js', language: 'JavaScript', content: 'ok' } }),
    );
    const html = Array.from(
      { length: 6 },
      (_, i) => `<pre><code data-lang="silo-gist">https://gist.github.com/a/abc12${i}</code></pre>`,
    ).join('');
    const result = await sanitizeRenderedContent(html, url);
    expect(safeFetch).toHaveBeenCalledTimes(5);
    expect(result.reader?.contentHtml.match(/<figure>/g)).toHaveLength(5);
    expect(result.reader?.contentHtml).toContain('href="https://gist.github.com/a/abc125"');
  });
  it.each([
    { one: { filename: 'large', content: 'é'.repeat(102_401) } },
    {
      one: { filename: 'a', content: 'x'.repeat(150_000) },
      two: { filename: 'b', content: 'x'.repeat(60_000) },
    },
    { one: { filename: 'a', content: 'partial', truncated: true } },
    {},
  ])('falls back when the API exceeds the code cap or is incomplete', async (files) => {
    vi.mocked(safeFetch).mockResolvedValue(reply(files));
    const result = await extractPageContent(`<article>${prose}${gistScript}</article>`, url);
    expect(result.reader?.contentHtml).toContain('View GitHub Gist');
    expect(result.reader?.contentHtml).not.toContain('<figure>');
  });
  it('accepts exactly 200 KB of code', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      reply({ one: { filename: 'a', content: 'x'.repeat(204_800) } }),
    );
    const result = await sanitizeRenderedContent(
      '<pre><code data-lang="silo-gist">https://gist.github.com/a/abc123</code></pre>',
      url,
    );
    expect(result.reader?.contentHtml).toContain('<figure>');
  });
  it.each(['failure', 'invalid-json', 'throw', 'missing-file'])(
    'keeps a link on %s',
    async (kind) => {
      if (kind === 'throw') vi.mocked(safeFetch).mockRejectedValue(new Error('network'));
      else if (kind === 'failure')
        vi.mocked(safeFetch).mockResolvedValue({ ok: false, reason: 'timeout' });
      else if (kind === 'invalid-json')
        vi.mocked(safeFetch).mockResolvedValue({ ...reply({}), html: 'bad' });
      else
        vi.mocked(safeFetch).mockResolvedValue(
          reply({ one: { filename: 'another', content: 'code' } }),
        );
      const result = await sanitizeRenderedContent(
        '<pre><code data-lang="silo-gist">https://gist.github.com/a/abc123?file=wanted</code></pre>',
        url,
      );
      expect(result.reader?.contentHtml).toContain('View GitHub Gist');
    },
  );
  it('does not fetch lookalike hosts and removes already rendered duplicates', async () => {
    const dom = new JSDOM(
      `<div class="gist">Old render</div>${gistScript}<link rel="stylesheet" href="https://github.githubassets.com/gist.css"><div class="gist">Next loaded render</div><script src="https://gist.github.com.evil/a/abc123.js"></script>`,
    );
    try {
      prepareGists(dom.window.document);
      expect(dom.window.document.body.textContent).not.toContain('Old render');
      expect(dom.window.document.body.textContent).not.toContain('Next loaded render');
      expect(dom.window.document.querySelectorAll('code[data-lang="silo-gist"]')).toHaveLength(1);
      vi.mocked(safeFetch).mockResolvedValue({ ok: false, reason: 'timeout' });
      await enrichRichBlocks(dom.window.document.body);
      expect(safeFetch).toHaveBeenCalledTimes(1);
    } finally {
      dom.window.close();
    }
  });
});

it('accepts a Gist script without an owner path', async () => {
  vi.mocked(safeFetch).mockResolvedValue(reply({ one: { filename: 'a.js', content: 'code' } }));
  const result = await extractPageContent(
    `<article>${prose}<script src="https://gist.github.com/abc123.js"></script></article>`,
    url,
  );
  expect(result.reader?.contentHtml).toContain('>a.js</a></figcaption>');
  expect(safeFetch).toHaveBeenCalledWith('https://api.github.com/gists/abc123', expect.anything());
});

it('keeps callout titles and bodies through static extraction', async () => {
  const result = await extractPageContent(
    `<article>${prose}<div class="callout" data-callout="tip"><div class="callout-title"><div class="callout-title-inner">Useful title</div></div><div class="callout-content"><p>Useful body</p></div></div></article>`,
    url,
  );
  expect(result.reader?.contentHtml).toContain('data-callout="tip"');
  expect(result.reader?.contentHtml).toContain('data-callout-title="Useful title"');
  expect(result.reader?.contentHtml).toContain('Useful body');
});

describe('bounded TeX scanning', () => {
  it.each([String.raw`\(`, String.raw`\[`, '$$'])(
    'leaves large unclosed %s text unchanged within 200 ms',
    async (opener) => {
      const dom = new JSDOM('');
      try {
        const container = dom.window.document.body;
        // Below the node cap: repeated unclosed openers exercise the scan itself.
        const text = (opener + 'x '.repeat(25)).repeat(1_800);
        container.textContent = text;
        const start = performance.now();
        await enrichRichBlocks(container);
        expect(performance.now() - start).toBeLessThan(200);
        expect(container.textContent).toBe(text);
        expect(container.querySelector('math')).toBeNull();
        container.textContent = opener + 'x'.repeat(200_000);
        const largeStart = performance.now();
        await enrichRichBlocks(container);
        expect(performance.now() - largeStart).toBeLessThan(200);
        expect(container.textContent).toBe(opener + 'x'.repeat(200_000));
      } finally {
        dom.window.close();
      }
    },
  );

  it('bounds each body inside the scan and skips oversized multibyte text nodes', async () => {
    const dom = new JSDOM('');
    try {
      const container = dom.window.document.body;
      const sources = [
        String.raw`\(` + ' '.repeat(10_000) + String.raw`x\)`,
        'é'.repeat(52_000) + '$x^2$',
      ];
      for (const source of sources) {
        container.textContent = source;
        await enrichRichBlocks(container);
        expect(container.textContent).toBe(source);
        expect(container.querySelector('math')).toBeNull();
      }
    } finally {
      dom.window.close();
    }
  });

  it('counts failed parses against the document attempt budget', async () => {
    const dom = new JSDOM('<p></p><p>$x^2$</p>');
    try {
      const first = dom.window.document.querySelector('p');
      const failures = String.raw`\(\notARealCommand\)`.repeat(2_000);
      if (first) first.textContent = failures;
      await enrichRichBlocks(dom.window.document.body);
      expect(dom.window.document.body.textContent).toBe(failures + '$x^2$');
      expect(dom.window.document.querySelector('math')).toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it('shares the 200 KB TeX budget across text nodes', async () => {
    const dom = new JSDOM('');
    try {
      const source = String.raw`\(` + ' '.repeat(9_990) + String.raw`x^2\)`;
      dom.window.document.body.innerHTML = '<p></p>'.repeat(22);
      for (const p of dom.window.document.querySelectorAll('p')) p.textContent = source;
      await enrichRichBlocks(dom.window.document.body);
      expect(dom.window.document.querySelectorAll('math')).toHaveLength(20);
      expect(dom.window.document.querySelector('p:last-child')?.textContent).toBe(source);
    } finally {
      dom.window.close();
    }
  });
});

it.each(['from $$ to $$$ here', '$$$$', '$$ plain $$', '$$$x^2$$', '$$x^2$$$'])(
  'keeps dollar runs and whitespace-edged prices as text: %s',
  async (text) => {
    const result = await sanitizeRenderedContent(`<p>${text}</p>`, url);
    expect(result.reader?.contentHtml).toBe(`<p>${text}</p>`);
  },
);

it('converts real inline math after rejected currency', async () => {
  const result = await sanitizeRenderedContent('<p>costs $5, and $x^2$ grows</p>', url);
  const dom = new JSDOM(result.reader?.contentHtml);
  try {
    expect(dom.window.document.querySelectorAll('math')).toHaveLength(1);
    expect(dom.window.document.querySelector('math')?.textContent).toBe('x2');
    expect(dom.window.document.querySelector('p')?.firstChild?.textContent).toBe('costs $5, and ');
    expect(dom.window.document.querySelector('p')?.lastChild?.textContent).toBe(' grows');
  } finally {
    dom.window.close();
  }
});

it.each([
  '<div data-callout="tip"><div class="callout-title">  Useful\n\t title   here </div><p>Body</p></div>',
  '<div data-callout="tip" data-callout-title="  Useful\n\t title   here "><p>Body</p></div>',
])('normalizes derived and pre-existing callout titles before sanitization', async (html) => {
  const result = await sanitizeRenderedContent(html, url);
  expect(result.reader?.contentHtml).toContain('data-callout-title="Useful title here"');
});

it('normalizes title whitespace before the 200 character cap', async () => {
  const result = await sanitizeRenderedContent(
    `<div data-callout="tip" data-callout-title="${' '.repeat(300)}Title${' '.repeat(300)}end"><p>Body</p></div>`,
    url,
  );
  expect(result.reader?.contentHtml).toContain('data-callout-title="Title end"');
});

it('uses explicit Mermaid markers before languages and only nearby language wrappers', () => {
  const dom = new JSDOM(`<body class="language-ruby"><main class="language-java">
    <pre id="page"><code>plain</code></pre>
    <div class="language-typescript"><pre id="near"><code>typed</code></pre></div>
    <div class="language-python"><pre id="diagram" class="mermaid"><code class="language-js">graph TD; A--&gt;B</code></pre></div>
    <div class="language-go"><div><div><div><pre id="far"><code>plain</code></pre></div></div></div></div>
    <pre id="icons" class="language-js"><svg></svg><code>const value = 1;</code></pre>
    <div class="mermaid"><svg><text>Already rendered</text></svg></div>
    <pre class="mermaid" data-processed="true">Processed diagram</pre>
  </main></body>`);
  try {
    prepareCodeLanguages(dom.window.document);
    expect(dom.window.document.querySelector('#page code')?.hasAttribute('data-lang')).toBe(false);
    expect(dom.window.document.querySelector('#near code')?.getAttribute('data-lang')).toBe(
      'typescript',
    );
    expect(dom.window.document.querySelector('#diagram code')?.getAttribute('data-lang')).toBe(
      'mermaid',
    );
    expect(dom.window.document.querySelector('#far code')?.hasAttribute('data-lang')).toBe(false);
    expect(dom.window.document.querySelector('#icons code')?.getAttribute('data-lang')).toBe('js');
    expect(dom.window.document.querySelector('div.mermaid svg')).not.toBeNull();
    expect(dom.window.document.querySelector('[data-processed] code')).toBeNull();
  } finally {
    dom.window.close();
  }
});
