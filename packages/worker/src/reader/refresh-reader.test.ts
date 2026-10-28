import { describe, expect, it, vi } from 'vitest';
import { createReaderRefresher } from './refresh-reader.js';

const link = { id: 'one', url: 'https://example.org/a', sourceKind: 'link' };
const reader = { contentHtml: '<p>Body</p>', contentImages: [] };
const page = {
  ok: true as const,
  html: '<html></html>',
  finalUrl: link.url,
  contentType: 'text/html',
  status: 200,
};
const signal = () => new AbortController().signal;

describe('Reader refresh extraction', () => {
  it('fetches and extracts once and invalidates the live entry', async () => {
    const invalidate = vi.fn();
    const fetch = vi.fn(async () => page);
    const extract = vi.fn(async () => ({ status: 'full' as const, reader, text: 'New text' }));
    const run = createReaderRefresher(invalidate, { fetch, extract });
    expect(await run(link, signal())).toEqual({ status: 'reader', reader, text: 'New text' });
    expect(fetch).toHaveBeenCalledWith(link.url, expect.any(AbortSignal));
    expect(extract).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith(link.id);
  });
  it('distinguishes successful no Reader from fetch failure, challenge and parser failure', async () => {
    const invalidate = vi.fn();
    const run = createReaderRefresher(invalidate, {
      fetch: async () => page,
      extract: async () => ({ status: 'bare' }),
    });
    expect(await run(link, signal())).toEqual({ status: 'no_reader' });
    const failed = createReaderRefresher(invalidate, {
      fetch: async () => ({ ok: false, reason: 'timeout' }),
    });
    expect(await failed(link, signal())).toEqual({ status: 'fetch_failed' });
    const challenge = createReaderRefresher(invalidate, {
      fetch: async () => page,
      extract: async () => ({ status: 'partial', readerFailed: true }),
    });
    expect(await challenge(link, signal())).toEqual({ status: 'fetch_failed' });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('does not accept a result after its deadline signal aborts', async () => {
    const controller = new AbortController();
    const invalidate = vi.fn();
    const run = createReaderRefresher(invalidate, {
      fetch: async () => page,
      extract: async () => {
        controller.abort();
        return { status: 'full', reader };
      },
    });
    expect(await run(link, controller.signal)).toEqual({ status: 'fetch_failed' });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

it('rejects an oversized Reader without invalidating live content', async () => {
  const invalidate = vi.fn();
  const run = createReaderRefresher(invalidate, {
    fetch: async () => page,
    extract: async () => ({
      status: 'full',
      reader: { contentHtml: 'x'.repeat(1024 * 1024 + 1), contentImages: [] },
    }),
  });
  expect(await run(link, signal())).toEqual({ status: 'fetch_failed' });
  expect(invalidate).not.toHaveBeenCalled();
});
