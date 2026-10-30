import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EnrichLinkDeps } from './enrich.js';
import type { ExtractResult } from './extract/extract.js';
import * as readerWorker from './extract/reader-worker.js';
import { ReaderExtractionError } from './extract/reader-worker.js';
import { parseFeedBody } from './feeds/parse.js';
import type { SafeFetchResult } from './fetch/safe-fetch.js';

/**
 * Integration tests for the enrichment handler (U5). `enrichLink` calls core's
 * `getById`/`recordEnrichment`, so it needs a real Postgres — but the network
 * (`safeFetch`) and DOM parsing (`extract`) are injected via `EnrichLinkDeps`,
 * so the handler's mapping + resolve-on-degraded contract is tested without
 * touching the network. Core's `db`/`pool` singleton reads DATABASE_URL at
 * module-load, so both `@silo/core` and `./enrich.js` are dynamically imported
 * after the env var is set.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('enrichLink (integration)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let enrichMod: typeof import('./enrich.js');
  let pool: Pool;

  // CI runs many packages' disposable-DB suites in parallel; create+migrate
  // routinely exceeds vitest's default 10s hookTimeout under that load
  // (same flake has been red on main). Give the setup room, and guard
  // teardown so a timed-out beforeAll doesn't crash on undefined `pool`.
  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_enrich_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    enrichMod = await import('./enrich.js');
    pool = new Pool({ connectionString: database.url });
  }, 60_000);

  afterAll(async () => {
    try {
      const { pool: corePool } = await import('@silo/db');
      await corePool.end();
    } catch {
      // @silo/db may never have loaded if beforeAll timed out mid-setup.
    }
    await pool?.end();
    dropDatabase?.();
  }, 60_000);

  function stubDeps(fetchResult: SafeFetchResult, extractResult?: ExtractResult): EnrichLinkDeps {
    return {
      safeFetch: () => Promise.resolve(fetchResult),
      extract: () => Promise.resolve(extractResult ?? { status: 'bare' }),
      // No source enrichment in these generic fetch/extract tests — the
      // source-data dispatcher itself is covered separately (see the
      // "source enrichment" describe block below, and enrich-source/*.test.ts
      // for the per-source enrichers).
      enrichSource: () => Promise.resolve(undefined),
      // Plugin-toggle enforcement is covered in its own describe block below
      // — these generic tests don't care about the toggle state.
      getPluginsSetting: () =>
        Promise.resolve({
          hacker_news: { enabled: true, inline: true, hover: true, palette: true },
          github: { enabled: true, hover: true, palette: true },
          youtube: { enabled: true, hover: true, palette: true },
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        }),
    };
  }

  it.each(['reader-failed', 'reader-timeout'])(
    'leaves media Reader retryable after %s',
    async (message) => {
      const post = await core.createLink({
        url: `https://example.com/${message}.mp3`,
        sourceKind: 'feed_media',
        sourceData: { kind: 'feed_media', content: '<p>Recovered show notes.</p>' },
      });
      const sanitizer = vi
        .spyOn(readerWorker, 'sanitizeRenderedPage')
        .mockRejectedValueOnce(new ReaderExtractionError(message));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await enrichMod.enrichLink(post.id);
        const state = await pool.query(
          'select enrich_attempts, reader_version, reader_captured_at, content_html, capture_status from links where id = $1',
          [post.id],
        );
        expect(state.rows[0]).toEqual({
          enrich_attempts: 1,
          reader_version: null,
          reader_captured_at: null,
          content_html: null,
          capture_status: 'full',
        });
        expect(warn).toHaveBeenCalled();
      } finally {
        sanitizer.mockRestore();
        warn.mockRestore();
      }
      const { createReaderRefresher } = await import('./reader/refresh-reader.js');
      await core.runReaderBackfill(
        createReaderRefresher(() => {}, {
          fetch: async () => {
            throw new Error('must rebuild saved media without fetching');
          },
        }),
      );
      expect((await core.getStoredReader(post.id))?.contentHtml).toContain('Recovered show notes.');
    },
  );

  it('strips JSON Feed NULs before subscribing and polling on Postgres', async () => {
    const parsed = parseFeedBody(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Pod\u0000cast',
        description: 'Feed\u0000 summary',
        items: [
          {
            id: 'ep\u0000isode',
            title: 'Episode\u0000 title',
            content_html: '<p>Show\u0000 notes</p>',
            summary: 'Short\u0000 summary',
            attachments: [{ url: '/nul.mp3', mime_type: 'audio/mpeg' }],
          },
        ],
      }),
      'https://example.com/feed',
    );
    expect(parsed).toMatchObject({
      title: 'Podcast',
      description: 'Feed summary',
      entries: [
        {
          id: 'episode',
          title: 'Episode title',
          media: { content: '<p>Show notes</p>', description: 'Short summary' },
        },
      ],
    });
    if (!parsed) throw new Error('feed did not parse');
    const resolved = {
      ...parsed,
      feedUrl: 'https://example.com/nul-feed',
      siteUrl: 'https://example.com',
      intervalSeconds: 3600,
    };
    core.setFeedResolver(async () => resolved);
    try {
      const result = await core.subscribeFeed({ url: resolved.feedUrl, syncRecents: false });
      if ('error' in result) throw new Error(result.error);
      await pool.query("update feeds set next_poll_at = '2000-01-01' where id = $1", [
        result.feed.id,
      ]);
      await core.pollFeed(result.feed.id, async () => ({
        kind: 'modified',
        feed: {
          ...resolved,
          entries: parsed.entries.map((entry) => ({
            ...entry,
            id: 'fresh',
            url: 'https://example.com/fresh-nul.mp3',
          })),
        },
      }));
      expect(await core.getFeed(result.feed.id)).toMatchObject({
        status: 'active',
        postCount: 1,
        title: 'Podcast',
      });
      expect((await core.listFeedPosts(result.feed.id)).links[0]).toMatchObject({
        title: 'Episode title',
        sourceData: { content: '<p>Show notes</p>', description: 'Short summary' },
      });
    } finally {
      core.setFeedResolver(undefined);
    }
  });

  it('captures feed media without page fetch, preserves show notes through refresh and Save to Home', async () => {
    const feedResult = await pool.query<{ id: string }>(
      "insert into feeds (feed_url, title, format, next_poll_at) values ('https://example.com/media-feed', 'Podcast', 'rss', now()) returning id",
    );
    const feed = feedResult.rows[0];
    if (!feed) throw new Error('missing feed');
    const source = {
      kind: 'feed_media' as const,
      content:
        '<p>Searchable quasar show notes.</p><a href="../about">About</a><ul><li>A topic</li></ul><script>evil()</script><a href="javascript:evil()">Unsafe</a><img src="https://example.com/photo.jpg" onerror="evil()">',
      description: '  <p>Short <b>episode</b> summary.</p>  ',
      imageUrl: 'https://example.com/cover.jpg',
      enclosureUrl: 'https://example.com/episode.mp3',
      contentBaseUrl: 'https://publisher.example/episodes/',
    };
    const post = await core.createFeedPost({
      feedId: feed.id,
      url: source.enclosureUrl,
      title: 'Episode title',
      publishedAt: new Date('2026-10-29'),
      media: source,
    });
    if (!post) throw new Error('missing post');
    const deps = stubDeps({ ok: false, reason: 'not-found' });
    const fetch = vi.spyOn(deps, 'safeFetch');
    const extract = vi.spyOn(deps, 'extract');
    const sourceFetch = vi.spyOn(deps, 'enrichSource');
    await enrichMod.enrichLink(post.id, deps);
    const stored = await core.getById(post.id);
    expect(stored).toMatchObject({
      title: 'Episode title',
      description: 'Short episode summary.',
      imageUrl: source.imageUrl,
      captureStatus: 'full',
      sourceKind: 'feed_media',
      sourceData: source,
      extractedText: expect.stringContaining('Searchable quasar show notes.'),
    });
    const reader = await core.getStoredReader(post.id);
    expect(reader?.contentHtml).toContain('<ul><li>A topic</li></ul>');
    expect(reader?.contentHtml).toContain('https://example.com/episode.mp3');
    expect(reader?.contentHtml).toContain('https://publisher.example/about');
    expect(reader?.contentImages).toEqual(['https://example.com/photo.jpg']);
    expect(reader?.contentHtml).not.toMatch(/script|onerror|javascript:|evil\(/);
    const { createReaderRefresher } = await import('./reader/refresh-reader.js');
    const refresher = createReaderRefresher(() => {}, {
      fetch: async () => {
        throw new Error('must not fetch media');
      },
    });
    const refreshed = await refresher(post, AbortSignal.timeout(30_000));
    expect(refreshed).toMatchObject({
      status: 'reader',
      reader: { contentHtml: reader?.contentHtml },
    });
    const { createLiveReader } = await import('./reader/live-reader.js');
    const live = createLiveReader({
      fetch: async () => {
        throw new Error('must not fetch media');
      },
    });
    expect(await live(post, AbortSignal.timeout(30_000))).toMatchObject({
      contentHtml: reader?.contentHtml,
    });
    const enqueue = vi.fn(async () => {});
    core.setEnrichmentEnqueuer(enqueue);
    const saved = await core.saveFeedPost(feed.id, post.id);
    if ('error' in saved) throw new Error(saved.error);
    expect(enqueue).not.toHaveBeenCalled();
    expect(await core.getStoredReader(saved.id)).toEqual(reader);
    expect(await core.getById(saved.id)).toMatchObject({
      feedId: null,
      sourceKind: 'feed_media',
      sourceData: source,
      extractedText: stored?.extractedText,
      captureStatus: 'full',
    });
    expect((await core.search('quasar')).results.map((l) => l.id)).toContain(saved.id);
    // A retry or targeted Reader request must keep using the saved notes on the Home copy.
    await core.requestEnrich(saved.id, { fields: ['reader'] });
    await enrichMod.enrichLink(saved.id, deps, { trigger: 'manual', previousStatus: 'full' });
    expect(await core.getStoredReader(saved.id)).toMatchObject({
      contentHtml: reader?.contentHtml,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(sourceFetch).not.toHaveBeenCalled();
    core.resetEnrichmentEnqueuer();
  }, 45_000);

  it('fetches and extracts an article with an auto-enclosure and preserves YouTube classification', async () => {
    const { parseFeedBody } = await import('./feeds/parse.js');
    const result = await pool.query<{ id: string }>(
      "insert into feeds (feed_url, title, format, next_poll_at) values ('https://example.com/articles-with-enclosures', 'Articles', 'rss', now()) returning id",
    );
    const feed = result.rows[0];
    if (!feed) throw new Error('missing feed');
    for (const [url, kind] of [
      ['https://example.com/wordpress-post', 'link'],
      ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'youtube'],
    ]) {
      const entry = parseFeedBody(
        `<rss version="2.0"><channel><title>Feed</title><item><link>${url}</link><enclosure url="https://cdn.example/audio.mp3" type="audio/mpeg"/></item></channel></rss>`,
        'https://example.com/feed',
      )?.entries[0];
      if (!entry) throw new Error('missing entry');
      const post = await core.createFeedPost({ ...entry, feedId: feed.id });
      if (!post) throw new Error('missing post');
      expect(post.sourceKind).toBe(kind);
      const deps = stubDeps(
        {
          ok: true,
          html: '<p>Article</p>',
          finalUrl: post.url,
          contentType: 'text/html',
          status: 200,
        },
        { status: 'full', title: 'Page title', text: 'Full page text' },
      );
      const fetch = vi.spyOn(deps, 'safeFetch');
      await enrichMod.enrichLink(post.id, deps);
      expect(fetch).toHaveBeenCalledWith(post.url);
      expect(await core.getById(post.id)).toMatchObject({
        captureStatus: kind === 'youtube' ? 'partial' : 'full',
        extractedText: 'Full page text',
        sourceKind: kind,
      });
    }
  });

  it('a missing feed post settles into its own trash without leaking into library trash', async () => {
    const result = await pool.query<{ id: string }>(
      "insert into feeds (feed_url, title, format, next_poll_at) values ('https://example.com/missing-post-feed', 'Publisher', 'rss', now()) returning id",
    );
    const feed = result.rows[0];
    if (!feed) throw new Error('missing feed');
    const post = await core.createFeedPost({
      feedId: feed.id,
      url: 'https://example.com/missing-feed-post',
    });
    if (!post) throw new Error('missing post');
    await enrichMod.enrichLink(
      post.id,
      stubDeps({ ok: false, reason: 'not-found', detail: '404' }),
    );
    expect(await core.getById(post.id)).toBeNull();
    expect(
      (await pool.query('select deleted_at from links where id = $1', [post.id])).rows[0]
        ?.deleted_at,
    ).not.toBeNull();
    expect((await core.listTrash()).links.map((row) => row.id)).not.toContain(post.id);
  });

  async function newLink(url: string): Promise<string> {
    const link = await core.createLink({ url, sourceKind: 'link' });
    return link.id;
  }

  it('stores a YouTube page description as text when no transcript is available', async () => {
    const link = await core.createLink({
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      sourceKind: 'youtube',
    });
    const description = 'A short video at the zoo.';
    await enrichMod.enrichLink(
      link.id,
      stubDeps(
        {
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: link.url,
          status: 200,
        },
        { status: 'partial', description, text: 'About Privacy Terms footer' },
      ),
    );
    expect((await core.getById(link.id))?.extractedText).toBe(description);
  });

  it('propagates Reader timeouts for pg-boss retry without recording a successful capture', async () => {
    const id = await newLink('https://example.com/reader-timeout');
    const deps = stubDeps({
      ok: true,
      html: '<p>Article.</p>',
      contentType: 'text/html',
      finalUrl: 'https://example.com/reader-timeout',
      status: 200,
    });
    deps.extract = () => Promise.reject(new ReaderExtractionError('reader-timeout'));
    await expect(enrichMod.enrichLink(id, deps)).rejects.toThrow('reader-timeout');
    const link = await core.getById(id);
    expect(link?.captureStatus).toBe('enriching');
    expect(link?.extractedText).toBeNull();
    expect(link).not.toHaveProperty('contentHtml');
  });

  it('fetch ok + extract full -> records full with metadata', async () => {
    const id = await newLink('https://example.com/full');
    await enrichMod.enrichLink(
      id,
      stubDeps(
        {
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: 'https://example.com/full',
          status: 200,
        },
        {
          title: 'T',
          description: 'D',
          imageUrl: 'https://i',
          siteName: 'S',
          text: 'x'.repeat(400),
          status: 'full',
        },
      ),
    );
    const link = await core.getById(id);
    expect(link?.captureStatus).toBe('full');
    expect(link?.title).toBe('T');
    expect(link?.extractedText).toBe('x'.repeat(400));
  });

  it('records the extracted text and Reader HTML from one extraction', async () => {
    const id = await newLink('https://example.com/no-reader-html');
    await enrichMod.enrichLink(
      id,
      stubDeps(
        {
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: 'https://example.com/no-reader-html',
          status: 200,
        },
        {
          title: 'T',
          text: 'y'.repeat(400),
          status: 'full',
          reader: { contentHtml: '<p>Formatted</p>', contentImages: ['https://cdn.test/a.png'] },
        },
      ),
    );
    const link = await core.getById(id);
    expect(link?.captureStatus).toBe('full');
    expect(link?.extractedText).toBe('y'.repeat(400));
    expect(await core.getStoredReader(id)).toMatchObject({
      contentHtml: '<p>Formatted</p>',
      contentImages: ['https://cdn.test/a.png'],
    });
  });

  it('capture and refresh store the same rendered Reader and search text on the real database', async () => {
    const browser = await import('./browser/reader.js');
    const rendered = { contentHtml: '<p>Rendered body</p>', contentImages: [] };
    const text = 'Rendered article prose. '.repeat(30).trim();
    vi.stubEnv('SILO_BROWSER_WS_ENDPOINT', 'ws://browser.invalid/');
    const render = vi.spyOn(browser, 'renderReader').mockResolvedValue({ reader: rendered, text });
    const id = await newLink('https://example.org/rendered-parity');
    const page = {
      ok: true as const,
      html: '<main></main>',
      contentType: 'text/html',
      finalUrl: 'https://final.example.org/article',
      status: 200,
    };
    const extracted: ExtractResult = {
      title: 'Script built',
      status: 'partial',
      text: 'Thin shell',
    };
    try {
      await enrichMod.enrichLink(id, stubDeps(page, extracted));
      expect(await core.getStoredReader(id)).toMatchObject(rendered);
      expect(await core.getById(id)).toMatchObject({ extractedText: text, captureStatus: 'full' });
      const { createReaderRefresher } = await import('./reader/refresh-reader.js');
      core.setReaderRefresher(
        createReaderRefresher(() => {}, {
          fetch: async () => page,
          extract: async () => extracted,
        }),
      );
      expect(await core.refreshReader(id)).toMatchObject({ status: 'reader', reader: rendered });
      expect((await core.getById(id))?.extractedText).toBe(text);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenNthCalledWith(1, page.finalUrl, expect.any(AbortSignal));
      expect(render).toHaveBeenNthCalledWith(2, page.finalUrl, expect.any(AbortSignal));
    } finally {
      core.setReaderRefresher(undefined);
      render.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('fetch ok + extract partial (JS-wall) -> records partial', async () => {
    const id = await newLink('https://example.com/partial');
    await enrichMod.enrichLink(
      id,
      stubDeps(
        {
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: 'https://example.com/partial',
          status: 200,
        },
        { title: 'Shell', status: 'partial' },
      ),
    );
    expect((await core.getById(id))?.captureStatus).toBe('partial');
  });

  it('fetch blocked-ip -> records bare and RESOLVES (no throw, no retry storm)', async () => {
    const id = await newLink('https://example.com/blocked');
    await expect(
      enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'blocked-ip' })),
    ).resolves.toBeUndefined();
    expect((await core.getById(id))?.captureStatus).toBe('bare');
  });

  it('fetch timeout -> records partial (reachable resource, retry may succeed)', async () => {
    const id = await newLink('https://example.com/timeout');
    await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'timeout' }));
    expect((await core.getById(id))?.captureStatus).toBe('partial');
  });

  it('fetch oversized body -> records partial', async () => {
    const id = await newLink('https://example.com/big');
    await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'body-too-large' }));
    expect((await core.getById(id))?.captureStatus).toBe('partial');
  });

  it('a vanished link (deleted between enqueue and processing) is a no-op, not an error', async () => {
    const id = await newLink('https://example.com/gone');
    await core.softDelete(id);
    await expect(
      enrichMod.enrichLink(
        id,
        stubDeps(
          {
            ok: true,
            html: '<html></html>',
            contentType: 'text/html',
            finalUrl: 'https://example.com/gone',
            status: 200,
          },
          { title: 'X', status: 'full' },
        ),
      ),
    ).resolves.toBeUndefined();
    // Still trashed, never enriched.
    const rows = await pool.query('select capture_status, deleted_at from links where id = $1', [
      id,
    ]);
    expect(rows.rows[0]?.deleted_at).not.toBeNull();
    expect(rows.rows[0]?.capture_status).toBe('enriching');
  });

  it('never records enriching as a result (degraded capture is terminal)', async () => {
    const id = await newLink('https://example.com/term');
    await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'dns-error' }));
    expect((await core.getById(id))?.captureStatus).not.toBe('enriching');
  });

  it('PROPAGATES an unexpected error (the pg-boss retry signal), not swallow it', async () => {
    // The resolve-vs-throw contract: an UNEXPECTED failure (here, extract
    // throwing — either a retryable Reader failure or an unexpected defect)
    // must propagate so pg-boss retries + eventually dead-letters, rather than
    // being silently recorded as a degraded capture. The link is left untouched
    // at `enriching` so the retry re-runs cleanly.
    const id = await newLink('https://example.com/throws');
    await expect(
      enrichMod.enrichLink(id, {
        safeFetch: () =>
          Promise.resolve({
            ok: true,
            html: '<html></html>',
            contentType: 'text/html',
            finalUrl: 'https://example.com/throws',
            status: 200,
          }),
        extract: () => Promise.reject(new Error('unexpected extract crash')),
        enrichSource: () => Promise.resolve(undefined),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      }),
    ).rejects.toThrow('unexpected extract crash');
    // Untouched — the failed attempt recorded nothing; a retry starts fresh.
    expect((await core.getById(id))?.captureStatus).toBe('enriching');
  });

  describe('source enrichment wiring', () => {
    it('folds a successful sourceData result into the record on the extract-success branch', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=1');
      await enrichMod.enrichLink(id, {
        safeFetch: () =>
          Promise.resolve({
            ok: true,
            html: '<html></html>',
            contentType: 'text/html',
            finalUrl: 'https://news.ycombinator.com/item?id=1',
            status: 200,
          }),
        extract: () => Promise.resolve({ status: 'partial', title: 'HN thread' }),
        enrichSource: () =>
          Promise.resolve({ kind: 'hacker_news', points: 500, comments: 200, author: 'pg' }),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      expect(link?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 500,
        comments: 200,
        author: 'pg',
      });
      expect(link?.sourceKind).toBe('hacker_news');
      expect(link?.title).toBe('HN thread');
    });

    it('folds a successful sourceData result into the record on the safeFetch-failure branch', async () => {
      // The generic page fetch fails (e.g. blocked/dead), but the source's
      // OWN API (HN Firebase here) is a separate endpoint that can still
      // succeed — sourceData must still be recorded.
      const id = await newLink('https://news.ycombinator.com/item?id=2');
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve({ ok: false, reason: 'blocked-ip' }),
        extract: () => Promise.resolve({ status: 'bare' }),
        enrichSource: () =>
          Promise.resolve({ kind: 'hacker_news', points: 10, comments: 3, author: 'x' }),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      expect(link?.captureStatus).toBe('bare');
      expect(link?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 10,
        comments: 3,
        author: 'x',
      });
    });

    it('omits sourceData entirely when the enricher degrades (undefined) — no clobber, no crash', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=3');
      await enrichMod.enrichLink(
        id,
        stubDeps({
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: 'https://news.ycombinator.com/item?id=3',
          status: 200,
        }),
      );
      const link = await core.getById(id);
      // stubDeps' enrichSource always resolves undefined — sourceData keeps
      // whatever createLink set (the safe `link` floor for a freshly detected,
      // not-yet-enriched hacker_news link).
      expect(link?.sourceData).toEqual({ kind: 'link' });
      expect(link?.captureStatus).toBe('bare');
    });
  });

  describe('twitter thumbnail override (command-center polish slice)', () => {
    const okTwitterFetch: SafeFetchResult = {
      ok: true,
      html: '<html></html>',
      contentType: 'text/html',
      finalUrl: 'https://x.com/someone/status/123',
      status: 200,
    };

    it('overrides the extracted (placeholder) imageUrl with sourceData.thumbnailUrl when present', async () => {
      const id = await newLink('https://x.com/someone/status/123');
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okTwitterFetch),
        extract: () =>
          Promise.resolve({
            status: 'full',
            title: 'Someone on X',
            // The generic x.com og:image extraction — a useless placeholder.
            imageUrl: 'https://abs.twimg.com/errors/logo46x38.png',
          }),
        enrichSource: () =>
          Promise.resolve({
            kind: 'twitter',
            text: 'a tweet with a video',
            authorHandle: 'someone',
            authorName: 'Someone',
            likes: 1,
            reposts: 0,
            replies: 0,
            quotes: 0,
            bookmarks: 0,
            thumbnailUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg',
          }),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      expect(link?.imageUrl).toBe('https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg');
      expect(link?.sourceData).toMatchObject({
        kind: 'twitter',
        thumbnailUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg',
      });
    });

    it('leaves the extracted imageUrl untouched when the tweet has no media (text-only)', async () => {
      const id = await newLink('https://x.com/someone/status/456');
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okTwitterFetch),
        extract: () =>
          Promise.resolve({
            status: 'full',
            title: 'Someone on X',
            imageUrl: 'https://abs.twimg.com/errors/logo46x38.png',
          }),
        enrichSource: () =>
          Promise.resolve({
            kind: 'twitter',
            text: 'a text-only tweet, no media',
            authorHandle: 'someone',
            authorName: 'Someone',
            likes: 1,
            reposts: 0,
            replies: 0,
            quotes: 0,
            bookmarks: 0,
            // No thumbnailUrl — a text-only tweet.
          }),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      // The placeholder og:image is what gets stored — no override to apply.
      expect(link?.imageUrl).toBe('https://abs.twimg.com/errors/logo46x38.png');
    });

    it('stores the saved post first, then the thread, as extracted text', async () => {
      const id = await newLink('https://x.com/someone/status/789');
      const twitterPlugins = {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      };
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okTwitterFetch),
        extract: () => Promise.resolve({ status: 'partial', title: 'Someone on X' }),
        enrichSource: () =>
          Promise.resolve({
            kind: 'twitter',
            text: 'the saved middle post',
            authorHandle: 'someone',
            authorName: 'Someone',
            likes: 1,
            reposts: 0,
            replies: 0,
            quotes: 0,
            bookmarks: 0,
            threadBefore: [{ id: '1', text: 'opening post about zebrafish' }],
            threadAfter: [{ id: '3', text: 'closing post' }],
          }),
        getPluginsSetting: () => Promise.resolve(twitterPlugins),
      });
      const link = await core.getById(id);
      expect(link?.extractedText).toBe(
        'the saved middle post\n\nopening post about zebrafish\n\nclosing post',
      );
      const found = await core.search('zebrafish');
      expect(found.results.map((result) => result.id)).toContain(id);
    });

    it('does not apply the override for a non-twitter sourceData kind', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=999');
      await enrichMod.enrichLink(id, {
        safeFetch: () =>
          Promise.resolve({
            ok: true,
            html: '<html></html>',
            contentType: 'text/html',
            finalUrl: 'https://news.ycombinator.com/item?id=999',
            status: 200,
          }),
        extract: () =>
          Promise.resolve({
            status: 'full',
            title: 'HN thread',
            imageUrl: 'https://example.com/og.png',
          }),
        enrichSource: () =>
          Promise.resolve({ kind: 'hacker_news', points: 5, comments: 1, author: 'x' }),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      expect(link?.imageUrl).toBe('https://example.com/og.png');
    });
  });

  describe('plugin toggle enforcement (plan 017)', () => {
    /** A stubbed `enrichSource` that records the `enabledPlugins` it was called with. */
    function spyingEnrichSource(calls: Array<Parameters<EnrichLinkDeps['enrichSource']>>) {
      return (
        sourceKind: string,
        url: string,
        enabledPlugins?: Parameters<EnrichLinkDeps['enrichSource']>[2],
      ) => {
        calls.push([sourceKind, url, enabledPlugins]);
        return Promise.resolve(
          enabledPlugins?.hacker_news.enabled === false
            ? undefined
            : { kind: 'hacker_news' as const, points: 1, comments: 1, author: 'x' },
        );
      };
    }

    const okFetch: SafeFetchResult = {
      ok: true,
      html: '<html></html>',
      contentType: 'text/html',
      finalUrl: 'https://news.ycombinator.com/item?id=10',
      status: 200,
    };

    it('reads the plugins setting ONCE per pass and threads it into enrichSource', async () => {
      const calls: Array<Parameters<EnrichLinkDeps['enrichSource']>> = [];
      let getPluginsSettingCallCount = 0;
      const id = await newLink('https://news.ycombinator.com/item?id=10');

      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okFetch),
        extract: () => Promise.resolve({ status: 'bare' }),
        enrichSource: spyingEnrichSource(calls),
        getPluginsSetting: () => {
          getPluginsSettingCallCount += 1;
          return Promise.resolve({
            hacker_news: { enabled: false, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          });
        },
      });

      expect(getPluginsSettingCallCount).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[2]).toEqual({
        hacker_news: { enabled: false, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      });
    });

    it('disabled plugin -> enrichSource degrades -> no sourceData recorded (generic capture only)', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=11');
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okFetch),
        extract: () => Promise.resolve({ status: 'partial', title: 'HN thread' }),
        enrichSource: spyingEnrichSource([]),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: false, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      // No sourceData folded in — createLink's safe `link` floor stands, and
      // the generic capture (title) still landed.
      expect(link?.sourceData).toEqual({ kind: 'link' });
      expect(link?.title).toBe('HN thread');
      expect(link?.captureStatus).toBe('partial');
    });

    it('enabled plugin -> sourceData populates normally', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=12');
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okFetch),
        extract: () => Promise.resolve({ status: 'partial', title: 'HN thread' }),
        enrichSource: spyingEnrichSource([]),
        getPluginsSetting: () =>
          Promise.resolve({
            hacker_news: { enabled: true, inline: true, hover: true, palette: true },
            github: { enabled: true, hover: true, palette: true },
            youtube: { enabled: true, hover: true, palette: true },
            twitter: { enabled: true, inline: true, hover: true, palette: true },
          }),
      });
      const link = await core.getById(id);
      expect(link?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 1,
        comments: 1,
        author: 'x',
      });
    });

    it('a settings-read failure DEGRADES to enabled (SETTINGS_DEFAULTS.plugins), never fails the job', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=13');
      const calls: Array<Parameters<EnrichLinkDeps['enrichSource']>> = [];
      await expect(
        enrichMod.enrichLink(id, {
          safeFetch: () => Promise.resolve(okFetch),
          extract: () => Promise.resolve({ status: 'partial', title: 'HN thread' }),
          enrichSource: spyingEnrichSource(calls),
          getPluginsSetting: () => Promise.reject(new Error('settings db unreachable')),
        }),
      ).resolves.toBeUndefined();

      // Degraded to the all-enabled default, not left undefined/false.
      // Assert against SETTINGS_DEFAULTS.plugins directly (rather than a
      // hand-copied literal) so this can never drift when a new per-plugin
      // feature flag is added — e.g. the `palette` flag (palette-rich-rows
      // slice) that widened every source object from 3 fields to 4.
      expect(calls[0]?.[2]).toEqual(core.SETTINGS_DEFAULTS.plugins);
      const link = await core.getById(id);
      expect(link?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 1,
        comments: 1,
        author: 'x',
      });
      expect(link?.captureStatus).toBe('partial');
    });

    it('a missing/unset plugins setting also degrades to enabled (matches SETTINGS_DEFAULTS)', async () => {
      const id = await newLink('https://news.ycombinator.com/item?id=14');
      await enrichMod.enrichLink(id, {
        safeFetch: () => Promise.resolve(okFetch),
        extract: () => Promise.resolve({ status: 'partial', title: 'HN thread' }),
        enrichSource: spyingEnrichSource([]),
        // Mirrors core.getSetting's own real behavior for an unset key:
        // resolves the default, never throws/undefined.
        getPluginsSetting: () => Promise.resolve(core.SETTINGS_DEFAULTS.plugins),
      });
      const link = await core.getById(id);
      expect(link?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 1,
        comments: 1,
        author: 'x',
      });
    });
  });

  describe('no downgrade of a full link (Enrich on every link)', () => {
    const okFetch = (url: string): SafeFetchResult => ({
      ok: true,
      html: '<html></html>',
      contentType: 'text/html',
      finalUrl: url,
      status: 200,
    });
    const manualFull = { trigger: 'manual', previousStatus: 'full' } as const;

    /** A full link with good data, then an owner Enrich click (status enriching, floor full). */
    async function clickedEnrich(url: string): Promise<string> {
      const id = await newLink(url);
      await core.recordEnrichment(id, {
        title: 'Good title',
        description: 'Good description',
        imageUrl: 'https://example.com/good.png',
        text: 'x'.repeat(400),
        status: 'full',
      });
      await core.requestEnrich(id);
      return id;
    }

    it('a manual re-run that comes back partial stays full and keeps all its data', async () => {
      const id = await clickedEnrich('https://example.com/rerun-partial');
      await enrichMod.enrichLink(
        id,
        stubDeps(okFetch(id), {
          title: 'Thin title',
          description: 'Thin description',
          imageUrl: 'https://example.com/thin.png',
          text: 'thin',
          status: 'partial',
        }),
        manualFull,
      );
      const link = await core.getById(id);
      expect(link?.captureStatus).toBe('full');
      expect(link?.title).toBe('Good title');
      expect(link?.description).toBe('Good description');
      expect(link?.imageUrl).toBe('https://example.com/good.png');
      expect(link?.extractedText).toBe('x'.repeat(400));
      expect(link?.enrichFloorStatus).toBeNull();
    });

    it('a manual re-run whose fetch fails stays full', async () => {
      const id = await clickedEnrich('https://example.com/rerun-down');
      await enrichMod.enrichLink(
        id,
        stubDeps({ ok: false, reason: 'http-error', detail: '503' }),
        manualFull,
      );
      expect((await core.getById(id))?.captureStatus).toBe('full');
    });

    it('a manual re-run of a full link whose URL now returns 404 or 410 stays full and is not trashed', async () => {
      const id = await clickedEnrich('https://example.com/rerun-gone');
      await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'not-found' }), manualFull);
      const link = await core.getById(id);
      expect(link?.deletedAt).toBeNull();
      expect(link?.captureStatus).toBe('full');
      expect(link?.title).toBe('Good title');
    });

    it('a manual re-run that comes back full replaces the data', async () => {
      const id = await clickedEnrich('https://example.com/rerun-better');
      await enrichMod.enrichLink(
        id,
        stubDeps(okFetch(id), { title: 'Newer title', text: 'y'.repeat(400), status: 'full' }),
        manualFull,
      );
      const link = await core.getById(id);
      expect(link?.title).toBe('Newer title');
      expect(link?.captureStatus).toBe('full');
    });

    it('a second job from a double click runs and the finished link stays full', async () => {
      const id = await clickedEnrich('https://example.com/double-click');
      await core.requestEnrich(id); // second click while enriching keeps the floor
      expect((await core.getById(id))?.enrichFloorStatus).toBe('full');
      await enrichMod.enrichLink(
        id,
        stubDeps(okFetch(id), { title: 'First run', text: 'z'.repeat(400), status: 'full' }),
        manualFull,
      );
      const second = vi.fn();
      const deps = stubDeps(okFetch(id), { title: 'Thin', status: 'partial' });
      deps.safeFetch = async (url) => {
        second(url);
        return okFetch(url);
      };
      await enrichMod.enrichLink(id, deps, { trigger: 'manual', previousStatus: 'enriching' });
      expect(second).toHaveBeenCalled();
      const link = await core.getById(id);
      expect(link?.captureStatus).toBe('full');
      expect(link?.title).toBe('First run');
    });

    it('a sweep job that finds a finished link does nothing', async () => {
      const id = await newLink('https://example.com/sweep-dup');
      await core.recordEnrichment(id, { title: 'Done', status: 'full' });
      const fetchSpy = vi.fn();
      const deps = stubDeps(okFetch(id), { status: 'partial' });
      deps.safeFetch = async (url) => {
        fetchSpy(url);
        return okFetch(url);
      };
      await enrichMod.enrichLink(id, deps, { trigger: 'sweep', previousStatus: 'enriching' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a re-save (capture job) of a full link that comes back thin stays full with its data', async () => {
      const id = await newLink('https://example.com/resave-thin');
      await core.recordEnrichment(id, {
        title: 'Good title',
        description: 'Good description',
        text: 'x'.repeat(400),
        status: 'full',
      });
      await core.createLink({ url: 'https://example.com/resave-thin', sourceKind: 'link' });
      await enrichMod.enrichLink(
        id,
        stubDeps(okFetch(id), {
          title: 'Thin',
          description: 'Thin',
          text: 'thin',
          status: 'partial',
        }),
        { trigger: 'capture', previousStatus: 'full' },
      );
      const link = await core.getById(id);
      expect(link?.captureStatus).toBe('full');
      expect(link?.title).toBe('Good title');
      expect(link?.description).toBe('Good description');
      expect(link?.extractedText).toBe('x'.repeat(400));
    });

    it('a re-save (capture job) of a full link whose URL 404s is not trashed', async () => {
      const id = await newLink('https://example.com/resave-gone');
      await core.recordEnrichment(id, { title: 'Good title', status: 'full' });
      await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'not-found' }), {
        trigger: 'capture',
        previousStatus: 'full',
      });
      const link = await core.getById(id);
      expect(link?.deletedAt).toBeNull();
      expect(link?.captureStatus).toBe('full');
    });

    it('a previously partial link is still recorded as partial', async () => {
      const id = await newLink('https://example.com/rerun-was-partial');
      await core.recordEnrichment(id, { status: 'partial' });
      await core.requestEnrich(id);
      await enrichMod.enrichLink(id, stubDeps(okFetch(id), { status: 'partial' }), {
        trigger: 'manual',
        previousStatus: 'partial',
      });
      expect((await core.getById(id))?.captureStatus).toBe('partial');
    });

    it('with no job context a thin result is recorded as is', async () => {
      const id = await newLink('https://example.com/no-job-context');
      await enrichMod.enrichLink(id, stubDeps(okFetch(id), { status: 'partial' }));
      expect((await core.getById(id))?.captureStatus).toBe('partial');
    });
  });

  describe('404-trash + attempt-cap give-up (plan 025 U4)', () => {
    it('a confirmed 404/410 (reason: not-found) silently trashes the link, never records a status', async () => {
      const id = await newLink('https://example.com/vanished');
      await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'not-found' }));

      // Bypassed recordEnrichment entirely — captureStatus is untouched at
      // `enriching` (not left at, or overwritten to, any capture status),
      // and the link is soft-deleted (deletedAt set).
      const rows = await pool.query('select capture_status, deleted_at from links where id = $1', [
        id,
      ]);
      expect(rows.rows[0]?.deleted_at).not.toBeNull();
      expect(rows.rows[0]?.capture_status).toBe('enriching');
    });

    it('a persistently-failing non-404 link settles bare with url-as-title once it hits the attempt cap', async () => {
      const id = await newLink('https://example.com/always-times-out');
      const deps = stubDeps({ ok: false, reason: 'timeout' });

      // Drive enrichLink ENRICH_ATTEMPT_CAP times: recordEnrichment increments
      // enrich_attempts each pass (core, U3); the cap-th pass's post-increment
      // count triggers settleGiveUp inline (recordThenMaybeSettle), no extra
      // sweep needed.
      for (let i = 0; i < core.ENRICH_ATTEMPT_CAP; i++) {
        await enrichMod.enrichLink(id, deps);
      }

      const link = await core.getById(id);
      expect(link?.captureStatus).toBe('bare');
      expect(link?.title).toBe('https://example.com/always-times-out');
      expect(link?.siteName).toBe('example.com');
    });

    it('a normal successful (full) enrich never settles or trashes, even coincidentally at the cap', async () => {
      const id = await newLink('https://example.com/eventually-succeeds');
      const failing = stubDeps({ ok: false, reason: 'timeout' });
      const succeeding = stubDeps(
        { ok: true, html: '<html></html>', contentType: 'text/html', finalUrl: id, status: 200 },
        { title: 'Real title', status: 'full' },
      );

      // Fail up to one short of the cap, then succeed on the cap-th attempt —
      // `full` must stand even though enrich_attempts has reached the cap.
      for (let i = 0; i < core.ENRICH_ATTEMPT_CAP - 1; i++) {
        await enrichMod.enrichLink(id, failing);
      }
      await enrichMod.enrichLink(id, succeeding);

      const link = await core.getById(id);
      expect(link?.captureStatus).toBe('full');
      expect(link?.title).toBe('Real title');
      expect(link?.deletedAt).toBeNull();
    });

    it('a non-404 fetch failure (http-error) still records degraded status and is subject to the same cap', async () => {
      const id = await newLink('https://example.com/permanently-500s');
      const deps = stubDeps({ ok: false, reason: 'http-error', detail: '503' });

      await enrichMod.enrichLink(id, deps);
      // Existing degraded-recording behavior preserved: below the cap, it's
      // just a normal bare capture, not yet settled/trashed.
      let link = await core.getById(id);
      expect(link?.captureStatus).toBe('bare');
      expect(link?.deletedAt).toBeNull();

      for (let i = 1; i < core.ENRICH_ATTEMPT_CAP; i++) {
        await enrichMod.enrichLink(id, deps);
      }

      // Same cap->settle path as any other non-full terminal status.
      link = await core.getById(id);
      expect(link?.captureStatus).toBe('bare');
      expect(link?.title).toBe('https://example.com/permanently-500s');
    });
  });
  it('upgrades partial capture status when rendering supplies full text and passes the render deadline', async () => {
    const browser = await import('./browser/reader.js');
    const renderedReader = { contentHtml: '<p>Rendered content</p>', contentImages: [] };
    const render = vi
      .spyOn(browser, 'renderReader')
      .mockResolvedValue({ reader: renderedReader, text: 'useful '.repeat(100) });
    vi.stubEnv('SILO_BROWSER_WS_ENDPOINT', 'ws://configured/');
    try {
      const id = await newLink('https://example.com/rendered-partial');
      await enrichMod.enrichLink(
        id,
        stubDeps(
          {
            ok: true,
            html: '',
            contentType: 'text/html',
            finalUrl: 'https://example.com/final',
            status: 200,
          },
          { status: 'partial', text: 'Static shell' },
        ),
      );
      expect((await core.getById(id))?.captureStatus).toBe('full');
      expect(await core.getStoredReader(id)).toMatchObject(renderedReader);
      expect(render).toHaveBeenCalledWith('https://example.com/final', expect.any(AbortSignal));
      expect(render.mock.calls[0]?.[1]?.aborted).toBe(false);
    } finally {
      render.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('capture and refresh do not render explicit non-HTML MIME', async () => {
    const browser = await import('./browser/reader.js');
    const render = vi.spyOn(browser, 'renderReader');
    vi.stubEnv('SILO_BROWSER_WS_ENDPOINT', 'ws://configured/');
    try {
      const id = await newLink('https://example.com/document.pdf');
      const page = {
        ok: true as const,
        html: '%PDF',
        contentType: 'application/pdf',
        finalUrl: 'https://example.com/document.pdf',
        status: 200,
      };
      await enrichMod.enrichLink(id, stubDeps(page, { status: 'bare' }));
      const { createReaderRefresher } = await import('./reader/refresh-reader.js');
      const refresh = createReaderRefresher(() => {}, {
        fetch: async () => page,
        extract: async () => ({ status: 'bare' }),
      });
      await refresh({ id, url: page.finalUrl, sourceKind: 'link' }, new AbortController().signal);
      expect(render).not.toHaveBeenCalled();
    } finally {
      render.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  describe('stored Reader capture and refresh parity', () => {
    const reader = { contentHtml: '<p>Extracted body</p>', contentImages: [] };
    const watch = `<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: 'abcdefghijk', shortDescription: 'Watch description', author: 'Channel' } })};</script>`;
    it.each([
      {
        name: 'readerFailed',
        sourceKind: 'link',
        html: '',
        extracted: { status: 'partial', readerFailed: true },
        status: 'fetch_failed',
        text: null,
      },
      {
        name: 'no_reader',
        sourceKind: 'link',
        html: '',
        extracted: { status: 'partial', text: 'Fallback text' },
        status: 'no_reader',
        text: 'Fallback text',
      },
      {
        name: 'twitter',
        sourceKind: 'twitter',
        html: '',
        extracted: { status: 'partial', reader, text: 'Tweet' },
        status: 'no_reader',
        text: 'Tweet',
      },
      {
        name: 'youtube',
        sourceKind: 'youtube',
        html: watch,
        extracted: { status: 'partial', reader, text: 'Wrong chrome' },
        status: 'reader',
        text: 'Watch description',
      },
      {
        name: 'youtube-failed',
        sourceKind: 'youtube',
        html: watch,
        extracted: { status: 'partial', readerFailed: true },
        status: 'reader',
        text: 'Watch description',
      },
      {
        name: 'youtube-fallback',
        sourceKind: 'youtube',
        html: '',
        extracted: {
          status: 'partial',
          reader,
          description: 'Fallback description',
          text: 'Wrong chrome',
        },
        status: 'reader',
        text: 'Fallback description',
      },
    ] as const)('stores matching content for $name', async (fixture) => {
      const link = await core.createLink({
        url: `https://example.org/parity-${fixture.name}`,
        sourceKind: fixture.sourceKind,
      });
      const page = {
        ok: true as const,
        html: fixture.html,
        contentType: 'text/html',
        finalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        status: 200,
      };
      await enrichMod.enrichLink(link.id, stubDeps(page, fixture.extracted));
      const captured = await core.getStoredReader(link.id);
      expect((await core.getById(link.id))?.extractedText).toBe(fixture.text);
      const { createReaderRefresher } = await import('./reader/refresh-reader.js');
      core.setReaderRefresher(
        createReaderRefresher(() => {}, {
          fetch: async () => page,
          extract: async () => fixture.extracted,
        }),
      );
      try {
        const refreshed = await core.refreshReader(link.id);
        expect(refreshed.status).toBe(fixture.status);
        expect((await core.getById(link.id))?.extractedText).toBe(fixture.text);
        if (refreshed.status === 'reader') {
          expect(refreshed.reader.contentHtml).toBe(captured?.contentHtml);
          expect(refreshed.reader.contentImages).toEqual(captured?.contentImages);
          if (fixture.html) expect(captured?.contentHtml).toContain('Watch description');
        } else expect(captured).toBeUndefined();
      } finally {
        core.setReaderRefresher(undefined);
      }
    });
    it('registerLiveReader wires the real refresher and clears the cached live entry', async () => {
      const { registerLiveReader } = await import('./reader/live-reader.js');
      const fetchModule = await import('./fetch/safe-fetch.js');
      const extractModule = await import('./extract/extract.js');
      const link = await core.createLink({ url: 'https://example.org/wiring', sourceKind: 'link' });
      const page = {
        ok: true as const,
        html: '<html></html>',
        contentType: 'text/html',
        finalUrl: link.url,
        status: 200,
      };
      const fetch = vi.spyOn(fetchModule, 'safeFetch').mockResolvedValue(page);
      const fresh = { contentHtml: '<p>Fresh body</p>', contentImages: [] };
      const run = vi
        .spyOn(extractModule, 'extract')
        .mockResolvedValueOnce({ status: 'full', reader })
        .mockResolvedValue({ status: 'full', reader: fresh, text: 'Fresh text' });
      const registration = registerLiveReader();
      try {
        const signal = new AbortController().signal;
        expect(await core.readLive(link, signal)).toEqual(reader);
        expect(await core.readLive(link, signal)).toEqual(reader);
        expect(fetch).toHaveBeenCalledOnce();
        expect(await core.refreshReader(link.id)).toMatchObject({
          status: 'reader',
          reader: fresh,
        });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(await core.readLive(link, signal)).toEqual(fresh);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(run).toHaveBeenCalledTimes(3);
      } finally {
        registration.close();
        fetch.mockRestore();
        run.mockRestore();
      }
    });
  });
});
