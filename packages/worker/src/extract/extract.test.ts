import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { buildExtractVirtualConsole, extract } from './extract.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

const URL_UNDER_TEST = 'https://journal.example.com/posts/static-extraction';

describe('extract — full capture', () => {
  it('extracts title/description/image/siteName + non-trivial text from a normal article', async () => {
    const result = await extract({
      url: URL_UNDER_TEST,
      html: fixture('article.html'),
      contentType: 'text/html; charset=utf-8',
    });

    expect(result.status).toBe('full');
    expect(result.title).toBe('How Static Extraction Saved Our Weekend');
    expect(result.description).toContain('metascraper and Readability');
    expect(result.imageUrl).toBe('https://example.com/images/weekend.png');
    expect(result.siteName).toBe('The Silo Journal');
    expect(result.text).toBeDefined();
    expect(result.text?.length ?? 0).toBeGreaterThanOrEqual(200);
    expect(result.text).toContain('headless browser');
  });
});

describe('extract — OG-tags-only SPA shell', () => {
  it('extracts metadata but classifies partial when the body has no readable content', async () => {
    const result = await extract({
      url: 'https://app.example.com/dashboard',
      html: fixture('spa-og-only.html'),
      contentType: 'text/html',
    });

    expect(result.status).toBe('partial');
    expect(result.title).toBe('Dashboard — Acme App');
    expect(result.description).toBe('Manage your Acme workspace from anywhere.');
    expect(result.imageUrl).toBe('https://example.com/acme-og.png');
    // The body is a genuinely empty `<div id="root"></div>` shell with no
    // prose at all — Readability deterministically finds nothing usable, so
    // `text` is pinned to undefined rather than a "short or absent" check.
    expect(result.text).toBeUndefined();
  });
});

describe('extract — __NEXT_DATA__-bearing SPA', () => {
  it('recovers text/metadata via embedded-JSON when Readability text is thin', async () => {
    const result = await extract({
      url: URL_UNDER_TEST,
      html: fixture('next-data.html'),
      contentType: 'text/html',
    });

    // Readability has nothing to work with (empty body), but the embedded
    // __NEXT_DATA__ blob carries a long enough "content" field to clear the
    // full-text threshold, so this should recover as a full capture.
    expect(result.title).toBe('Recovered From __NEXT_DATA__');
    expect(result.description).toBe('A short excerpt describing the recovered post.');
    expect(result.text).toBeDefined();
    expect(result.text).toContain('embedded inside the Next.js page props JSON blob');
    expect(result.status).toBe('full');
  });
});

describe('extract — empty JS-wall shell', () => {
  it('classifies as partial via the noscript + empty-root SPA heuristic', async () => {
    const result = await extract({
      url: 'https://app.example.com/',
      html: fixture('js-wall-empty.html'),
      contentType: 'text/html',
    });

    expect(result.status).toBe('partial');
  });

  it('classifies a truly empty page (no metadata, no text, no SPA markers) as bare', async () => {
    const result = await extract({
      url: 'https://empty.example.com/',
      html: fixture('bare-empty.html'),
      contentType: 'text/html',
    });

    expect(result.status).toBe('bare');
    expect(result.title).toBeUndefined();
    expect(result.text).toBeUndefined();
  });
});

describe('extract — non-HTML content-type', () => {
  it('classifies application/pdf as bare without attempting to parse', async () => {
    const result = await extract({
      url: 'https://example.com/whitepaper.pdf',
      html: '%PDF-1.4 binary garbage that is not html at all',
      contentType: 'application/pdf',
    });

    expect(result).toEqual({ status: 'bare' });
  });

  it('classifies application/json as bare without attempting to parse', async () => {
    const result = await extract({
      url: 'https://api.example.com/data',
      html: '{"not":"html"}',
      contentType: 'application/json',
    });

    expect(result).toEqual({ status: 'bare' });
  });
});

describe('extract — null/short inputs classify without throwing', () => {
  it('handles an empty HTML string', async () => {
    await expect(
      extract({ url: 'https://example.com/', html: '', contentType: 'text/html' }),
    ).resolves.toMatchObject({ status: 'bare' });
  });

  it('handles HTML with only a very short description and no article body', async () => {
    const html = `
      <html><head><title>T</title><meta name="description" content="short" /></head>
      <body><p>hi</p></body></html>
    `;
    const result = await extract({ url: 'https://example.com/', html, contentType: 'text/html' });
    expect(result.status).toBe('partial');
    expect(result.description).toBe('short');
  });
});

describe('extract — security: jsdom does not execute scripts', () => {
  it('constructs the DOM the same way extract.ts does, and the inline script never runs', () => {
    // This is the load-bearing proof: construct a JSDOM exactly the way
    // `extractReadableText` in extract.ts does (`new JSDOM(html, { url })`,
    // no `runScripts`/`resources` option), and assert directly against
    // jsdom's OWN `window`/`document` — not against metascraper's output.
    // metascraper parses the raw HTML string with its own independent
    // cheerio DOM, so an assertion on metascraper's title would pass
    // identically even if jsdom's `runScripts` were mistakenly enabled;
    // this test instead observes the exact object the security property is
    // actually about.
    const html = fixture('script-injection.html');
    const dom = new JSDOM(html, { url: 'https://example.com/injection-test' });

    // The fixture's inline script (a) sets `window.__pwned = true`
    // synchronously and (b) registers a DOMContentLoaded handler that
    // rewrites the article body — if scripts executed at all, `__pwned`
    // would be set immediately, and jsdom (which does fire lifecycle events
    // once parsing completes) would eventually run the handler too. Neither
    // must happen.
    expect((dom.window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(dom.window.document.title).toBe('Legit Title, Not Tampered');
    expect(dom.window.document.getElementById('article-body')?.textContent).toContain(
      'This fixture proves jsdom scripts never execute',
    );
    expect(dom.window.document.getElementById('article-body')?.textContent).not.toContain(
      'ZZPWNEDZZ',
    );
  });

  it('end-to-end: extract() returns the real title/text, not the hostile-script values', async () => {
    // Secondary, integration-level proof through the full pipeline — kept
    // alongside the direct jsdom test above (which is the actual security
    // guarantee) as a functional regression check on the real call path.
    const result = await extract({
      url: 'https://example.com/injection-test',
      html: fixture('script-injection.html'),
      contentType: 'text/html',
    });

    expect(result.title).toBe('Legit Title, Not Tampered');
    expect(result.title).not.toBe('ZZPWNEDZZ');
    expect(result.text).toContain('This fixture proves jsdom scripts never execute');
    expect(result.text).not.toContain('ZZPWNEDZZ');
  });
});

describe('extract — siteName fallback behavior', () => {
  it('uses metascraper publisher when present (article fixture has og:site_name)', async () => {
    const result = await extract({
      url: URL_UNDER_TEST,
      html: fixture('article.html'),
      contentType: 'text/html',
    });
    expect(result.siteName).toBe('The Silo Journal');
  });

  it('falls back to the request URL hostname when no publisher metadata is present', async () => {
    const result = await extract({
      url: 'https://www.no-publisher-example.com/posts/x',
      html: fixture('no-publisher.html'),
      contentType: 'text/html',
    });
    // No publisher / og:site_name tag in the fixture at all — falls back to
    // the URL's own hostname, with a leading "www." stripped.
    expect(result.siteName).toBe('no-publisher-example.com');
  });

  it('picks up og:site_name via metascraper-publisher (verified library behavior, not the hostname fallback)', async () => {
    const result = await extract({
      url: 'https://www.og-example.com/posts/x',
      html: fixture('og-site-name-only.html'),
      contentType: 'text/html',
    });
    // metascraper-publisher's own rule chain reads `og:site_name` as a
    // publisher signal (confirmed by direct inspection of metascraper's
    // output for this fixture) — so this fixture actually exercises the
    // "publisher present" branch of runMetascraper's fallback, not the
    // hostname-fallback branch. Pinned to the exact, deterministic value
    // rather than accepting either outcome, so a metascraper version bump
    // that silently drops this og:site_name-sniffing behavior is caught.
    expect(result.siteName).toBe('Example Og Site');
  });
});

describe('extract — JS-wall field preservation (regression)', () => {
  it('a JS-walled shell carrying og:image/og:site_name keeps those fields (not dropped)', async () => {
    // Regression guard: a JS-wall shell with no title/description but WITH an
    // og:image / og:site_name must classify `partial` AND retain the image and
    // site fields — an earlier form dropped them when forcing `partial`.
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.png" />
      <meta property="og:site_name" content="Acme" />
      </head><body><div id="root"></div><noscript>Please enable JavaScript.</noscript></body></html>`;
    const result = await extract({
      url: 'https://app.example.com/',
      html,
      contentType: 'text/html',
    });
    expect(result.status).toBe('partial');
    expect(result.imageUrl).toBe('https://cdn.example.com/hero.png');
    expect(result.siteName).toBe('Acme');
  });
});

describe('extract — jsdom CSS-parse noise is suppressed', () => {
  it('does not log "Could not parse CSS stylesheet" for a page whose CSS jsdom cannot parse', async () => {
    // `unparseable-css.html` uses native CSS nesting, which jsdom's CSS
    // parser (rrweb-cssom) cannot parse — verified directly against jsdom's
    // OWN default virtual console (no fix applied) before this fixture was
    // committed: it deterministically logs exactly "Could not parse CSS
    // stylesheet" to console.error. This is cosmetic noise (see the
    // `virtualConsole` comment in extractReadableText) — the DOM and
    // readable text extract fine regardless — so extract() must not let it
    // reach the worker's stderr.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await extract({
      url: URL_UNDER_TEST,
      html: fixture('unparseable-css.html'),
      contentType: 'text/html',
    });

    const cssParseNoise = consoleErrorSpy.mock.calls.filter(([arg]) =>
      typeof arg === 'string'
        ? arg === 'Could not parse CSS stylesheet'
        : arg instanceof Error && arg.message === 'Could not parse CSS stylesheet',
    );
    expect(cssParseNoise).toHaveLength(0);

    // Extraction itself must be unaffected — the CSS jsdom couldn't parse
    // never mattered to Readability, which only reads text/DOM structure.
    expect(result.title).toContain('Nested CSS Trips');
    expect(result.text).toContain('does not prevent DOM construction');

    consoleErrorSpy.mockRestore();
  });

  it('still forwards a genuine jsdom-internal error to console.error (not blanket-suppressed)', () => {
    // Guard against an overly broad fix (e.g. suppressing ALL `jsdomError`s
    // rather than only the specific CSS-parse message). Builds the REAL
    // production `VirtualConsole` via `buildExtractVirtualConsole` — the
    // exact listener extractReadableText wires up, not a copy that merely
    // claims to be wired "the same way" — then emits a real `jsdomError`
    // event through jsdom's own EventEmitter-based API (not a reimplemented
    // predicate called directly) with a message OTHER than "Could not parse
    // CSS stylesheet". It must still reach console.error.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const virtualConsole = buildExtractVirtualConsole();

    const otherError = new Error('some other jsdom-internal failure');
    virtualConsole.emit('jsdomError', otherError);
    expect(consoleErrorSpy).toHaveBeenCalledWith(otherError);

    // Same real listener, the CSS-parse message specifically — still
    // suppressed, proving the filter targets that one message rather than
    // having been broadened/narrowed by this refactor.
    consoleErrorSpy.mockClear();
    virtualConsole.emit('jsdomError', new Error('Could not parse CSS stylesheet'));
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe('extract — never throws (contract)', () => {
  it('degrades an unparseable url to bare instead of throwing', async () => {
    await expect(
      extract({
        url: 'not a url',
        html: '<html><body><p>hi</p></body></html>',
        contentType: 'text/html',
      }),
    ).resolves.toEqual({ status: 'bare' });
  });
});
