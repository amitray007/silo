import { beforeAll, describe, expect, it } from 'vitest';

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
