import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractResult } from '../extract/extract.js';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { createLiveReader } from './live-reader.js';

const MINUTE = 60 * 1000;
const link = { id: 'one', url: 'https://example.org/a', sourceKind: 'link' };
const content = { contentHtml: '<p>Live body</p>', contentImages: ['https://cdn.test/a.png'] };

function page(html = '<html></html>', finalUrl = 'https://example.org/a'): SafeFetchResult {
  return { ok: true, html, contentType: 'text/html', finalUrl, status: 200 };
}

const signal = () => new AbortController().signal;
const withReader = async (): Promise<ExtractResult> => ({ status: 'full', reader: content });

describe('live reader', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches the link, extracts its Reader and returns only the Reader', async () => {
    const fetch = vi.fn(async () => page());
    const extract = vi.fn(withReader);
    const reader = createLiveReader({ fetch, extract });
    expect(await reader(link, signal())).toEqual(content);
    expect(fetch).toHaveBeenCalledWith(link.url);
    expect(extract).toHaveBeenCalledWith({
      url: 'https://example.org/a',
      html: '<html></html>',
      contentType: 'text/html',
    });
  });

  it('keeps a Reader for ten minutes, then fetches again', async () => {
    let time = 0;
    const fetch = vi.fn(async () => page());
    const reader = createLiveReader({ fetch, extract: withReader, now: () => time });
    await reader(link, signal());
    time = 10 * MINUTE - 1;
    await reader(link, signal());
    expect(fetch).toHaveBeenCalledTimes(1);
    time = 10 * MINUTE + 1;
    await reader(link, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a miss for two minutes only', async () => {
    let time = 0;
    const fetch = vi.fn(async (): Promise<SafeFetchResult> => ({ ok: false, reason: 'timeout' }));
    const reader = createLiveReader({ fetch, extract: withReader, now: () => time });
    expect(await reader(link, signal())).toBeUndefined();
    time = 2 * MINUTE - 1;
    expect(await reader(link, signal())).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    time = 2 * MINUTE + 1;
    await reader(link, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats a page with no Reader content, or a thrown extraction, as a miss', async () => {
    const fetch = vi.fn(async () => page());
    const empty = createLiveReader({ fetch, extract: async () => ({ status: 'bare' }) });
    expect(await empty(link, signal())).toBeUndefined();
    const broken = createLiveReader({
      fetch,
      extract: async () => {
        throw new Error('reader-timeout');
      },
    });
    expect(await broken(link, signal())).toBeUndefined();
  });

  it('rejects Reader content that fails the stored-content schema', async () => {
    const reader = createLiveReader({
      fetch: async () => page(),
      extract: async () => ({
        status: 'full',
        reader: { contentHtml: '<p>x</p>', contentImages: ['javascript:alert(1)'] },
      }),
    });
    expect(await reader(link, signal())).toBeUndefined();
  });

  it('never reads an X post', async () => {
    const fetch = vi.fn(async () => page());
    const extract = vi.fn(withReader);
    const reader = createLiveReader({ fetch, extract });
    expect(await reader({ ...link, sourceKind: 'twitter' }, signal())).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('prefers the watch-page description for YouTube', async () => {
    const watch = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      videoDetails: {
        videoId: 'abcdefghijk',
        shortDescription: 'Chapters\n\n0:00 Intro',
        author: 'Channel',
      },
    })};</script>`;
    const watchUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
    const reader = createLiveReader({
      fetch: async () => page(watch, watchUrl),
      extract: withReader,
    });
    const result = await reader({ id: 'yt', url: watchUrl, sourceKind: 'youtube' }, signal());
    expect(result?.contentHtml).toContain('t=0s');
    expect(result?.contentHtml).not.toContain('Live body');
  });

  it('falls back to the extracted Reader when a YouTube page has no watch JSON', async () => {
    const reader = createLiveReader({ fetch: async () => page(), extract: withReader });
    const result = await reader(
      { id: 'yt', url: 'https://www.youtube.com/watch?v=abcdefghijk', sourceKind: 'youtube' },
      signal(),
    );
    expect(result).toEqual(content);
  });

  it('shares one fetch between overlapping requests for a link', async () => {
    let release: (value: SafeFetchResult) => void = () => {};
    const fetch = vi.fn(() => new Promise<SafeFetchResult>((resolve) => (release = resolve)));
    const reader = createLiveReader({ fetch, extract: withReader });
    const results = [reader(link, signal()), reader(link, signal())];
    release(page());
    expect(await Promise.all(results)).toEqual([content, content]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches different links separately', async () => {
    const fetch = vi.fn(async () => page());
    const reader = createLiveReader({ fetch, extract: withReader });
    await Promise.all([reader(link, signal()), reader({ ...link, id: 'two' }, signal())]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('lets one caller abort without cancelling another', async () => {
    let release: (value: SafeFetchResult) => void = () => {};
    const fetch = vi.fn(() => new Promise<SafeFetchResult>((resolve) => (release = resolve)));
    const reader = createLiveReader({ fetch, extract: withReader });
    const leaving = new AbortController();
    const first = reader(link, leaving.signal);
    const second = reader(link, signal());
    leaving.abort();
    expect(await first).toBeUndefined();
    release(page());
    expect(await second).toEqual(content);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The shared work still filled the cache for the next open.
    expect(await reader(link, signal())).toEqual(content);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers an already aborted caller without fetching', async () => {
    const fetch = vi.fn(async () => page());
    const reader = createLiveReader({ fetch, extract: withReader });
    expect(await reader(link, AbortSignal.abort())).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refetches when the stored URL of a link changes', async () => {
    const fetch = vi.fn(async () => page());
    const reader = createLiveReader({ fetch, extract: withReader });
    await reader(link, signal());
    await reader({ ...link, url: 'https://example.org/moved' }, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 200 links, dropping the oldest first', async () => {
    const fetch = vi.fn(async () => page());
    const reader = createLiveReader({ fetch, extract: withReader });
    for (let index = 0; index < 201; index++) await reader({ ...link, id: `l${index}` }, signal());
    expect(fetch).toHaveBeenCalledTimes(201);
    await reader({ ...link, id: 'l200' }, signal());
    expect(fetch).toHaveBeenCalledTimes(201);
    await reader({ ...link, id: 'l0' }, signal());
    expect(fetch).toHaveBeenCalledTimes(202);
  });

  it('clear() forgets every cached Reader', async () => {
    const fetch = vi.fn(async () => page());
    const reader = createLiveReader({ fetch, extract: withReader });
    await reader(link, signal());
    reader.clear();
    await reader(link, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
