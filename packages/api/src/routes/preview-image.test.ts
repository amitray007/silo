import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level tests for `GET /api/preview-image` (source-data/rich-previews
 * slice, plan 012, item 6). Needs a real Postgres (a real `core.createLink`/
 * `getById` link, matching `docs/rules/testing.md`'s "integration where
 * mocks can't prove it" rule for the linkId-lookup path) — but the actual
 * network fetch (`fetchImageSafely`) is mocked at the module boundary, since
 * its own SSRF-gate behavior (DNS classification, pinning, redirect/byte-cap
 * handling) already has thorough dedicated unit tests in
 * `../ssrf-safe-image-fetch.test.ts`. This suite instead proves the ROUTE's
 * own logic: linkId-only lookup (never a client-supplied URL), 404 on
 * missing link/image/fetch-failure, and the response cache.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

vi.mock('../ssrf-safe-image-fetch.js', () => ({
  fetchImageSafely: vi.fn(),
}));

describeIfPg('GET /api/preview-image (integration)', () => {
  const harness = setupPgHarness('silo_api_preview_image_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    const { fetchImageSafely } = await import('../ssrf-safe-image-fetch.js');
    return { core, app: createApp() as Hono, fetchImageSafely: vi.mocked(fetchImageSafely) };
  });

  let resetCache: () => void;

  beforeEach(async () => {
    const { __resetPreviewImageCacheForTests } = await import('./preview-image.js');
    resetCache = __resetPreviewImageCacheForTests;
    resetCache();
    harness.mod().fetchImageSafely.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves a feed post image with one cold database query', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const { db, feeds, pool } = await import('@silo/db');
    const [feed] = await db
      .insert(feeds)
      .values({
        feedUrl: 'https://feed-image.example/rss',
        title: 'Feed',
        format: 'rss',
        nextPollAt: new Date(),
      })
      .returning();
    if (!feed) throw new Error('missing feed');
    const post = await core.createFeedPost({
      feedId: feed.id,
      url: 'https://feed-image.example/post',
    });
    if (!post) throw new Error('missing post');
    await core.recordEnrichment(post.id, {
      status: 'full',
      imageUrl: 'https://cdn.example/post.png',
    });
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2]),
      contentType: 'image/png',
    });
    const spy = vi.spyOn(pool, 'query');
    const response = await app.request(`/api/preview-image?linkId=${post.id}`);
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fetchImageSafely).toHaveBeenCalledWith('https://cdn.example/post.png');
  });

  it('a link with a captured imageUrl -> 200 with image bytes + content-type', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-happy',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://cdn.example.com/og-image.png',
    });
    const bytes = new Uint8Array([9, 8, 7]);
    fetchImageSafely.mockResolvedValue({ ok: true, bytes, contentType: 'image/png' });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]+"$/);
    const unchanged = await app.request(`/api/preview-image?linkId=${created.id}`, {
      headers: { 'If-None-Match': etag ?? '', 'Accept-Encoding': 'gzip' },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('etag')).toBe(etag);
    expect(unchanged.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(unchanged.headers.get('x-content-type-options')).toBe('nosniff');
    expect(unchanged.headers.get('content-encoding')).toBeNull();
    expect(await unchanged.text()).toBe('');
    const changed = await app.request(`/api/preview-image?linkId=${created.id}`, {
      headers: { 'If-None-Match': '"stale"' },
    });
    expect(changed.status).toBe(200);
    expect(new Uint8Array(await changed.arrayBuffer())).toEqual(bytes);

    // nosniff so a browser can't MIME-sniff the proxied bytes into something
    // executable (security review, plan 012).
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(bytes));

    // The route calls fetchImageSafely with the LINK'S OWN stored imageUrl —
    // never anything client-supplied. This IS the SSRF guard: a client
    // cannot make this route fetch an arbitrary url of their choosing.
    expect(fetchImageSafely).toHaveBeenCalledWith('https://cdn.example.com/og-image.png');
  });

  it('falls back to a YouTube sourceData.thumbnailUrl when imageUrl is null', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      sourceKind: 'youtube',
    });
    // The YouTube enricher stores the thumbnail in sourceData, NOT imageUrl.
    await core.recordEnrichment(created.id, {
      status: 'full',
      sourceData: {
        kind: 'youtube',
        channel: 'Rick Astley',
        thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    fetchImageSafely.mockResolvedValue({ ok: true, bytes, contentType: 'image/jpeg' });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(200);
    // The thumbnail URL is server-derived (the enricher's), not client input.
    expect(fetchImageSafely).toHaveBeenCalledWith(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });

  it('rejects an image/svg+xml upstream (XSS vector) as no-preview (404)', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/svg-og-image',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://evil.example.com/xss.svg',
    });
    // An attacker-controlled og:image responding as SVG (which can carry inline
    // <script>) must be rejected — SVG is not in the raster-only allowlist.
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1]),
      contentType: 'image/svg+xml',
    });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(404);
  });

  it('normalizes a charset-suffixed image content-type (image/png; charset=binary -> image/png)', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-charset',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://cdn.example.com/charset.png',
    });
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1]),
      contentType: 'image/png; charset=binary',
    });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('a non-image content-type from an arbitrary imageUrl host -> 404 (never forwarded as same-origin html)', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-nonimage',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://evil.example.com/og-image',
    });
    // A malicious og:image host answers text/html — must NOT be forwarded
    // from silo's origin (security review, plan 012).
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new TextEncoder().encode('<script>alert(1)</script>'),
      contentType: 'text/html',
    });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('a linkId with no captured imageUrl -> 404, no fetch attempted', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-no-image',
      sourceKind: 'link',
    });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it('an unknown linkId -> 404, no fetch attempted', async () => {
    const { app, fetchImageSafely } = harness.mod();
    const unknownId = '00000000-0000-0000-0000-000000000000';

    const res = await app.request(`/api/preview-image?linkId=${unknownId}`);
    expect(res.status).toBe(404);
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it('a trashed link -> 404 (live-scoped via core.getById)', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-trashed',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://cdn.example.com/trashed-image.png',
    });
    await core.softDelete(created.id);

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(404);
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it('a non-uuid linkId -> 400 validation_error', async () => {
    const { app } = harness.mod();
    const res = await app.request('/api/preview-image?linkId=not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('validation_error');
  });

  it('missing linkId -> 400 validation_error', async () => {
    const { app } = harness.mod();
    const res = await app.request('/api/preview-image');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('validation_error');
  });

  it('a client CANNOT supply an arbitrary url param instead of linkId (the SSRF guard)', async () => {
    const { app, fetchImageSafely } = harness.mod();
    // Even if a client tries to smuggle a url-shaped value into linkId, the
    // Zod uuid schema rejects it before any lookup/fetch — proving the
    // route has no code path that turns client input directly into a fetch
    // target.
    const res = await app.request(
      `/api/preview-image?linkId=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`,
    );
    expect(res.status).toBe(400);
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it('fetchImageSafely failure -> 404, sanitized body', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-fetch-fail',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://cdn.example.com/unreachable.png',
    });
    fetchImageSafely.mockResolvedValue({ ok: false });

    const res = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('cache hit on a repeat request does not re-invoke fetchImageSafely', async () => {
    const { core, app, fetchImageSafely } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/preview-image-cache',
      sourceKind: 'link',
    });
    await core.recordEnrichment(created.id, {
      status: 'full',
      imageUrl: 'https://cdn.example.com/cache-me.png',
    });
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1]),
      contentType: 'image/jpeg',
    });

    const first = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(first.status).toBe(200);
    expect(fetchImageSafely).toHaveBeenCalledTimes(1);

    const second = await app.request(`/api/preview-image?linkId=${created.id}`);
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toBe('image/jpeg');
    expect(fetchImageSafely).toHaveBeenCalledTimes(1);
  });

  describe('failed fetches and concurrent requests', () => {
    async function linkWithImage(slug: string, imageUrl: string): Promise<string> {
      const { core } = harness.mod();
      const created = await core.createLink({
        url: `https://example.com/preview-image-${slug}`,
        sourceKind: 'link',
      });
      await core.recordEnrichment(created.id, { status: 'full', imageUrl });
      return created.id;
    }

    it('remembers a failed fetch: the repeat request is a 404 with no second upstream fetch', async () => {
      const { app, fetchImageSafely } = harness.mod();
      const id = await linkWithImage('miss-cached', 'https://cdn.example.com/broken.png');
      fetchImageSafely.mockResolvedValue({ ok: false });

      const first = await app.request(`/api/preview-image?linkId=${id}`);
      const second = await app.request(`/api/preview-image?linkId=${id}`);

      expect(first.status).toBe(404);
      expect(second.status).toBe(404);
      expect(((await second.json()) as { message: string }).message).toBe(
        'Preview image unavailable',
      );
      expect(fetchImageSafely).toHaveBeenCalledTimes(1);
    });

    it('remembers a non-image upstream the same way', async () => {
      const { app, fetchImageSafely } = harness.mod();
      const id = await linkWithImage('miss-html', 'https://cdn.example.com/page.png');
      fetchImageSafely.mockResolvedValue({
        ok: true,
        bytes: new Uint8Array([60]),
        contentType: 'text/html',
      });

      expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(404);
      expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(404);
      expect(fetchImageSafely).toHaveBeenCalledTimes(1);
    });

    it('retries after an hour', async () => {
      const { app, fetchImageSafely } = harness.mod();
      const id = await linkWithImage('miss-expiry', 'https://cdn.example.com/flaky.png');
      fetchImageSafely.mockResolvedValueOnce({ ok: false });
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(404);

        vi.setSystemTime(Date.now() + 59 * 60 * 1000);
        expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(404);
        expect(fetchImageSafely).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 2 * 60 * 1000);
        fetchImageSafely.mockResolvedValueOnce({
          ok: true,
          bytes: new Uint8Array([5]),
          contentType: 'image/png',
        });
        expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(200);
        expect(fetchImageSafely).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries at once when the link gets a different image url', async () => {
      const { core, app, fetchImageSafely } = harness.mod();
      const id = await linkWithImage('miss-new-url', 'https://cdn.example.com/old.png');
      fetchImageSafely.mockResolvedValueOnce({ ok: false });
      expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(404);

      await core.recordEnrichment(id, {
        status: 'full',
        imageUrl: 'https://cdn.example.com/new.png',
      });
      fetchImageSafely.mockResolvedValueOnce({
        ok: true,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
      });
      expect((await app.request(`/api/preview-image?linkId=${id}`)).status).toBe(200);
      expect(fetchImageSafely).toHaveBeenLastCalledWith('https://cdn.example.com/new.png');
    });

    it('does not remember "no image yet": an image added by enrichment is served right away', async () => {
      const { core, app, fetchImageSafely } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/preview-image-enrich-later',
        sourceKind: 'link',
      });
      expect((await app.request(`/api/preview-image?linkId=${created.id}`)).status).toBe(404);

      await core.recordEnrichment(created.id, {
        status: 'full',
        imageUrl: 'https://cdn.example.com/arrived.png',
      });
      fetchImageSafely.mockResolvedValue({
        ok: true,
        bytes: new Uint8Array([2]),
        contentType: 'image/png',
      });
      expect((await app.request(`/api/preview-image?linkId=${created.id}`)).status).toBe(200);
    });

    it('coalesces concurrent requests for one link into one upstream fetch', async () => {
      const { app, fetchImageSafely } = harness.mod();
      const id = await linkWithImage('coalesce', 'https://cdn.example.com/slow.png');
      let release: (value: { ok: true; bytes: Uint8Array; contentType: string }) => void = () => {};
      fetchImageSafely.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const pending = Array.from({ length: 8 }, () =>
        app.request(`/api/preview-image?linkId=${id}`),
      );
      await vi.waitFor(() => expect(fetchImageSafely).toHaveBeenCalledTimes(1));
      release({ ok: true, bytes: new Uint8Array([7, 7]), contentType: 'image/png' });
      const responses = await Promise.all(pending);

      expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
      for (const res of responses) {
        expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([7, 7]);
      }
      expect(fetchImageSafely).toHaveBeenCalledTimes(1);
    });

    it('coalesced requests share a failure, and the next request after it is not stuck', async () => {
      const { app, fetchImageSafely } = harness.mod();
      const id = await linkWithImage('coalesce-fail', 'https://cdn.example.com/dead.png');
      fetchImageSafely.mockResolvedValue({ ok: false });

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => app.request(`/api/preview-image?linkId=${id}`)),
      );

      expect(responses.map((r) => r.status)).toEqual(Array(5).fill(404));
      expect(fetchImageSafely).toHaveBeenCalledTimes(1);
    });
  });
});
