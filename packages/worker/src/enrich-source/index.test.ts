import { SETTINGS_DEFAULTS } from '@silo/core';
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
    const result = await enrichSource('some_future_kind', 'https://example.com/whatever', {
      fetchFn: () => Promise.resolve(okResult({})),
    });
    expect(result).toBeUndefined();
  });

  it('dispatches twitter status urls to the FxEmbed enricher', async () => {
    const result = await enrichSource('twitter', 'https://x.com/elonmusk/status/42', {
      fetchFn: () =>
        Promise.resolve(
          okResult({
            code: 200,
            tweet: {
              text: 'hello world',
              author: { screen_name: 'elonmusk', name: 'Elon Musk' },
              replies: 1,
              retweets: 2,
              likes: 3,
              bookmarks: 4,
              quotes: 5,
            },
          }),
        ),
    });
    expect(result).toEqual({
      kind: 'twitter',
      text: 'hello world',
      authorHandle: 'elonmusk',
      authorName: 'Elon Musk',
      replies: 1,
      reposts: 2,
      likes: 3,
      bookmarks: 4,
      quotes: 5,
    });
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

  describe('registry dispatch (plan 017 — the switch -> registry extraction)', () => {
    it('still dispatches all 4 registered kinds to their own enricher (github)', async () => {
      const result = await enrichSource('github', 'https://github.com/vercel/next.js', {
        fetchFn: () =>
          Promise.resolve(okResult({ stargazers_count: 5, forks_count: 6, open_issues_count: 7 })),
      });
      expect(result).toEqual({ kind: 'github', stars: 5, forks: 6, issues: 7 });
    });

    it('still dispatches all 4 registered kinds to their own enricher (youtube)', async () => {
      const result = await enrichSource('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        fetchFn: () => Promise.resolve(okResult({ author_name: 'Someone' })),
      });
      expect(result).toEqual({
        kind: 'youtube',
        channel: 'Someone',
        thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      });
    });

    it('still dispatches all 4 registered kinds to their own enricher (hacker_news)', async () => {
      const result = await enrichSource('hacker_news', 'https://news.ycombinator.com/item?id=42', {
        fetchFn: () => Promise.resolve(okResult({ score: 42, descendants: 7, by: 'dang' })),
      });
      expect(result).toEqual({ kind: 'hacker_news', points: 42, comments: 7, author: 'dang' });
    });

    it('still dispatches all 4 registered kinds to their own enricher (twitter)', async () => {
      const result = await enrichSource('twitter', 'https://x.com/dang/status/99', {
        fetchFn: () =>
          Promise.resolve(
            okResult({
              code: 200,
              tweet: {
                text: 'hn thread',
                author: { screen_name: 'dang', name: 'dang' },
                replies: 1,
                retweets: 1,
                likes: 1,
                bookmarks: 1,
                quotes: 1,
              },
            }),
          ),
      });
      expect(result).toMatchObject({ kind: 'twitter', text: 'hn thread' });
    });
  });

  describe('plugin toggle enforcement (plan 017, gate shape updated plan 026 U2)', () => {
    it('a disabled plugin skips its enricher (resolves undefined, degrades like no source enrichment)', async () => {
      const result = await enrichSource(
        'hacker_news',
        'https://news.ycombinator.com/item?id=1',
        { fetchFn: () => Promise.resolve(okResult({ score: 10, descendants: 2, by: 'pg' })) },
        {
          hacker_news: { enabled: false, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      );
      expect(result).toBeUndefined();
    });

    it('an enabled plugin still enriches normally', async () => {
      const result = await enrichSource(
        'hacker_news',
        'https://news.ycombinator.com/item?id=1',
        { fetchFn: () => Promise.resolve(okResult({ score: 10, descendants: 2, by: 'pg' })) },
        {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      );
      expect(result).toEqual({ kind: 'hacker_news', points: 10, comments: 2, author: 'pg' });
    });

    it('gates on master `enabled` only — still enriches when inline/hover are both off (plan 026 U2: fetch runs regardless of render-time flags)', async () => {
      const result = await enrichSource(
        'hacker_news',
        'https://news.ycombinator.com/item?id=1',
        { fetchFn: () => Promise.resolve(okResult({ score: 10, descendants: 2, by: 'pg' })) },
        {
          hacker_news: { enabled: true, inline: false, hover: false },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      );
      expect(result).toEqual({ kind: 'hacker_news', points: 10, comments: 2, author: 'pg' });
    });

    it('disabling one plugin does not affect another (github stays enabled while hacker_news is off)', async () => {
      const result = await enrichSource(
        'github',
        'https://github.com/vercel/next.js',
        {
          fetchFn: () =>
            Promise.resolve(
              okResult({ stargazers_count: 1, forks_count: 2, open_issues_count: 3 }),
            ),
        },
        {
          hacker_news: { enabled: false, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      );
      expect(result).toEqual({ kind: 'github', stars: 1, forks: 2, issues: 3 });
    });

    it('a missing enabledPlugins map defaults to enabled (matches SETTINGS_DEFAULTS.plugins semantics)', async () => {
      const result = await enrichSource('hacker_news', 'https://news.ycombinator.com/item?id=1', {
        fetchFn: () => Promise.resolve(okResult({ score: 10, descendants: 2, by: 'pg' })),
      });
      // No 4th arg at all — same as production code paths that haven't
      // determined a toggle state; must not silently disable everything.
      expect(result).toEqual({ kind: 'hacker_news', points: 10, comments: 2, author: 'pg' });
    });

    it('a twitter link enriches via FxEmbed when the twitter plugin is enabled', async () => {
      const result = await enrichSource(
        'twitter',
        'https://x.com/elonmusk/status/1',
        {
          fetchFn: () =>
            Promise.resolve(
              okResult({
                code: 200,
                tweet: {
                  text: 'hello',
                  author: { screen_name: 'elonmusk', name: 'Elon Musk' },
                  replies: 1,
                  retweets: 1,
                  likes: 1,
                  bookmarks: 1,
                  quotes: 1,
                },
              }),
            ),
        },
        {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      );
      expect(result).toMatchObject({ kind: 'twitter', text: 'hello' });
    });

    it('a twitter link is skipped (no FxEmbed call, resolves undefined) when the twitter plugin is disabled', async () => {
      let fetchCalled = false;
      const result = await enrichSource(
        'twitter',
        'https://x.com/elonmusk/status/1',
        {
          fetchFn: () => {
            fetchCalled = true;
            return Promise.resolve(okResult({}));
          },
        },
        {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: false, hover: true },
        },
      );
      expect(result).toBeUndefined();
      expect(fetchCalled).toBe(false);
    });

    it('a twitter link degrades to undefined (plain link) when FxEmbed itself fails', async () => {
      const result = await enrichSource(
        'twitter',
        'https://x.com/elonmusk/status/1',
        { fetchFn: () => Promise.resolve({ ok: false, reason: 'timeout' }) },
        {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, hover: true },
        },
      );
      expect(result).toBeUndefined();
    });
  });

  describe('registry-kinds-vs-settings-keys drift guard (plan 017, relaxed to registry ⊆ settings in plan 026, now equality post-twitter-live-enrichment)', () => {
    it('every registry-dispatched enricher kind has a matching settings key (module-load assertion, mirrors queue.ts — this module having imported successfully at the top of this file IS the guard passing)', () => {
      // The guard runs once, at import time, in enrich-source/index.ts itself
      // (`if (some registry kind has no settings key) throw`) — the same
      // pattern `packages/queue/src/queue.ts` uses for its queue-name-drift
      // check. There is nothing left to assert here beyond "this test file's
      // own `import { enrichSource } from './index.js'` at the top didn't
      // throw" — which every other test in this file already proves by
      // running at all. This test exists so the guard's EXISTENCE is
      // discoverable from the test file, not just from reading the source.
      //
      // Plan 017 relaxed the guard from set-equality to registry ⊆ settings.
      // As of the live-enrichment slice, `twitter` also has a registered
      // enricher (FxEmbed), so the registry's 4 kinds now happen to equal
      // settings' 4 keys — the guard itself is still a ⊆ check (not `===`),
      // kept that way so a future render-only plugin doesn't need it touched.
      const registryKinds = ['hacker_news', 'github', 'youtube', 'twitter'];
      const settingsKeys = Object.keys(SETTINGS_DEFAULTS.plugins);
      expect(settingsKeys.sort()).toEqual(['github', 'hacker_news', 'twitter', 'youtube']);
      for (const kind of registryKinds) {
        expect(settingsKeys).toContain(kind);
      }
    });
  });
});
