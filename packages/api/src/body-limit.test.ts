import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('global request body limit', () => {
  it('rejects a streamed normal body one byte over 1 MiB with the error envelope', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    app.post('/body-limit-test', async (c) => c.json({ size: (await c.req.text()).length }));
    const res = await app.request('/body-limit-test', {
      method: 'POST',
      body: 'x'.repeat(1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'payload_too_large',
      message: 'Request body exceeds 1 MB',
    });
  });

  it('accepts a normal body at the cap', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    app.post('/body-limit-test', async (c) => c.json({ size: (await c.req.text()).length }));
    const res = await app.request('/body-limit-test', {
      method: 'POST',
      body: 'x'.repeat(1024 * 1024),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: 1024 * 1024 });
  });

  it.each(['GET', 'HEAD'])(
    'leaves %s responses and bodyless requests untouched',
    async (method) => {
      const { createApp } = await import('./app.js');
      const res = await createApp().request('/health', { method });
      expect(res.status).toBe(200);
    },
  );
});

describe('authentication precedes body buffering', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['/api/import', 'POST', ''],
    ['/api/ingest', 'POST', ''],
    ['/api/import', 'POST', 'configured'],
    ['/api/links', 'POST', 'configured'],
    ['/api/settings', 'PATCH', 'configured'],
    ['/api/links/00000000-0000-4000-8000-000000000001/reader-prefs', 'PATCH', 'configured'],
  ])(
    'rejects unauthenticated %s before consuming an endless oversized stream',
    async (path, method, token) => {
      vi.stubEnv('SILO_API_TOKEN', token);
      vi.stubEnv('SILO_APP_PASSWORD', '');
      let reads = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads += 1;
            controller.enqueue(new Uint8Array(26 * 1024 * 1024));
            // Never close: buffering would either reject with 413 or wait forever.
          },
        },
        { highWaterMark: 0 },
      );
      const request = new Request(
        `http://localhost${path}`,
        Object.assign(
          {
            method,
            body: stream,
          },
          { duplex: 'half' as const },
        ),
      );
      const { createApp } = await import('./app.js');
      const response = await createApp().request(request);
      expect(response.status).toBe(401);
      expect(reads).toBe(0);
      expect(request.bodyUsed).toBe(false);
      await stream.cancel();
    },
  );

  it('rejects an authenticated oversized streamed import with 413', async () => {
    vi.stubEnv('SILO_API_TOKEN', 'body-limit-test');
    const { createApp } = await import('./app.js');
    const response = await createApp().request('/api/import', {
      method: 'POST',
      headers: { authorization: 'Bearer body-limit-test' },
      body: 'x'.repeat(25 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });
});
