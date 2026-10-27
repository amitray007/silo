import { postgresReachable } from '@silo/db/test-support/disposable-database';
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
    return { core, app: createApp() };
  });
  afterEach(() => harness.mod().core.setLiveReader(undefined));

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
    expect(await response.json()).toEqual(content);
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
});
