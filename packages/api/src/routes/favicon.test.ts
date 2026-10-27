import { setSiteIconFinder } from '@silo/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for `GET /api/favicon` (plan 011, V3-2) — driven via
 * `createApp()` + Hono's `app.request(...)`, with `global.fetch` mocked. This
 * route makes no `@silo/core`/DB call (it never touches core), so there is
 * nothing for a Postgres harness to add — but `app.ts` still imports
 * `@silo/core` (transitively `@silo/db`) at module load for `InvalidCursorError`,
 * whose client singleton reads `DATABASE_URL` eagerly. Mirrors `app.test.ts`'s
 * exact pattern: a syntactically valid placeholder is enough since `pg.Pool`
 * connects lazily and this suite never opens a real connection; the env var
 * is set before `./app.js` is first (dynamically) imported so it's in place
 * when the module graph loads.
 */
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

// The site-icon fallback fetches through the SSRF-safe image fetcher, which has its
// own dedicated tests; here it is mocked at the module boundary.
vi.mock('../ssrf-safe-image-fetch.js', () => ({ fetchImageSafely: vi.fn() }));

describe('GET /api/favicon (unit)', () => {
  let app: Awaited<ReturnType<typeof import('../app.js').createApp>>;
  let resetFaviconCache: () => void;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const { createApp } = await import('../app.js');
    const { __resetFaviconCacheForTests } = await import('./favicon.js');
    app = createApp();
    resetFaviconCache = __resetFaviconCacheForTests;
  });

  beforeEach(() => {
    resetFaviconCache();
  });

  afterEach(() => {
    setSiteIconFinder(undefined);
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('a good domain -> 200 with image bytes + the upstream content-type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await app.request('/api/favicon?domain=example.com');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(bytes));

    // The fetched URL host is ALWAYS google.com's s2 service — the SSRF
    // safety property this route relies on (see favicon.ts's doc comment).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl.startsWith('https://www.google.com/s2/favicons?')).toBe(true);
    expect(calledUrl).toContain('domain=example.com');
  });

  it('a bad domain (URL, not a bare hostname) -> 400 validation_error, no upstream fetch', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await app.request('/api/favicon?domain=https://example.com/path');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('validation_error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing domain -> 400 validation_error', async () => {
    const res = await app.request('/api/favicon');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('validation_error');
  });

  it('empty domain -> 400 validation_error', async () => {
    const res = await app.request('/api/favicon?domain=');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('validation_error');
  });

  it('upstream failure (non-2xx) -> 404, sanitized body', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 })) as unknown as typeof fetch;

    const res = await app.request('/api/favicon?domain=upstream-fail.example');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('upstream network error/timeout -> 404, never leaks the raw error', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('upstream exploded')) as unknown as typeof fetch;

    const res = await app.request('/api/favicon?domain=network-fail.example');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_found');
    expect(body.message).not.toContain('upstream exploded');
  });

  it('cache hit on a repeat request does not refetch upstream', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(bytes, { status: 200, headers: { 'content-type': 'image/x-icon' } }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await app.request('/api/favicon?domain=cache-me.example');
    expect(first.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await app.request('/api/favicon?domain=cache-me.example');
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toBe('image/x-icon');
    // Still 1 — the second request was served from the in-memory cache.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('different domains are cached independently', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([2]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await app.request('/api/favicon?domain=domain-one.example');
    await app.request('/api/favicon?domain=domain-two.example');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('site icon fallback', () => {
    const googleMiss = () =>
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch;

    async function mockedImageFetch() {
      const { fetchImageSafely } = await import('../ssrf-safe-image-fetch.js');
      const mock = vi.mocked(fetchImageSafely);
      mock.mockReset();
      return mock;
    }

    it('Google 404 then a site icon -> serves the site icon with nosniff', async () => {
      global.fetch = googleMiss();
      const finder = vi.fn(async () => ['https://site.example/fav.png']);
      setSiteIconFinder(finder);
      const imageFetch = await mockedImageFetch();
      const bytes = new Uint8Array([7, 7, 7]);
      imageFetch.mockResolvedValue({ ok: true, bytes, contentType: 'image/png; charset=binary' });

      const res = await app.request('/api/favicon?domain=site.example');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toContain('max-age=86400');
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([7, 7, 7]);
      expect(finder).toHaveBeenCalledWith('site.example', expect.any(AbortSignal));
      expect(imageFetch).toHaveBeenCalledWith('https://site.example/fav.png');

      // The found icon is cached: no further Google, finder or image fetch.
      const again = await app.request('/api/favicon?domain=site.example');
      expect(again.status).toBe(200);
      expect(finder).toHaveBeenCalledTimes(1);
      expect(imageFetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('Google network error also falls back to the site icon', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
      setSiteIconFinder(async () => ['https://site.example/fav.ico']);
      const imageFetch = await mockedImageFetch();
      imageFetch.mockResolvedValue({
        ok: true,
        bytes: new Uint8Array([1]),
        contentType: 'image/x-icon',
      });

      const res = await app.request('/api/favicon?domain=site.example');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/x-icon');
    });

    it('Google 404 and no site icon -> 404, and the miss is cached', async () => {
      global.fetch = googleMiss();
      const finder = vi.fn(async (): Promise<string[]> => []);
      setSiteIconFinder(finder);
      const imageFetch = await mockedImageFetch();

      const first = await app.request('/api/favicon?domain=none.example');
      expect(first.status).toBe(404);
      expect(((await first.json()) as { error: string }).error).toBe('not_found');
      const second = await app.request('/api/favicon?domain=none.example');
      expect(second.status).toBe(404);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(finder).toHaveBeenCalledTimes(1);
      expect(imageFetch).not.toHaveBeenCalled();
    });

    it('a cached miss expires after an hour', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        global.fetch = googleMiss();
        const finder = vi.fn(async (): Promise<string[]> => []);
        setSiteIconFinder(finder);
        await app.request('/api/favicon?domain=retry.example');
        vi.setSystemTime(Date.now() + 61 * 60 * 1000);
        await app.request('/api/favicon?domain=retry.example');
        expect(finder).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuses a site icon whose content type is not an allowed image', async () => {
      global.fetch = googleMiss();
      setSiteIconFinder(async () => ['https://site.example/evil']);
      const imageFetch = await mockedImageFetch();
      for (const contentType of ['text/html', 'image/svg+xml']) {
        resetFaviconCache();
        imageFetch.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType });
        const res = await app.request('/api/favicon?domain=site.example');
        expect(res.status).toBe(404);
      }
    });

    it('tries the next candidate and serves a real SVG icon sandboxed', async () => {
      global.fetch = googleMiss();
      setSiteIconFinder(async () => [
        'https://site.example/favicon.ico',
        'https://site.example/favicon.svg',
      ]);
      const imageFetch = await mockedImageFetch();
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      imageFetch
        .mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([60]), contentType: 'text/html' })
        .mockResolvedValueOnce({ ok: true, bytes: svg, contentType: 'image/svg+xml' });

      const res = await app.request('/api/favicon?domain=site.example');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(imageFetch).toHaveBeenCalledTimes(2);
    });

    it('refuses an oversized SVG', async () => {
      global.fetch = googleMiss();
      setSiteIconFinder(async () => ['https://site.example/favicon.svg']);
      const imageFetch = await mockedImageFetch();
      const big = new TextEncoder().encode(`<svg>${' '.repeat(70 * 1024)}</svg>`);
      imageFetch.mockResolvedValue({ ok: true, bytes: big, contentType: 'image/svg+xml' });
      const res = await app.request('/api/favicon?domain=site.example');
      expect(res.status).toBe(404);
    });

    it('a failed site image fetch -> 404', async () => {
      global.fetch = googleMiss();
      setSiteIconFinder(async () => ['https://site.example/fav.png']);
      const imageFetch = await mockedImageFetch();
      imageFetch.mockResolvedValue({ ok: false });

      const res = await app.request('/api/favicon?domain=site.example');
      expect(res.status).toBe(404);
    });

    it('does not call the site fallback when Google has the icon', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(new Uint8Array([5]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ) as unknown as typeof fetch;
      const finder = vi.fn(async () => ['https://site.example/fav.png']);
      setSiteIconFinder(finder);

      const res = await app.request('/api/favicon?domain=google-knows.example');
      expect(res.status).toBe(200);
      expect(finder).not.toHaveBeenCalled();
    });
  });
});
