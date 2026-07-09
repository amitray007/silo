import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EnrichLinkDeps } from './enrich.js';
import type { ExtractResult } from './extract/extract.js';
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
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, inline: true, hover: true },
        }),
    };
  }

  async function newLink(url: string): Promise<string> {
    const link = await core.createLink({ url, sourceKind: 'link' });
    return link.id;
  }

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
    // throwing — it is contracted never-to-throw, so a throw is a real defect)
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
          }),
      });
      const link = await core.getById(id);
      // The placeholder og:image is what gets stored — no override to apply.
      expect(link?.imageUrl).toBe('https://abs.twimg.com/errors/logo46x38.png');
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: false, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
          });
        },
      });

      expect(getPluginsSettingCallCount).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[2]).toEqual({
        hacker_news: { enabled: false, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: false, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
            hacker_news: { enabled: true, inline: true, hover: true },
            github: { enabled: true, hover: true },
            youtube: { enabled: true, hover: true },
            twitter: { enabled: true, inline: true, hover: true },
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
      expect(calls[0]?.[2]).toEqual({
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
      });
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
});
