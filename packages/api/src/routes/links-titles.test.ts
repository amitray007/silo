import type { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let app: Hono;
let core: typeof import('@silo/core');
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
  core = await import('@silo/core');
  const { createApp } = await import('../app.js');
  app = createApp();
});
beforeEach(() => {
  vi.stubEnv('SILO_API_TOKEN', '');
  vi.stubEnv('SILO_APP_PASSWORD', '');
  vi.stubEnv('SILO_SESSION_SECRET', '');
});
afterEach(() => {
  core.setLinkTitleFetcher(undefined);
  vi.unstubAllEnvs();
});

function request(body: unknown) {
  return app.request('/api/links/titles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/links/titles', () => {
  it.each([
    {},
    { urls: [] },
    { urls: ['javascript:alert(1)'] },
    { urls: ['not a url'] },
    { urls: Array.from({ length: 21 }, () => 'https://example.com') },
  ])('rejects invalid body %j', async (body) => {
    const response = await request(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
  });

  it('returns the registered fetcher titles', async () => {
    const fetcher = vi.fn(async (urls: readonly string[]) => ({ [urls[0] as string]: 'Genius' }));
    core.setLinkTitleFetcher(fetcher);
    const response = await request({ urls: ['https://paulgraham.com/genius.html'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      titles: { 'https://paulgraham.com/genius.html': 'Genius' },
    });
    expect(fetcher).toHaveBeenCalledWith(
      ['https://paulgraham.com/genius.html'],
      expect.any(AbortSignal),
    );
  });

  it('returns no titles without a registered fetcher', async () => {
    const response = await request({ urls: ['https://example.com'] });
    expect(await response.json()).toEqual({ titles: {} });
  });
});
