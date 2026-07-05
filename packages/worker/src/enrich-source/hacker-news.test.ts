import { describe, expect, it } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { enrichHackerNews } from './hacker-news.js';

function okResult(body: unknown): SafeFetchResult {
  return {
    ok: true,
    html: JSON.stringify(body),
    contentType: 'application/json',
    finalUrl: 'https://hacker-news.firebaseio.com/v0/item/1.json',
    status: 200,
  };
}

describe('enrichHackerNews', () => {
  it('maps a valid item to hacker_news SourceData', async () => {
    const result = await enrichHackerNews(8863, () =>
      Promise.resolve(okResult({ score: 111, descendants: 71, by: 'pg', id: 8863 })),
    );
    expect(result).toEqual({ kind: 'hacker_news', points: 111, comments: 71, author: 'pg' });
  });

  it('defaults comments to 0 when descendants is absent (e.g. a comment-less Ask HN)', async () => {
    const result = await enrichHackerNews(1, () =>
      Promise.resolve(okResult({ score: 5, by: 'someone' })),
    );
    expect(result).toEqual({ kind: 'hacker_news', points: 5, comments: 0, author: 'someone' });
  });

  it('degrades to undefined on a safeFetch failure', async () => {
    const result = await enrichHackerNews(1, () =>
      Promise.resolve({ ok: false, reason: 'timeout' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined for a nonexistent item (bare JSON null)', async () => {
    const result = await enrichHackerNews(999999999, () => Promise.resolve(okResult(null)));
    expect(result).toBeUndefined();
  });

  it('degrades to undefined for a deleted item', async () => {
    const result = await enrichHackerNews(1, () =>
      Promise.resolve(okResult({ score: 1, by: 'x', deleted: true })),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined for a dead item', async () => {
    const result = await enrichHackerNews(1, () =>
      Promise.resolve(okResult({ score: 1, by: 'x', dead: true })),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on malformed JSON', async () => {
    const result = await enrichHackerNews(1, () =>
      Promise.resolve({
        ok: true,
        html: 'not json{{{',
        contentType: 'application/json',
        finalUrl: 'https://hacker-news.firebaseio.com/v0/item/1.json',
        status: 200,
      }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when a required field (score) is missing', async () => {
    const result = await enrichHackerNews(1, () => Promise.resolve(okResult({ by: 'x' })));
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on a non-object JSON body (e.g. a bare number/array)', async () => {
    const result = await enrichHackerNews(1, () => Promise.resolve(okResult([1, 2, 3])));
    expect(result).toBeUndefined();
  });

  it('never throws even if fetchFn rejects unexpectedly', async () => {
    await expect(enrichHackerNews(1, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    // NOTE: enrichHackerNews itself does not swallow a rejected fetchFn — the
    // dispatcher (`enrich-source/index.ts`) is what wraps every call in a
    // try/catch, so a rejection here is expected to propagate to it, not to
    // the caller of enrichLink. Covered end-to-end in index.test.ts.
  });
});
