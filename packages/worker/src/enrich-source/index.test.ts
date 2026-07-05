import { describe, expect, it } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { enrichSource } from './index.js';

function okResult(body: unknown): SafeFetchResult {
  return {
    ok: true,
    html: JSON.stringify(body),
    contentType: 'application/json',
    finalUrl: 'https://example.com',
    status: 200,
  };
}

describe('enrichSource', () => {
  it('dispatches hacker_news urls to the HN enricher', async () => {
    const result = await enrichSource('hacker_news', 'https://news.ycombinator.com/item?id=1', {
      fetchFn: () => Promise.resolve(okResult({ score: 10, descendants: 2, by: 'pg' })),
    });
    expect(result).toEqual({ kind: 'hacker_news', points: 10, comments: 2, author: 'pg' });
  });

  it('dispatches github urls to the GitHub enricher', async () => {
    const result = await enrichSource('github', 'https://github.com/vercel/next.js', {
      fetchFn: () =>
        Promise.resolve(okResult({ stargazers_count: 1, forks_count: 2, open_issues_count: 3 })),
    });
    expect(result).toEqual({ kind: 'github', stars: 1, forks: 2, issues: 3 });
  });

  it('dispatches youtube urls to the YouTube enricher', async () => {
    const result = await enrichSource('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      fetchFn: () => Promise.resolve(okResult({ author_name: 'Rick Astley' })),
    });
    expect(result).toEqual({
      kind: 'youtube',
      channel: 'Rick Astley',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });

  it('resolves undefined for a plain link sourceKind (no enricher to run)', async () => {
    const result = await enrichSource('link', 'https://example.com/article', {
      fetchFn: () => Promise.resolve(okResult({})),
    });
    expect(result).toBeUndefined();
  });

  it('resolves undefined for an unrecognized sourceKind', async () => {
    const result = await enrichSource('twitter', 'https://twitter.com/x/status/1', {
      fetchFn: () => Promise.resolve(okResult({})),
    });
    expect(result).toBeUndefined();
  });

  it('resolves undefined when the stored sourceKind no longer matches what the url detects as', async () => {
    // e.g. a link whose sourceKind was explicitly set to hacker_news but whose
    // url is actually a plain example.com link (a mismatch that should never
    // happen in practice, but must degrade safely rather than mis-enrich).
    const result = await enrichSource('hacker_news', 'https://example.com/not-hn', {
      fetchFn: () => Promise.resolve(okResult({ score: 1, by: 'x' })),
    });
    expect(result).toBeUndefined();
  });

  it('degrades to undefined (never throws) when the underlying enricher fetch fails', async () => {
    const result = await enrichSource('github', 'https://github.com/owner/repo', {
      fetchFn: () => Promise.resolve({ ok: false, reason: 'timeout' }),
    });
    expect(result).toBeUndefined();
  });

  it('degrades to undefined (never throws) when fetchFn itself rejects unexpectedly', async () => {
    await expect(
      enrichSource('hacker_news', 'https://news.ycombinator.com/item?id=1', {
        fetchFn: () => Promise.reject(new Error('network explosion')),
      }),
    ).resolves.toBeUndefined();
  });

  it('uses the real safeFetch by default when no deps are injected (smoke: does not throw synchronously)', async () => {
    // Not a network test — just proves the default-deps wiring is well-typed
    // and callable; a plain-link url never reaches the network at all.
    await expect(enrichSource('link', 'https://example.com')).resolves.toBeUndefined();
  });
});
