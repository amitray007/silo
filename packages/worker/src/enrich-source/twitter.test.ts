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

  it('keeps a long post by clipping its text to the stored limit', async () => {
    const result = await enrichTwitter('1234567890123456789', () =>
      Promise.resolve(okResult(fxEmbedEnvelope({ text: 'a'.repeat(6000) }))),
    );
    expect(result?.text).toHaveLength(4000);
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

  describe("thumbnailUrl (command-center polish slice — the tweet's real media thumbnail)", () => {
    it('a tweet with a video captures media.all[0].thumbnail_url as thumbnailUrl', async () => {
      const result = await enrichTwitter('1234567890123456789', () =>
        Promise.resolve(
          okResult(
            fxEmbedEnvelope({
              media: {
                all: [
                  {
                    type: 'video',
                    url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/abc.mp4',
                    thumbnail_url: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/xyz.jpg',
                  },
                ],
              },
            }),
          ),
        ),
      );
      expect(result?.thumbnailUrl).toBe(
        'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/xyz.jpg',
      );
    });

    it('a tweet with a photo (no video) captures media.photos[0].url as thumbnailUrl', async () => {
      const result = await enrichTwitter('1234567890123456789', () =>
        Promise.resolve(
          okResult(
            fxEmbedEnvelope({
              media: {
                all: [{ type: 'photo', url: 'https://pbs.twimg.com/media/photo1.jpg' }],
                photos: [{ type: 'photo', url: 'https://pbs.twimg.com/media/photo1.jpg' }],
              },
            }),
          ),
        ),
      );
      expect(result?.thumbnailUrl).toBe('https://pbs.twimg.com/media/photo1.jpg');
    });

    it('falls back to media.all[0].url when neither thumbnail_url nor photos[0].url is present', async () => {
      const result = await enrichTwitter('1234567890123456789', () =>
        Promise.resolve(
          okResult(
            fxEmbedEnvelope({
              media: {
                all: [{ type: 'photo', url: 'https://pbs.twimg.com/media/fallback.jpg' }],
              },
            }),
          ),
        ),
      );
      expect(result?.thumbnailUrl).toBe('https://pbs.twimg.com/media/fallback.jpg');
    });

    it('a text-only tweet (no media field at all) omits thumbnailUrl', async () => {
      const result = await enrichTwitter('1234567890123456789', () =>
        Promise.resolve(okResult(fxEmbedEnvelope())),
      );
      expect(result?.thumbnailUrl).toBeUndefined();
    });

    it('a malformed media shape (not an object) omits thumbnailUrl without failing the candidate', async () => {
      const result = await enrichTwitter('1234567890123456789', () =>
        Promise.resolve(okResult(fxEmbedEnvelope({ media: 'not-an-object' }))),
      );
      expect(result?.thumbnailUrl).toBeUndefined();
      expect(result?.kind).toBe('twitter');
    });
  });

  describe('author thread (/2/thread)', () => {
    const THREAD = 'https://api.fxtwitter.com/2/thread/';
    const STATUS = 'https://api.fxtwitter.com/status/';

    /** A v2 post: note `reposts` (not `retweets`) and the `created_at` string. */
    function post(id: string, handle: string, extra: Record<string, unknown> = {}) {
      return {
        id,
        text: `post ${id}`,
        author: { screen_name: handle, name: handle.toUpperCase() },
        replies: 1,
        reposts: 2,
        likes: 3,
        bookmarks: 4,
        quotes: 5,
        created_at: `Fri Oct 23 18:24:0${id} +0000 2026`,
        ...extra,
      };
    }

    function threadEnvelope(savedId: string, posts: unknown[]) {
      const saved = (posts as { id: string }[]).find((item) => item.id === savedId);
      return { code: 200, status: saved, author: {}, thread: posts };
    }

    /** Answers by path and records every url asked for. */
    function router(routes: Record<string, unknown>) {
      const calls: string[] = [];
      const fetchFn = (url: string): Promise<SafeFetchResult> => {
        calls.push(url);
        const body = routes[url.startsWith(THREAD) ? THREAD : STATUS];
        return Promise.resolve(
          body === undefined ? { ok: false, reason: 'timeout' } : okResult(body),
        );
      };
      return { calls, fetchFn };
    }

    it('maps the saved post from `status` exactly like the plain call', async () => {
      const { fetchFn, calls } = router({
        [THREAD]: threadEnvelope('1', [post('1', 'dev')]),
      });
      const result = await enrichTwitter('1', fetchFn);
      expect(calls).toEqual([`${THREAD}1`]);
      expect(result).toEqual({
        kind: 'twitter',
        text: 'post 1',
        authorHandle: 'dev',
        authorName: 'DEV',
        likes: 3,
        reposts: 2,
        replies: 1,
        quotes: 5,
        bookmarks: 4,
        postedAt: 'Fri Oct 23 18:24:01 +0000 2026',
      });
    });

    it('splits a middle post into threadBefore and threadAfter, in order', async () => {
      const posts = ['1', '2', '3', '4', '5'].map((id) => post(id, 'dev'));
      const { fetchFn } = router({ [THREAD]: threadEnvelope('3', posts) });
      const result = await enrichTwitter('3', fetchFn);
      expect(result?.text).toBe('post 3');
      expect(result?.threadBefore?.map((item) => item.id)).toEqual(['1', '2']);
      expect(result?.threadAfter?.map((item) => item.id)).toEqual(['4', '5']);
      expect(result?.threadAfter?.[0]).toEqual({
        id: '4',
        text: 'post 4',
        postedAt: 'Fri Oct 23 18:24:04 +0000 2026',
        likes: 3,
        reposts: 2,
        replies: 1,
      });
    });

    it('omits a side that has no posts (first post: no threadBefore)', async () => {
      const posts = ['1', '2'].map((id) => post(id, 'dev'));
      const { fetchFn } = router({ [THREAD]: threadEnvelope('1', posts) });
      const result = await enrichTwitter('1', fetchFn);
      expect(result?.threadBefore).toBeUndefined();
      expect(result?.threadAfter?.map((item) => item.id)).toEqual(['2']);
    });

    it('drops posts by other authors and keeps the saved post out of both sides', async () => {
      const posts = [
        post('1', 'dev'),
        post('2', 'someoneelse'),
        post('3', 'DEV'),
        post('4', 'dev'),
        post('5', 'dev'),
        post('4', 'dev'),
      ];
      const { fetchFn } = router({ [THREAD]: threadEnvelope('3', posts) });
      const result = await enrichTwitter('3', fetchFn);
      expect(result?.threadBefore?.map((item) => item.id)).toEqual(['1']);
      expect(result?.threadAfter?.map((item) => item.id)).toEqual(['4', '5']);
    });

    it('keeps the posts nearest the saved post when a side passes the cap', async () => {
      const ids = Array.from({ length: 61 }, (_, i) => String(i + 1));
      const posts = ids.map((id) => post(id, 'dev'));
      const { fetchFn } = router({ [THREAD]: threadEnvelope('31', posts) });
      const result = await enrichTwitter('31', fetchFn);
      expect(result?.threadBefore).toHaveLength(25);
      expect(result?.threadBefore?.[0]?.id).toBe('6');
      expect(result?.threadBefore?.at(-1)?.id).toBe('30');
      expect(result?.threadAfter).toHaveLength(25);
      expect(result?.threadAfter?.[0]?.id).toBe('32');
      expect(result?.threadAfter?.at(-1)?.id).toBe('56');
    });

    it('maps thread post media like the saved post and bounds its text', async () => {
      const posts = [
        post('1', 'dev'),
        post('2', 'dev', {
          text: 'x'.repeat(4_500),
          media: {
            all: [
              {
                type: 'video',
                url: 'https://video.twimg.com/amplify_video/9/vid/a.mp4',
                thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/9/img/a.jpg',
              },
              { type: 'photo', url: 'https://pbs.twimg.com/media/p.jpg' },
            ],
          },
        }),
      ];
      const { fetchFn } = router({ [THREAD]: threadEnvelope('1', posts) });
      const result = await enrichTwitter('1', fetchFn);
      const [second] = result?.threadAfter ?? [];
      expect(second?.text).toHaveLength(4_000);
      expect(second?.mediaUrls).toEqual([
        'https://video.twimg.com/amplify_video/9/vid/a.mp4',
        'https://pbs.twimg.com/media/p.jpg',
      ]);
      expect(second?.thumbnailUrl).toBe('https://pbs.twimg.com/amplify_video_thumb/9/img/a.jpg');
    });

    it('does not split an emoji when it cuts long thread text', async () => {
      const text = `${'x'.repeat(3_999)}\u{1F600}`;
      const posts = [post('1', 'dev'), post('2', 'dev', { text })];
      const { fetchFn } = router({ [THREAD]: threadEnvelope('1', posts) });
      const result = await enrichTwitter('1', fetchFn);
      expect(result?.threadAfter?.[0]?.text).toBe('x'.repeat(3_999));
    });

    it('skips a thread post that does not fit the stored shape and keeps the rest', async () => {
      const posts = [post('1', 'dev'), post('2', 'dev', { id: 'not-a-number' }), post('3', 'dev')];
      const { fetchFn } = router({ [THREAD]: threadEnvelope('1', posts) });
      const result = await enrichTwitter('1', fetchFn);
      expect(result?.threadAfter?.map((item) => item.id)).toEqual(['3']);
    });

    it('stores no thread when the saved post is missing from the chain', async () => {
      const envelope = { ...threadEnvelope('1', [post('1', 'dev')]), thread: [post('7', 'dev')] };
      const { fetchFn } = router({ [THREAD]: envelope });
      const result = await enrichTwitter('1', fetchFn);
      expect(result?.text).toBe('post 1');
      expect(result?.threadBefore).toBeUndefined();
      expect(result?.threadAfter).toBeUndefined();
    });

    it('falls back to /status when the thread call fails', async () => {
      const { fetchFn, calls } = router({ [STATUS]: fxEmbedEnvelope() });
      const result = await enrichTwitter('1234567890123456789', fetchFn);
      expect(calls).toEqual([`${THREAD}1234567890123456789`, `${STATUS}1234567890123456789`]);
      expect(result).toMatchObject({
        kind: 'twitter',
        text: 'Good review of Grok 4.5',
        reposts: 722,
      });
      expect(result?.threadBefore).toBeUndefined();
      expect(result?.threadAfter).toBeUndefined();
    });

    it('falls back to /status when the thread call answers a non-200 code or no status', async () => {
      for (const broken of [{ code: 500 }, { code: 200, thread: [] }, { code: 200, status: 'x' }]) {
        const { fetchFn, calls } = router({ [THREAD]: broken, [STATUS]: fxEmbedEnvelope() });
        const result = await enrichTwitter('1234567890123456789', fetchFn);
        expect(calls).toHaveLength(2);
        expect(result?.text).toBe('Good review of Grok 4.5');
      }
    });

    it('returns undefined when both calls fail', async () => {
      const { fetchFn, calls } = router({});
      expect(await enrichTwitter('1', fetchFn)).toBeUndefined();
      expect(calls).toHaveLength(2);
    });
  });
});
