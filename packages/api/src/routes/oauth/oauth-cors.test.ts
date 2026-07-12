import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { oauthCorsMiddleware } from './oauth-cors.js';

/**
 * Unit tests for the wildcard OAuth CORS middleware — no DB, no `createApp()`
 * needed, just a bare Hono app with the middleware mounted (mirrors how
 * `cors.test.ts` tests `corsMiddleware()` in isolation, if that file exists;
 * otherwise this is the direct equivalent for the wildcard sibling).
 */
describe('oauthCorsMiddleware', () => {
  it('emits Access-Control-Allow-Origin: * on a GET response, for ANY Origin', async () => {
    const app = new Hono();
    app.use('*', oauthCorsMiddleware());
    app.get('/probe', (c) => c.json({ ok: true }));

    const res = await app.request('/probe', {
      headers: { Origin: 'https://chatgpt.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('handles a CORS preflight OPTIONS request', async () => {
    const app = new Hono();
    app.use('*', oauthCorsMiddleware());
    app.post('/probe', (c) => c.json({ ok: true }));

    const res = await app.request('/probe', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://claude.ai',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
