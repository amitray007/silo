import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_api_feed_writes', async () => ({
  core: await import('@silo/core'),
  pool: (await import('@silo/db')).pool,
  app: (await import('../app.js')).createApp(),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  h.mod().core.setFeedResolver(undefined);
  h.mod().core.setReaderRefresher(undefined);
  h.mod().core.resetEnrichmentEnqueuer();
});

async function seedPost(trashed = false) {
  const { pool } = h.mod();
  const id = randomUUID();
  const feed = await pool.query(
    "insert into feeds (feed_url,title,format,next_poll_at) values ($1,'Publisher','rss',now()) returning id",
    [`https://example.com/${id}/feed`],
  );
  await pool.query(
    "insert into links (id,url,canonical_url,title,notes,source_kind,source,feed_id,deleted_at) values ($1,$2,$2,'Original','Original note','link','feed',$3,$4)",
    [id, `https://example.com/${id}`, feed.rows[0].id, trashed ? new Date() : null],
  );
  const tag = await pool.query(
    'insert into tags (name,normalized_key) values ($1,$1) returning id',
    [id],
  );
  await pool.query('insert into link_tags (link_id,tag_id) values ($1,$2)', [id, tag.rows[0].id]);
  return { id, tag: id, feedId: feed.rows[0].id as string };
}
async function state(id: string) {
  const { pool } = h.mod();
  return {
    row: (await pool.query('select * from links where id = $1', [id])).rows,
    tags: (await pool.query('select * from link_tags where link_id = $1', [id])).rows,
  };
}

describe('feed posts reject library API writes', () => {
  it('archives and unarchives through the feed scope, validates tabs and updates Inbox counts', async () => {
    const { app, core } = h.mod();
    const { id, feedId } = await seedPost();
    const base = `/api/feeds/${feedId}`;
    expect((await app.request(`${base}/posts?tab=trash`)).status).toBe(400);
    expect((await app.request(`${base}/posts/invalid/archive`, { method: 'POST' })).status).toBe(
      400,
    );
    const archived = await app.request(`${base}/posts/${id}/archive`, { method: 'POST' });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ id, archivedAt: expect.any(String) });
    expect(await (await app.request(`${base}/posts`)).json()).toMatchObject({ links: [] });
    expect(await (await app.request(`${base}/posts?tab=archive`)).json()).toMatchObject({
      links: [expect.objectContaining({ id, archivedAt: expect.any(String) })],
    });
    expect(await (await app.request(base)).json()).toMatchObject({
      feed: { inboxCount: 0, postCount: 1 },
    });
    expect(
      await (await app.request(`${base}/posts/${id}/unarchive`, { method: 'POST' })).json(),
    ).toEqual({ id, archivedAt: null });
    expect(await (await app.request(`${base}/posts`)).json()).toMatchObject({
      links: [expect.objectContaining({ id, archivedAt: null })],
    });
    const feeds = (await (await app.request('/api/feeds')).json()) as {
      feeds: { id: string; inboxCount: number }[];
    };
    expect(feeds.feeds.find((row) => row.id === feedId)?.inboxCount).toBe(1);
    const pond = await core.createLink({
      url: `https://example.com/${randomUUID()}`,
      sourceKind: 'link',
    });
    for (const action of ['archive', 'unarchive']) {
      expect(
        (await app.request(`${base}/posts/${pond.id}/${action}`, { method: 'POST' })).status,
      ).toBe(409);
      expect(
        (await app.request(`${base}/posts/${randomUUID()}/${action}`, { method: 'POST' })).status,
      ).toBe(404);
      expect(
        (await app.request(`/api/feeds/${randomUUID()}/posts/${id}/${action}`, { method: 'POST' }))
          .status,
      ).toBe(404);
    }
    expect((await state(pond.id)).row[0]).toMatchObject({ archived_at: null });
    await h.mod().pool.query('delete from links where id = $1', [pond.id]);
  });
  it.each([
    ['POST', 'tags', { tag: 'Forbidden' }, false],
    ['DELETE', 'tags/:tag', undefined, false],
    ['PATCH', '', { title: 'Changed', note: 'Changed' }, false],
    ['PATCH', '', {}, false],
    ['DELETE', '', undefined, false],
    ['POST', 'trash', undefined, false],
    ['POST', 'restore', undefined, true],
    ['DELETE', 'hard-delete', undefined, true],
  ] as const)(
    '%s %s returns feed_post_not_editable with an unchanged row',
    async (method, suffix, body, trashed) => {
      const { id, tag } = await seedPost(trashed);
      const before = await state(id);
      const path =
        suffix === 'hard-delete'
          ? `/api/trash/${id}`
          : `/api/links/${id}${suffix ? `/${suffix.replace(':tag', tag)}` : ''}`;
      const result = await h.mod().app.request(path, {
        method,
        ...(body
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({
        error: 'feed_post_not_editable',
        message: expect.any(String),
      });
      expect(await state(id)).toEqual(before);
    },
  );
  it.each(['link', 'feed_media'])(
    'allows Reader refresh and retry for a %s feed post',
    async (kind) => {
      const { app, core, pool } = h.mod();
      const { id, feedId } = await seedPost();
      if (kind === 'feed_media') {
        await pool.query('update links set source_kind = $2, source_data = $3 where id = $1', [
          id,
          kind,
          { kind, content: '<p>Publisher show notes.</p>' },
        ]);
      }
      const reader = { contentHtml: '<p>Refreshed feed content.</p>', contentImages: [] };
      const extract = vi.fn(async () => ({
        status: 'reader' as const,
        reader,
        text: 'Refreshed feed content.',
      }));
      core.setReaderRefresher(extract);
      const response = await app.request(`/api/links/${id}/reader/refresh`, { method: 'POST' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ...reader, capturedAt: expect.any(String) });
      expect(await core.getStoredReader(id)).toMatchObject(reader);
      expect(extract).toHaveBeenCalledWith(
        expect.objectContaining({ id, sourceKind: kind }),
        expect.any(AbortSignal),
      );
      const enqueue = vi.fn(async () => {});
      core.setEnrichmentEnqueuer(enqueue);
      const retry = await app.request(`/api/links/${id}/retry`, { method: 'POST' });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        link: { id, feedId, captureStatus: 'enriching' },
      });
      expect(enqueue).toHaveBeenCalledOnce();
      expect(await core.getById(id)).toMatchObject({
        feedId,
        sourceKind: kind,
        title: 'Original',
        notes: 'Original note',
        tags: [id],
      });
    },
  );
  it('includes membership on detail and pond reads', async () => {
    const { id, feedId } = await seedPost();
    expect(await (await h.mod().app.request(`/api/links/${id}`)).json()).toMatchObject({
      link: { feedId },
    });
    const pond = await h
      .mod()
      .core.createLink({ url: `https://example.com/${randomUUID()}`, sourceKind: 'link' });
    expect(await (await h.mod().app.request(`/api/links/${pond.id}`)).json()).toMatchObject({
      link: { feedId: null },
    });
    expect(await (await h.mod().app.request('/api/links')).json()).toMatchObject({
      links: [expect.objectContaining({ id: pond.id, feedId: null })],
    });
  });
  it.each(['/api/links', '/api/links/batch/capture', '/api/ingest'])(
    'rejects reserved feed source at %s without creating a row',
    async (path) => {
      vi.stubEnv('SILO_API_TOKEN', 'test-ingest-token');
      const url = `https://example.com/${randomUUID()}`;
      const input = { url, source: 'feed' };
      const result = await h.mod().app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-ingest-token',
        },
        body: JSON.stringify(
          path.endsWith('/batch/capture') ? { urls: [url], source: 'feed' } : input,
        ),
      });
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ error: 'validation_error' });
      expect((await h.mod().pool.query('select id from links where url = $1', [url])).rows).toEqual(
        [],
      );
    },
  );
  it('maps a resolver throw to feeds_unavailable without exposing details', async () => {
    h.mod().core.setFeedResolver(async () => {
      throw new Error('private diagnostic');
    });
    const result = await h.mod().app.request('/api/feeds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', syncRecents: true }),
    });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: 'feeds_unavailable',
      message: 'Feeds are unavailable. Try again later.',
    });
  });
});
