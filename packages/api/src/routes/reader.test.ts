import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const content = {
  contentHtml: '<p>Live<img src="https://cdn.example.org/photo.png"></p>',
  contentImages: ['https://cdn.example.org/photo.png'],
};

describeIfPg('GET /api/links/:id/reader (Postgres)', () => {
  const harness = setupPgHarness('silo_reader_route_test', async () => {
    const core = await import('@silo/core');
    const { createApp } = await import('../app.js');
    return { core, app: createApp(), database: await import('@silo/db') };
  });
  afterEach(() => {
    harness.mod().core.setLiveReader(undefined);
    harness.mod().core.setReaderRefresher(undefined);
  });

  async function saved(slug: string, sourceKind = 'link') {
    const { core } = harness.mod();
    return core.createLink({ url: `https://example.org/${slug}`, sourceKind, tags: ['reader'] });
  }

  it('returns the live HTML and image list', async () => {
    const { app, core } = harness.mod();
    const link = await saved('ok');
    const reader = vi.fn(async () => content);
    core.setLiveReader(reader);
    const response = await app.request(`/api/links/${link.id}/reader`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...content, capturedAt: null });
    expect(reader).toHaveBeenCalledWith(
      { id: link.id, url: 'https://example.org/ok', sourceKind: 'link' },
      expect.any(AbortSignal),
    );
  });

  it('is 404 when the page has no Reader content', async () => {
    const { app, core } = harness.mod();
    const link = await saved('empty');
    core.setLiveReader(async () => undefined);
    const response = await app.request(`/api/links/${link.id}/reader`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
  });

  it('is 404 when no reader is registered', async () => {
    const { app } = harness.mod();
    const link = await saved('unregistered');
    expect((await app.request(`/api/links/${link.id}/reader`)).status).toBe(404);
  });

  it('is 404 for a missing link without reading', async () => {
    const { app, core } = harness.mod();
    const reader = vi.fn(async () => content);
    core.setLiveReader(reader);
    const response = await app.request('/api/links/6f1c1b0e-6f55-4d1c-9a55-1b0f4a3d2e10/reader');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
    expect(reader).not.toHaveBeenCalled();
  });

  it('is 404 for a trashed link without reading', async () => {
    const { app, core } = harness.mod();
    const link = await saved('trashed');
    await core.softDelete(link.id);
    const reader = vi.fn(async () => content);
    core.setLiveReader(reader);
    expect((await app.request(`/api/links/${link.id}/reader`)).status).toBe(404);
    expect(reader).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a uuid', async () => {
    const { app } = harness.mod();
    const response = await app.request('/api/links/not-a-uuid/reader');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
  });

  it('passes the stored source kind, so X posts get no Reader from the live reader', async () => {
    const { app, core } = harness.mod();
    const link = await saved('post', 'twitter');
    const reader = vi.fn(async () => undefined);
    core.setLiveReader(reader);
    expect((await app.request(`/api/links/${link.id}/reader`)).status).toBe(404);
    expect(reader).toHaveBeenCalledWith(
      expect.objectContaining({ id: link.id, sourceKind: 'twitter' }),
      expect.any(AbortSignal),
    );
  });
  function refresh(id: string) {
    return harness.mod().app.request(`/api/links/${id}/reader/refresh`, {
      method: 'POST',
      headers: { 'x-silo-csrf': '1' },
    });
  }
  it('serves current stored HTML without calling the live port; detail omits payload', async () => {
    const { core, app } = harness.mod();
    const link = await saved('stored');
    await core.recordReader(link.id, { status: 'reader', reader: content }, new Date());
    const live = vi.fn(async () => undefined);
    core.setLiveReader(live);
    const response = await app.request(`/api/links/${link.id}/reader`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...content, capturedAt: expect.any(String) });
    expect(live).not.toHaveBeenCalled();
    const detail = (await (await app.request(`/api/links/${link.id}`)).json()) as {
      link: Record<string, unknown>;
    };
    expect(detail.link).not.toHaveProperty('contentHtml');
    expect(detail.link).not.toHaveProperty('contentImages');
  });
  it('falls back to live for stale stored HTML', async () => {
    const {
      core,
      app,
      database: { db, links },
    } = harness.mod();
    const link = await saved('stale');
    await core.recordReader(link.id, { status: 'reader', reader: content }, new Date());
    await db.update(links).set({ readerVersion: 0 }).where(eq(links.id, link.id));
    const live = vi.fn(async () => content);
    core.setLiveReader(live);
    expect(await (await app.request(`/api/links/${link.id}/reader`)).json()).toEqual({
      ...content,
      capturedAt: null,
    });
    expect(live).toHaveBeenCalledOnce();
  });
  it('refreshes with 200 and coalesces concurrent requests into one extraction', async () => {
    const { core } = harness.mod();
    const link = await saved('refresh');
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await ready;
      return { status: 'reader' as const, reader: content, text: 'New searchable text' };
    });
    core.setReaderRefresher(run);
    const requests = [refresh(link.id), refresh(link.id), refresh(link.id)];
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    release?.();
    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ...content, capturedAt: expect.any(String) });
    }
    expect(run).toHaveBeenCalledOnce();
    expect(await core.getById(link.id)).toMatchObject({
      extractedText: 'New searchable text',
      tags: ['reader'],
    });
  });
  it('returns 422 for no Reader and keeps a previously stored current Reader', async () => {
    const { core } = harness.mod();
    const link = await saved('empty-refresh');
    await core.recordReader(link.id, { status: 'reader', reader: content }, new Date());
    const before = await core.getStoredReader(link.id);
    core.setReaderRefresher(async () => ({ status: 'no_reader' }));
    const response = await refresh(link.id);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'no_reader' });
    expect(await core.getStoredReader(link.id)).toEqual(before);
  });
  it('returns 502 on fetch failure and preserves the old Reader including timestamp', async () => {
    const { core } = harness.mod();
    const link = await saved('failed-refresh');
    await core.recordReader(link.id, { status: 'reader', reader: content }, new Date());
    const before = await core.getStoredReader(link.id);
    core.setReaderRefresher(async () => ({ status: 'fetch_failed' }));
    const response = await refresh(link.id);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'fetch_failed' });
    expect(await core.getStoredReader(link.id)).toEqual(before);
  });
  it('returns 404 for missing and trashed links and 422 for Twitter without extraction', async () => {
    const { core } = harness.mod();
    const gone = await saved('trashed-refresh');
    await core.softDelete(gone.id);
    const tweet = await saved('twitter-refresh', 'twitter');
    const run = vi.fn(async () => ({ status: 'fetch_failed' as const }));
    core.setReaderRefresher(run);
    expect((await refresh('6f1c1b0e-6f55-4d1c-9a55-1b0f4a3d2e10')).status).toBe(404);
    expect((await refresh(gone.id)).status).toBe(404);
    expect((await refresh(tweet.id)).status).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });
  it('returns 503 when the worker refresher is not registered', async () => {
    const link = await saved('no-worker');
    const response = await refresh(link.id);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'refresh_unavailable',
      message: 'Reader refresh needs the worker running in this process.',
    });
  });
  it('requires the CSRF header for a cookie-authenticated refresh', async () => {
    const { app } = harness.mod();
    const link = await saved('csrf');
    vi.stubEnv('SILO_APP_PASSWORD', 'reader-test-password');
    try {
      const login = await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-silo-csrf': '1' },
        body: JSON.stringify({ password: 'reader-test-password' }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      expect(
        (
          await app.request(`/api/links/${link.id}/reader/refresh`, {
            method: 'POST',
            headers: { Cookie: cookie },
          })
        ).status,
      ).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
