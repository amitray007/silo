import { describe, expect, it } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { enrichTwitter } from './twitter.js';

function okResult(body: unknown): SafeFetchResult {
  return {
    ok: true,
    html: JSON.stringify(body),
    contentType: 'application/json',
    finalUrl: 'https://api.fxtwitter.com/status/1234567890123456789',
    status: 200,
  };
}

/** A well-formed FxEmbed envelope, matching the VERIFIED live response shape from the build brief. */
function fxEmbedEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    message: 'OK',
    tweet: {
      id: '1234567890123456789',
      url: 'https://x.com/elonmusk/status/1234567890123456789',
      text: 'Good review of Grok 4.5',
      author: {
        screen_name: 'elonmusk',
        name: 'Elon Musk',
      },
      replies: 758,
      retweets: 722,
      likes: 4231,
      bookmarks: 854,
      quotes: 48,
      views: 1149036,
      created_at: 'Thu Jul 09 08:09:13 +0000 2026',
      lang: 'en',
      possibly_sensitive: false,
      ...overrides,
    },
  };
}

describe('enrichTwitter', () => {
  it('maps a well-formed FxEmbed response to twitter SourceData (retweets -> reposts, etc.)', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(fxEmbedEnvelope())),
    );
    expect(result).toEqual({
      kind: 'twitter',
      text: 'Good review of Grok 4.5',
      authorHandle: 'elonmusk',
      authorName: 'Elon Musk',
      likes: 4231,
      reposts: 722,
      replies: 758,
      quotes: 48,
      bookmarks: 854,
      postedAt: 'Thu Jul 09 08:09:13 +0000 2026',
      language: 'en',
      possiblySensitive: false,
    });
  });

  it('degrades to undefined on a non-200 `code` (deleted/not-found tweet)', async () => {
    const result = await enrichTwitter('999', () =>
      Promise.resolve(okResult({ code: 404, message: 'Not Found' })),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when the `tweet` object is missing', async () => {
    const result = await enrichTwitter('999', () =>
      Promise.resolve(okResult({ code: 200, message: 'OK' })),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when required text is missing', async () => {
    const envelope = fxEmbedEnvelope();
    delete (envelope.tweet as Record<string, unknown>).text;
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(envelope)),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when required text is empty', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(fxEmbedEnvelope({ text: '' }))),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when author is missing', async () => {
    const envelope = fxEmbedEnvelope();
    delete (envelope.tweet as Record<string, unknown>).author;
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(envelope)),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when author.screen_name is missing', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(fxEmbedEnvelope({ author: { name: 'Elon Musk' } }))),
    );
    expect(result).toBeUndefined();
  });

  // A `fetchFn` that itself throws/rejects (vs. resolving `{ ok: false }`) is
  // NOT this enricher's job to catch — same contract as `enrichGitHub`/
  // `enrichYouTube` (neither has such a guard either): `enrichSource`'s own
  // top-level try/catch (`enrich-source/index.ts`) is the ONE place that
  // defends against a genuinely throwing fetch implementation, so every
  // enricher stays focused on shaping a resolved response. See
  // `index.test.ts`'s "degrades to undefined (never throws) when fetchFn
  // itself rejects unexpectedly" for that coverage at the dispatch layer.

  it('degrades to undefined on timeout', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve({ ok: false, reason: 'timeout' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on malformed JSON', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve({
        ok: true,
        html: '{not valid',
        contentType: 'application/json',
        finalUrl: 'https://api.fxtwitter.com/status/1234567890123456789',
        status: 200,
      }),
    );
    expect(result).toBeUndefined();
  });

  it('omits optional fields when absent (postedAt/language/possiblySensitive/authorAvatarUrl/mediaUrls)', async () => {
    const result = await enrichTwitter('42', () =>
      Promise.resolve(
        okResult({
          code: 200,
          tweet: {
            text: 'hello world',
            author: { screen_name: 'jack', name: 'Jack' },
            replies: 0,
            retweets: 0,
            likes: 0,
            bookmarks: 0,
            quotes: 0,
          },
        }),
      ),
    );
    expect(result).toEqual({
      kind: 'twitter',
      text: 'hello world',
      authorHandle: 'jack',
      authorName: 'Jack',
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
    });
  });

  it('omits language when it is not exactly 2 characters (e.g. "und" for undetermined)', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(fxEmbedEnvelope({ lang: 'und' }))),
    );
    expect(result).toMatchObject({ kind: 'twitter' });
    expect(result?.language).toBeUndefined();
  });

  it('coerces missing engagement counts by degrading the whole candidate to undefined (all counts required)', async () => {
    const envelope = fxEmbedEnvelope();
    delete (envelope.tweet as Record<string, unknown>).likes;
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(envelope)),
    );
    expect(result).toBeUndefined();
  });

  it('picks up an author avatar url when present', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(
        okResult(
          fxEmbedEnvelope({
            author: {
              screen_name: 'elonmusk',
              name: 'Elon Musk',
              avatar_url: 'https://pbs.twimg.com/profile_images/abc/def.jpg',
            },
          }),
        ),
      ),
    );
    expect(result?.authorAvatarUrl).toBe('https://pbs.twimg.com/profile_images/abc/def.jpg');
  });

  it('URL-encodes the tweet id into the request path', async () => {
    let calledUrl: string | undefined;
    await enrichTwitter('123 456', (url) => {
      calledUrl = url;
      return Promise.resolve(okResult({ code: 404 }));
    });
    expect(calledUrl).toBe('https://api.fxtwitter.com/status/123%20456');
  });
});
