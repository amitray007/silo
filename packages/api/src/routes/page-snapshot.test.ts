import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('PUT browser page (Postgres)', () => {
  const harness = setupPgHarness('silo_page_api', async () => {
    const core = await import('@silo/core');
    core.setPageEnqueuer(async () => {});
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });
  afterEach(() => vi.unstubAllEnvs());
  const page = {
    url: 'https://example.org/article?utm_source=browser',
    html: '<article>Private body</article>',
    capturedAt: new Date().toISOString(),
  };
  async function request(id: string, body: unknown = page, headers: Record<string, string> = {}) {
    return harness.mod().app.request(`/api/links/${id}/page`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }
  it('accepts canonical matches and persists only the newer snapshot', async () => {
    const { core } = harness.mod();
    const link = await core.createLink({ sourceKind: 'link', url: 'https://example.org/article' });
    expect((await request(link.id)).status).toBe(202);
    expect(
      (await request(link.id, { ...page, html: 'old', capturedAt: '2020-01-01T00:00:00Z' })).status,
    ).toBe(202);
    expect((await core.getPageSnapshot(link.id))?.html).toBe(page.html);
  });
  it('rejects mismatched URLs and missing links', async () => {
    const link = await harness
      .mod()
      .core.createLink({ sourceKind: 'link', url: 'https://example.org/different' });
    expect((await request(link.id)).status).toBe(400);
    expect((await request('6f1c1b0e-6f55-4d1c-9a55-1b0f4a3d2e10')).status).toBe(404);
  });
  it('validates the input and bounds authenticated bodies at 10 MB', async () => {
    const link = await harness.mod().core.createLink({ sourceKind: 'link', url: page.url });
    expect((await request(link.id, { ...page, capturedAt: 'invalid' })).status).toBe(400);
    expect((await request(link.id, { ...page, html: 'x'.repeat(10 * 1024 * 1024) })).status).toBe(
      413,
    );
  });
  it('rolls back on queue failure and redacts raw HTML from error logs', async () => {
    const { core } = harness.mod();
    const link = await core.createLink({ sourceKind: 'link', url: 'https://example.org/failure' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    core.setPageEnqueuer(async () => {
      throw new Error(page.html);
    });
    try {
      expect((await request(link.id, { ...page, url: link.url })).status).toBe(500);
      expect(await core.getPageSnapshot(link.id)).toBeUndefined();
      expect(JSON.stringify(log.mock.calls)).not.toContain(page.html);
    } finally {
      core.setPageEnqueuer(async () => {});
      log.mockRestore();
    }
  });
  it('rejects future clocks and never logs malformed private bodies', async () => {
    const link = await harness.mod().core.createLink({ sourceKind: 'link', url: page.url });
    const logs = ['error', 'warn', 'log', 'info', 'debug'] as const;
    const spies = logs.map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
    const marker = 'PRIVATE_HTML_MARKER';
    try {
      const malformed = await harness.mod().app.request(`/api/links/${link.id}/page`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: marker,
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({
        error: 'validation_error',
        message: 'Invalid page upload',
      });
      expect((await request(link.id, { ...page, url: marker })).status).toBe(400);
      expect(
        (
          await request(link.id, {
            ...page,
            capturedAt: new Date(Date.now() + 660_000).toISOString(),
          })
        ).status,
      ).toBe(400);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(marker);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
  it('authenticates before the body limit', async () => {
    vi.stubEnv('SILO_API_TOKEN', 'page-secret');
    const link = await harness.mod().core.createLink({ sourceKind: 'link', url: page.url });
    expect((await request(link.id, { ...page, html: 'x'.repeat(10 * 1024 * 1024) })).status).toBe(
      401,
    );
    expect((await request(link.id, page, { Authorization: 'Bearer page-secret' })).status).toBe(
      202,
    );
  });
});
