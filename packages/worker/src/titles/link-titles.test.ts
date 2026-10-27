import { describe, expect, it, vi } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { createLinkTitleFetcher } from './link-titles.js';

function page(html: string, contentType = 'text/html'): SafeFetchResult {
  return { ok: true, html, contentType, finalUrl: 'https://example.com/', status: 200 };
}

const signal = () => new AbortController().signal;

describe('link title fetcher', () => {
  it('reads og:title or <title> and keeps results for a day', async () => {
    let time = 0;
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('og')
        ? page('<head><meta property="og:title" content="The Bus Ticket Theory of Genius"></head>')
        : page('<html><head><title>  Plain &amp; Simple </title></head><body>x</body></html>'),
    );
    const titles = createLinkTitleFetcher({ fetch, now: () => time });
    const urls = ['https://a.test/og', 'https://a.test/plain'];
    expect(await titles(urls, signal())).toEqual({
      'https://a.test/og': 'The Bus Ticket Theory of Genius',
      'https://a.test/plain': 'Plain & Simple',
    });
    await titles(urls, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
    time = 24 * 60 * 60 * 1000 + 1;
    await titles(urls, signal());
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('caches failures and non-HTML pages as having no title', async () => {
    const fetch = vi.fn(
      async (url: string): Promise<SafeFetchResult> =>
        url.endsWith('pdf') ? page('%PDF', 'application/pdf') : { ok: false, reason: 'timeout' },
    );
    const titles = createLinkTitleFetcher({ fetch });
    const urls = ['https://a.test/x.pdf', 'https://a.test/dead'];
    expect(await titles(urls, signal())).toEqual({});
    expect(await titles(urls, signal())).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between overlapping requests and limits concurrency', async () => {
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return page('<title>T</title>');
    });
    const titles = createLinkTitleFetcher({ fetch });
    const urls = Array.from({ length: 10 }, (_, index) => `https://a.test/${index}`);
    await Promise.all([titles(urls, signal()), titles(urls, signal())]);
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('does not cache an aborted lookup', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort();
      return { ok: false, reason: 'timeout' } as SafeFetchResult;
    });
    const titles = createLinkTitleFetcher({ fetch });
    await titles(['https://a.test/slow'], controller.signal);
    await titles(['https://a.test/slow'], signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
