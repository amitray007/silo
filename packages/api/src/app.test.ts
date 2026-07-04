import { beforeAll, describe, expect, it } from 'vitest';
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
 * App-level tests via Hono's built-in `app.request(...)` — no listening
 * socket needed (see `createApp`'s doc comment: it's returned unstarted for
 * exactly this). A1 registers no `/api/*` routes yet (A2–A4 add them), so
 * this file covers what A1 owns: the app boots, `GET /` and `GET /health`,
 * the `notFound` envelope, and (via a temporary test-only route) the
 * `onError` mapping for `InvalidCursorError`/`ZodError`/an unknown error.
 */
describe('createApp', () => {
  it('builds a Hono app', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    expect(app).toBeDefined();
  });

  it('GET / returns a service descriptor', async () => {
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
