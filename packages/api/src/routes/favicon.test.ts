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
});
