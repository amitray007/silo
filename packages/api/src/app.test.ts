import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from './app.js';

// `app.ts` imports `@silo/core` (for `InvalidCursorError`), which transitively
// imports `@silo/db`, whose `db`/`pool` singleton reads DATABASE_URL at
// module-load time (see packages/db/src/client.ts). These are pure app-level/
// routing tests — no connection is ever opened (pg.Pool connects lazily) — so
// a syntactically valid placeholder is enough (same pattern as
// packages/mcp/server/src/server.test.ts). Dynamic-import `./app.js` so the
// env var is set before its module graph first loads.
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

/**
 * `SILO_WEB_DIST` pointed at a path that is guaranteed NOT to exist, for
 * every test in this file that means to exercise the "no web build" branch
 * (`resolveWebDistDir`'s doc comment / `createApp`'s `/` reconciliation).
 * Deliberately explicit rather than leaving the env var unset: this repo's
 * OWN `packages/web/dist` may well exist on a dev machine that has already
 * run a web build (it does not exist in CI), and `resolveWebDistDir()` falls
 * back to exactly that real path when the env var is unset — an unset-env
 * test would then silently flip behavior depending on local build state.
 * Pointing at a sibling of a real tmpdir (never created) keeps the "no dist"
 * tests honest regardless of what's on disk.
 */
const NO_DIST_PATH = join(tmpdir(), `silo-api-test-no-dist-${process.pid}-${Date.now()}`);

/**
 * App-level tests via Hono's built-in `app.request(...)` — no listening
 * socket needed (see `createApp`'s doc comment: it's returned unstarted for
 * exactly this). A1 registers no `/api/*` routes yet (A2–A4 add them), so
 * this file covers what A1 owns: the app boots, `GET /` and `GET /health`,
 * the `notFound` envelope, and (via a temporary test-only route) the
 * `onError` mapping for `InvalidCursorError`/`ZodError`/an unknown error.
 *
 * Unit 1 (deployable-silo spec) added the static/SPA serve — see the
 * `createApp — web SPA static serve` describe block below for its tests.
 * Every test in THIS block runs with `SILO_WEB_DIST` pointed at a guaranteed-
 * absent path, so it exercises the SAME "no web build" behavior this file
 * always asserted, proving Unit 1 didn't change it.
 */
describe('createApp', () => {
  beforeAll(() => {
    process.env.SILO_WEB_DIST = NO_DIST_PATH;
  });

  it('builds a Hono app', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    expect(app).toBeDefined();
  });

  it('GET / returns a service descriptor (no web build present)', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ name: 'silo' });
  });

  it('GET /health returns 200 { ok: true }', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /health carries CORS headers for an allowed origin (the Chrome extension probes it cross-origin)', async () => {
    // /health must be CORS-wrapped like /api/*: the Chrome extension's
    // checkHealth() fetches it from a chrome-extension:// origin, and without
    // CORS headers the browser blocks the response (a CORS error even when
    // /api/* would work). An allowed origin gets its origin echoed back.
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('an unknown route returns 404 with the not_found envelope', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/this-route-does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('not_found');
    expect(typeof body.message).toBe('string');
  });
});

/**
 * Unit 1 (deployable-silo spec, `docs/superpowers/specs/
 * 2026-07-11-deployable-silo-design.md`) — the static web-SPA serve + client-
 * route fallback. A real temp dist directory is built once (a fake
 * `index.html` + a nested asset) and `SILO_WEB_DIST` pointed at it, proving
 * the actual file-serving path (not a mock) end to end: a real static file
 * comes back verbatim, a client-side route falls back to `index.html`, and
 * `/api/*`/`/health` are never shadowed by it.
 */
describe('createApp — web SPA static serve (SILO_WEB_DIST present)', () => {
  const distDir = mkdtempSync(join(tmpdir(), 'silo-api-test-dist-'));
  const indexHtml =
    '<!doctype html><html><head><title>silo</title></head><body>SPA SHELL</body></html>';

  beforeAll(() => {
    writeFileSync(join(distDir, 'index.html'), indexHtml);
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'x.js'), 'console.log("asset");');
    process.env.SILO_WEB_DIST = distDir;
  });

  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
    process.env.SILO_WEB_DIST = NO_DIST_PATH;
  });

  it('GET / serves the SPA index.html (not the JSON banner)', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(indexHtml);
  });

  it('GET /trash (a client-side route) falls back to index.html', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/trash');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(indexHtml);
  });

  it('a deep client-side route (e.g. /tags/foo) also falls back to index.html', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/tags/foo');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(indexHtml);
  });

  it('GET /assets/x.js returns the real static file, not index.html', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/assets/x.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log("asset");');
    expect(res.headers.get('content-type')).not.toContain('text/html');
  });

  it('GET /api/tags still reaches the API sub-app (not shadowed by the SPA)', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags');
    // Whether DATABASE_URL points at a real, migrated DB in this test process
    // varies by how the suite is invoked (a plain `vitest run` here vs. the
    // full gate with a real Postgres) — this test doesn't care about that; it
    // only proves `/api/tags` reached the REAL `tags` route (JSON, whatever
    // its status) rather than the SPA fallback (200 text/html + index.html
    // body), which is the one shadowing failure mode this test guards against.
    // The route's actual 200-with-data behavior is covered by
    // routes/tags.test.ts against real infra.
    expect(res.headers.get('content-type')).not.toContain('text/html');
    expect(await res.text()).not.toBe(indexHtml);
  });

  it('GET /api/nonexistent still returns the JSON 404 envelope (not index.html)', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('not_found');
  });

  it('GET /health still returns { ok: true } (not shadowed by the SPA)', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('createApp — onError mapping', () => {
  it('an InvalidCursorError thrown by a route maps to 400 invalid_cursor', async () => {
    const { InvalidCursorError } = await import('@silo/core');
    const { createApp } = await import('./app.js');
    const app = createApp();
    app.get('/__test/invalid-cursor', () => {
      throw new InvalidCursorError('bad cursor for test');
    });

    const res = await app.request('/__test/invalid-cursor');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('invalid_cursor');
    expect(body.message).toBe('bad cursor for test');
  });

  it('a ZodError thrown by a route maps to 400 validation_error with issue details', async () => {
    const { z } = await import('zod');
    const { createApp } = await import('./app.js');
    const app = createApp();
    app.get('/__test/validation-error', (c) => {
      z.object({ url: z.string() }).parse({});
      return c.body(null);
    });

    const res = await app.request('/__test/validation-error');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('validation_error');
    expect(body.details).toBeDefined();
  });

  it('an unknown error maps to a sanitized 500, never leaking the raw message', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    app.get('/__test/boom', () => {
      throw new Error('SECRET internal detail: connection string leaked');
    });

    const res = await app.request('/__test/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('internal_error');
    expect(body.message).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });
});
