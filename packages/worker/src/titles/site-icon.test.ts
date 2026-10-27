import { describe, expect, it, vi } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { createSiteIconFinder } from './site-icon.js';

function page(head: string, finalUrl = 'https://example.com/'): SafeFetchResult {
  return {
    ok: true,
    html: `<!doctype html><html><head>${head}</head><body></body></html>`,
    contentType: 'text/html',
    finalUrl,
    status: 200,
  };
}

const signal = () => new AbortController().signal;

async function iconFor(head: string, finalUrl?: string): Promise<string | undefined> {
  const find = createSiteIconFinder({ fetch: async () => page(head, finalUrl) });
  return find('example.com', signal());
}

describe('site icon finder', () => {
  it('resolves a relative icon href against the page URL', async () => {
    expect(await iconFor('<link rel="icon" href="/img/fav.png" type="image/png">')).toBe(
      'https://example.com/img/fav.png',
    );
  });

  it('matches "shortcut icon"', async () => {
    expect(await iconFor('<link rel="Shortcut Icon" href="fav.ico">')).toBe(
      'https://example.com/fav.ico',
    );
  });

  it('prefers the size closest to 32px', async () => {
    const head = `
      <link rel="icon" href="/16.png" sizes="16x16">
      <link rel="icon" href="/48.png" sizes="48x48">
      <link rel="icon" href="/32.png" sizes="32x32">
      <link rel="icon" href="/512.png" sizes="512x512">`;
    expect(await iconFor(head)).toBe('https://example.com/32.png');
  });

  it('prefers a known raster format over an unknown one', async () => {
    const head = `
      <link rel="icon" href="/unknown" sizes="32x32">
      <link rel="icon" href="/known.png" sizes="64x64">`;
    expect(await iconFor(head)).toBe('https://example.com/known.png');
  });

  it('skips SVG icons by type or extension', async () => {
    const head = `
      <link rel="icon" href="/a.svg">
      <link rel="icon" href="/b" type="image/svg+xml">
      <link rel="icon" href="/c.png">`;
    expect(await iconFor(head)).toBe('https://example.com/c.png');
  });

  it('falls back to apple-touch-icon when only SVG icons exist', async () => {
    const head = `
      <link rel="icon" href="/a.svg">
      <link rel="apple-touch-icon" href="/touch.png">`;
    expect(await iconFor(head)).toBe('https://example.com/touch.png');
  });

  it('falls back to /favicon.ico when the head declares no icon', async () => {
    expect(await iconFor('<title>x</title>')).toBe('https://example.com/favicon.ico');
  });

  it('keeps only http(s) icon URLs', async () => {
    const head = `
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">`;
    expect(await iconFor(head)).toBe('https://example.com/favicon.ico');
  });

  it('uses the final URL after redirects as the base', async () => {
    const head = '<link rel="icon" href="favicon.png" type="image/png">';
    expect(await iconFor(head, 'https://skills.klvn.dev/fun-isometric')).toBe(
      'https://skills.klvn.dev/favicon.png',
    );
    expect(await iconFor(head, 'https://skills.klvn.dev/fun-isometric/')).toBe(
      'https://skills.klvn.dev/fun-isometric/favicon.png',
    );
    expect(await iconFor('', 'https://www.other.test/home')).toBe(
      'https://www.other.test/favicon.ico',
    );
  });

  it('tries the conventional path when the home page returns an HTTP error', async () => {
    const fetch = vi.fn(
      async (): Promise<SafeFetchResult> => ({ ok: false, reason: 'http-error' }),
    );
    const find = createSiteIconFinder({ fetch });
    expect(await find('example.com', signal())).toBe('https://example.com/favicon.ico');
  });

  it('finds nothing when the site is unreachable', async () => {
    const fetch = vi.fn(async (): Promise<SafeFetchResult> => ({ ok: false, reason: 'dns-error' }));
    const find = createSiteIconFinder({ fetch });
    expect(await find('example.com', signal())).toBeUndefined();
  });

  it('caches hits and misses for a day, then refetches', async () => {
    let time = 0;
    const fetch = vi.fn(
      async (url: string): Promise<SafeFetchResult> =>
        url.includes('dead.test')
          ? { ok: false, reason: 'timeout' }
          : page('<link rel="icon" href="/i.png">'),
    );
    const find = createSiteIconFinder({ fetch, now: () => time });
    await find('example.com', signal());
    await find('example.com', signal());
    await find('dead.test', signal());
    await find('dead.test', signal());
    expect(fetch).toHaveBeenCalledTimes(2);
    time = 24 * 60 * 60 * 1000 + 1;
    await find('example.com', signal());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('shares one fetch between overlapping lookups for a domain', async () => {
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return page('<link rel="icon" href="/i.png">');
    });
    const find = createSiteIconFinder({ fetch });
    const [a, b] = await Promise.all([
      find('Example.com', signal()),
      find('example.com', signal()),
    ]);
    expect(a).toBe('https://example.com/i.png');
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined as soon as the caller aborts', async () => {
    const fetch = vi.fn(() => new Promise<SafeFetchResult>(() => {}));
    const find = createSiteIconFinder({ fetch });
    const controller = new AbortController();
    const result = find('example.com', controller.signal);
    controller.abort();
    expect(await result).toBeUndefined();
  });
});
