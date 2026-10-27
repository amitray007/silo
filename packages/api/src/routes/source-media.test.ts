import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

vi.mock('../ssrf-safe-image-fetch.js', () => ({
  fetchImageSafely: vi.fn(),
  openStreamSafely: vi.fn(),
}));
const describeIfPg = postgresReachable() ? describe : describe.skip;

const photo = 'https://pbs.twimg.com/media/photo.jpg';
const video = 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/clip.mp4';
const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg';
const avatar = 'https://pbs.twimg.com/profile_images/1/face_200x200.jpg';

describeIfPg('X post media proxy (Postgres)', () => {
  const harness = setupPgHarness('silo_source_media_test', async () => {
    const core = await import('@silo/core');
    const { createApp } = await import('../app.js');
    const fetches = await import('../ssrf-safe-image-fetch.js');
    return {
      core,
      app: createApp(),
      fetchImageSafely: vi.mocked(fetches.fetchImageSafely),
      openStreamSafely: vi.mocked(fetches.openStreamSafely),
    };
  });
  beforeEach(() => {
    harness.mod().fetchImageSafely.mockReset();
    harness.mod().openStreamSafely.mockReset();
  });

  async function post(mediaUrls: string[], slug = 'post') {
    return harness.mod().core.createLink({
      url: `https://x.com/someone/status/${slug.length}${Date.now()}`,
      sourceKind: 'twitter',
      sourceData: {
        kind: 'twitter',
        text: 'A post',
        authorHandle: 'someone',
        authorName: 'Someone',
        likes: 1,
        reposts: 0,
        replies: 0,
        quotes: 0,
        bookmarks: 0,
        mediaUrls,
        thumbnailUrl: poster,
        authorAvatarUrl: avatar,
      },
    });
  }

  it('serves a stored photo, the video poster and the author avatar as images', async () => {
    const { app, fetchImageSafely } = harness.mod();
    fetchImageSafely.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    });
    const link = await post([photo, video]);
    const image = await app.request(`/api/links/${link.id}/source-media/0`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fetchImageSafely).toHaveBeenLastCalledWith(photo);
    await app.request(`/api/links/${link.id}/source-media/poster`);
    expect(fetchImageSafely).toHaveBeenLastCalledWith(poster);
    const face = await app.request(`/api/links/${link.id}/source-media/avatar`);
    expect(face.status).toBe(200);
    expect(fetchImageSafely).toHaveBeenLastCalledWith(avatar);
  });

  it('streams video with the client range and upstream range headers', async () => {
    const { app, openStreamSafely } = harness.mod();
    const close = vi.fn(async () => {});
    const upstream = new Response(new Uint8Array([9, 9]), {
      status: 206,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '2',
        'content-range': 'bytes 0-1/100',
      },
    });
    openStreamSafely.mockResolvedValue({
      ok: true,
      close,
      body: upstream.body,
      response: upstream as never,
    });
    const link = await post([photo, video]);
    const response = await app.request(`/api/links/${link.id}/source-media/1`, {
      headers: { range: 'bytes=0-1' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-1/100');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(openStreamSafely).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ headers: { 'accept-encoding': 'identity', range: 'bytes=0-1' } }),
    );
  });

  it('refuses non-video bodies, other hosts, bad ranges and missing media', async () => {
    const { app, openStreamSafely, fetchImageSafely } = harness.mod();
    const close = vi.fn(async () => {});
    const upstream = new Response('<script>', { headers: { 'content-type': 'text/html' } });
    openStreamSafely.mockResolvedValue({
      ok: true,
      close,
      body: upstream.body,
      response: upstream as never,
    });
    const link = await post([
      video,
      'https://evil.test/a.jpg',
      'http://pbs.twimg.com/b.jpg',
      'https://pbs.twimg.com:8443/c.jpg',
    ]);
    expect((await app.request(`/api/links/${link.id}/source-media/0`)).status).toBe(404);
    expect(close).toHaveBeenCalled();
    const odd = await app.request(`/api/links/${link.id}/source-media/0`, {
      headers: { range: 'items=0-1' },
    });
    expect(odd.status).toBe(404);
    expect(openStreamSafely).toHaveBeenLastCalledWith(
      video,
      expect.objectContaining({ headers: { 'accept-encoding': 'identity' } }),
    );
    for (const index of ['1', '2', '3', '4']) {
      expect((await app.request(`/api/links/${link.id}/source-media/${index}`)).status).toBe(404);
    }
    expect(fetchImageSafely).not.toHaveBeenCalled();
    expect((await app.request(`/api/links/${link.id}/source-media/abc`)).status).toBe(400);
  });

  it('forwards an unsatisfiable range and refuses HEAD for video', async () => {
    const { app, openStreamSafely } = harness.mod();
    const close = vi.fn(async () => {});
    openStreamSafely.mockResolvedValue({
      ok: true,
      close,
      body: null,
      response: new Response(null, {
        status: 416,
        headers: { 'content-range': 'bytes */100' },
      }) as never,
    });
    const link = await post([video]);
    const unsatisfied = await app.request(`/api/links/${link.id}/source-media/0`, {
      headers: { range: 'bytes=500-' },
    });
    expect(unsatisfied.status).toBe(416);
    expect(unsatisfied.headers.get('content-range')).toBe('bytes */100');
    expect(close).toHaveBeenCalled();
    openStreamSafely.mockClear();
    const head = await app.request(`/api/links/${link.id}/source-media/0`, { method: 'HEAD' });
    expect(head.status).toBe(405);
    expect(openStreamSafely).not.toHaveBeenCalled();
  });
});
