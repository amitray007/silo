import { request } from 'node:http';
import { serve } from '@hono/node-server';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const CSP =
  "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:; media-src *; frame-ancestors 'self'";

describeIfPg('Original routes (Postgres)', () => {
  const harness = setupPgHarness('silo_page_view_test', async () => {
    const core = await import('@silo/core');
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });
  beforeEach(() => {
    vi.stubEnv('SILO_API_TOKEN', '');
    vi.stubEnv('SILO_APP_PASSWORD', '');
  });
  afterEach(() => {
    harness.mod().core.setPageViewer(undefined);
    vi.unstubAllEnvs();
  });
  async function capture(slug = 'page') {
    return harness
      .mod()
      .core.createLink({ url: `https://publisher.test/${slug}`, sourceKind: 'link' });
  }

  it('returns 503 on both routes without a process-local registration', async () => {
    const link = await capture('no-viewer');
    for (const route of ['view', 'frame']) {
      const response = await harness.mod().app.request(`/api/links/${link.id}/${route}`);
      expect(response.status).toBe(503);
      if (route === 'view') expect(response.headers.get('content-security-policy')).toBe(CSP);
      expect(await response.json()).toEqual({
        error: 'service_unavailable',
        message: 'Page viewer unavailable',
      });
    }
  });
  it('serves the exact security headers and only the stored link URL', async () => {
    const { core, app } = harness.mod();
    const link = await capture('headers');
    const viewer = vi.fn(async () => ({
      frame: { mode: 'view' as const, contentType: 'text/html' },
      html: '<!doctype html><p>Safe page</p>',
    }));
    core.setPageViewer(viewer);
    const response = await app.request(
      `https://silo.test:5175/api/links/${link.id}/view?url=http://localhost/evil`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<!doctype html><p>Safe page</p>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=UTF-8');
    expect(response.headers.get('content-security-policy')).toBe(CSP);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(viewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: link.id, url: link.url, origin: 'https://silo.test:5175' }),
    );
  });
  it.each(['direct', 'view', 'none'] as const)(
    'returns the %s JSON hint without forwarding HTML',
    async (mode) => {
      const { core, app } = harness.mod();
      const link = await capture(mode);
      core.setPageViewer(async () => ({
        frame: { mode, reason: 'test', contentType: 'text/html' },
        html: '<p>private</p>',
      }));
      const response = await app.request(`/api/links/${link.id}/frame`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ mode, reason: 'test', contentType: 'text/html' });
    },
  );
  it('returns 404 for unavailable HTML, missing links, or trashed links; validates IDs', async () => {
    const { core, app } = harness.mod();
    const link = await capture('missing-html');
    const viewer = vi.fn(async () => ({ frame: { mode: 'none' as const } }));
    core.setPageViewer(viewer);
    expect((await app.request(`/api/links/${link.id}/view`)).status).toBe(404);
    await core.softDelete(link.id);
    for (const route of ['view', 'frame']) {
      expect((await app.request(`/api/links/${link.id}/${route}`)).status).toBe(404);
      expect(
        (await app.request(`/api/links/00000000-0000-4000-8000-000000000000/${route}`)).status,
      ).toBe(404);
      expect((await app.request(`/api/links/invalid/${route}`)).status).toBe(400);
    }
    expect(viewer).toHaveBeenCalledTimes(1);
  });
  it('uses the common authentication gate for both routes', async () => {
    vi.stubEnv('SILO_API_TOKEN', 'test-only-token');
    const { core, app } = harness.mod();
    const link = await capture('auth');
    core.setPageViewer(async () => ({ frame: { mode: 'view' }, html: '<p>Safe</p>' }));
    for (const route of ['view', 'frame']) {
      expect((await app.request(`/api/links/${link.id}/${route}`)).status).toBe(401);
      expect(
        (
          await app.request(`/api/links/${link.id}/${route}`, {
            headers: { Authorization: 'Bearer test-only-token' },
          })
        ).status,
      ).toBe(200);
    }
  });
  it('maps a saturated viewer to 503', async () => {
    const { core, app } = harness.mod();
    const link = await capture('busy');
    core.setPageViewer(async () => {
      throw new core.PageViewerUnavailableError();
    });
    expect((await app.request(`/api/links/${link.id}/frame`)).status).toBe(503);
  });
  it('propagates a real socket disconnect to the viewer signal', async () => {
    const { core, app } = harness.mod();
    const link = await capture('disconnect');
    let observed: AbortSignal | undefined;
    core.setPageViewer(({ signal }) => {
      observed = signal;
      return new Promise((resolve) =>
        signal.addEventListener('abort', () => resolve({ frame: { mode: 'none' } }), {
          once: true,
        }),
      );
    });
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No bound address');
    const client = request(`http://127.0.0.1:${address.port}/api/links/${link.id}/frame`);
    client.on('error', () => {});
    client.end();
    try {
      await vi.waitFor(() => expect(observed).toBeDefined());
      client.destroy();
      await vi.waitFor(() => expect(observed?.aborted).toBe(true));
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
