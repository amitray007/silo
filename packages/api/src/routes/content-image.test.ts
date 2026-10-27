import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

vi.mock('../ssrf-safe-image-fetch.js', () => ({ fetchImageSafely: vi.fn() }));
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('Reader content-image API (Postgres)', () => {
  const harness = setupPgHarness('silo_reader_api_test', async () => {
    const core = await import('@silo/core');
    const { createApp } = await import('../app.js');
    const { fetchImageSafely } = await import('../ssrf-safe-image-fetch.js');
    return { core, app: createApp(), fetchImageSafely: vi.mocked(fetchImageSafely) };
  });
  beforeEach(() => harness.mod().fetchImageSafely.mockReset());

  const content = {
    contentHtml: '<p>Reader<img src="https://cdn.example.org/photo.png"></p>',
    contentImages: ['https://cdn.example.org/photo.png'],
  };
  const liveReader = vi.fn(async () => content as typeof content | undefined);
  beforeEach(() => {
    liveReader.mockReset();
    liveReader.mockResolvedValue(content);
    harness.mod().core.setLiveReader(liveReader);
  });
  afterEach(() => harness.mod().core.setLiveReader(undefined));

  async function capture(slug: string) {
    const { core } = harness.mod();
    return core.createLink({
      url: `https://example.org/${slug}`,
      sourceKind: 'link',
      tags: ['reader'],
    });
  }

  it('sends no Reader HTML or image data in any link JSON', async () => {
    const { app } = harness.mod();
    const link = await capture('detail');
    for (const path of [
      `/api/links/${link.id}`,
      `/api/links/${link.id}?textOffset=0&textLimit=4`,
      '/api/links',
      '/api/links/search?q=detail',
      `/api/links/${link.id}/related`,
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const payload = JSON.stringify(await response.json());
      expect(payload).not.toContain('contentHtml');
      expect(payload).not.toContain('contentImageCount');
      expect(payload).not.toContain('contentImages');
    }
    expect(liveReader).not.toHaveBeenCalled();
  });

  it('fetches only the live Reader index target and serves raster bytes with nosniff', async () => {
    const { app, fetchImageSafely } = harness.mod();
    const link = await capture('image');
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2]),
      contentType: 'IMAGE/PNG; charset=binary',
    });
    const response = await app.request(
      `/api/links/${link.id}/content-image/0?url=http://localhost/evil`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2]);
    expect(fetchImageSafely).toHaveBeenCalledWith('https://cdn.example.org/photo.png');
    expect(liveReader).toHaveBeenCalledWith(
      { id: link.id, url: 'https://example.org/image', sourceKind: 'link' },
      expect.any(AbortSignal),
    );
  });

  it('is 404 without fetching when the page has no live Reader', async () => {
    const { app, fetchImageSafely } = harness.mod();
    const link = await capture('no-reader');
    liveReader.mockResolvedValue(undefined);
    expect((await app.request(`/api/links/${link.id}/content-image/0`)).status).toBe(404);
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it('is 404 for a link that does not exist', async () => {
    const { app, fetchImageSafely } = harness.mod();
    const response = await app.request(
      '/api/links/6f1c1b0e-6f55-4d1c-9a55-1b0f4a3d2e10/content-image/0',
    );
    expect(response.status).toBe(404);
    expect(liveReader).not.toHaveBeenCalled();
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it('rejects out-of-range, invalid and trashed targets without fetching', async () => {
    const { app, core, fetchImageSafely } = harness.mod();
    const link = await capture('range');
    expect((await app.request(`/api/links/${link.id}/content-image/1`)).status).toBe(404);
    expect((await app.request(`/api/links/${link.id}/content-image/-1`)).status).toBe(400);
    expect((await app.request(`/api/links/${link.id}/content-image/1.5`)).status).toBe(400);
    await core.softDelete(link.id);
    expect((await app.request(`/api/links/${link.id}/content-image/0`)).status).toBe(404);
    expect(fetchImageSafely).not.toHaveBeenCalled();
  });

  it.each(['text/html', 'image/svg+xml', 'application/javascript'])(
    'refuses %s responses',
    async (contentType) => {
      const { app, fetchImageSafely } = harness.mod();
      const link = await capture(`mime-${contentType.replace('/', '-')}`);
      fetchImageSafely.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType });
      expect((await app.request(`/api/links/${link.id}/content-image/0`)).status).toBe(404);
    },
  );

  it('returns 404 when a stored image is unavailable', async () => {
    const { app, fetchImageSafely } = harness.mod();
    const link = await capture('failure');
    fetchImageSafely.mockResolvedValue({ ok: false });
    expect((await app.request(`/api/links/${link.id}/content-image/0`)).status).toBe(404);
  });
});
