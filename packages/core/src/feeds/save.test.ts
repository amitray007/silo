import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_feed_save', () => import('../index.js'));
afterEach(async () => {
  h.mod().setFeedResolver(undefined);
  h.mod().resetEnrichmentEnqueuer();
  await h.rawDb().execute(sql`delete from feeds`);
});
async function post(url = `https://example.com/${randomUUID()}`) {
  const core = h.mod();
  core.setFeedResolver(async () => ({
    feedUrl: `https://example.com/${randomUUID()}.rss`,
    siteUrl: 'https://example.com',
    title: 'Publisher',
    format: 'rss',
    entries: [{ url, title: 'Post title' }],
    intervalSeconds: 3600,
  }));
  const result = await core.subscribeFeed({ url: 'https://example.com', syncRecents: true });
  if ('error' in result) throw new Error(result.error);
  const [row] = (await core.listFeedPosts(result.feed.id)).links;
  if (!row) throw new Error('missing post');
  return row;
}
function savedId(result: Awaited<ReturnType<ReturnType<typeof h.mod>['saveFeedPost']>>) {
  if ('error' in result) throw new Error(result.error);
  return result.id;
}

describe('Save to Home on real Postgres', () => {
  it('copies captured fields and Reader provenance without fetching or enqueueing a finished post', async () => {
    const core = h.mod();
    const row = await post();
    await h.rawDb().execute(sql`update links set title_source = 'user', description = 'Description',
      image_url = 'https://example.com/image.jpg', site_name = 'Publisher', extracted_text = 'Reader text',
      content_html = '<p>Reader text</p>', content_images = '["https://example.com/image.jpg"]',
      reader_version = 4, reader_captured_at = '2026-10-29', reader_render_pending = false,
      source_kind = 'link', source_data = '{"kind":"link"}', capture_status = 'full'
      where id = ${row.id}`);
    const enqueue = vi.fn(async () => {});
    core.setEnrichmentEnqueuer(enqueue);
    const result = await core.saveFeedPost(row.feedId ?? '', row.id);
    expect(result).toMatchObject({ outcome: 'created' });
    const id = savedId(result);
    const original = (await h.rawDb().execute(sql`select * from links where id = ${row.id}`))
      .rows[0];
    const saved = (await h.rawDb().execute(sql`select * from links where id = ${id}`)).rows[0];
    for (const field of [
      'url',
      'canonical_url',
      'title',
      'title_source',
      'description',
      'image_url',
      'site_name',
      'extracted_text',
      'content_html',
      'content_images',
      'reader_version',
      'reader_captured_at',
      'reader_render_pending',
      'source_kind',
      'source_data',
      'capture_status',
    ]) {
      expect(saved?.[field], field).toEqual(original?.[field]);
    }
    expect(saved).toMatchObject({
      feed_id: null,
      source: 'web',
      added_by: 'user',
      archived_at: null,
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(await core.getById(row.id)).toMatchObject({ savedLinkId: id });
    expect((await core.listFeedPosts(row.feedId ?? '')).links[0]).toMatchObject({
      savedLinkId: id,
    });
    expect((await core.list()).links.map((link) => link.id)).toEqual([id]);
    await core.editLink(id, { notes: 'My note' });
    await core.addTag(id, 'saved');
    expect(await core.getById(id)).toMatchObject({ notes: 'My note', tags: ['saved'] });
    await core.deleteFeed(row.feedId ?? '');
    expect(await core.getById(id)).toMatchObject({ id });
  });
  it('links to existing canonical Home content without overwriting or enqueueing it', async () => {
    const core = h.mod();
    const pond = await core.createLink({
      url: 'https://example.com/existing',
      title: 'Owner title',
      sourceKind: 'link',
      notes: 'Keep',
    });
    const row = await post('https://example.com/existing?utm_source=feed');
    const enqueue = vi.fn(async () => {});
    core.setEnrichmentEnqueuer(enqueue);
    expect(await core.saveFeedPost(row.feedId ?? '', row.id)).toEqual({
      id: pond.id,
      outcome: 'existing',
    });
    expect(await core.getById(pond.id)).toMatchObject({ title: 'Owner title', notes: 'Keep' });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('revives the trashed Home copy and makes saved state live-only', async () => {
    const core = h.mod();
    const row = await post();
    await h.rawDb().execute(sql`update links set capture_status = 'full' where id = ${row.id}`);
    const id = savedId(await core.saveFeedPost(row.feedId ?? '', row.id));
    await core.softDelete(id);
    expect(await core.getById(row.id)).toMatchObject({ savedLinkId: null });
    expect((await core.listFeedPosts(row.feedId ?? '')).links[0]).toMatchObject({
      savedLinkId: null,
    });
    expect(await core.saveFeedPost(row.feedId ?? '', row.id)).toEqual({ id, outcome: 'revived' });
    expect(await core.getById(row.id)).toMatchObject({ savedLinkId: id });
    expect(await core.getById(id)).toMatchObject({ captureStatus: 'full' });
  });
  it('keeps an owner-renamed title when a feed post revives the Home link', async () => {
    const core = h.mod();
    const row = await post();
    const pond = await core.createLink({ url: row.url, sourceKind: 'link' });
    await core.editLink(pond.id, { title: 'My custom title' });
    await core.softDelete(pond.id);
    await h.rawDb().execute(sql`update links set capture_status = 'full' where id = ${row.id}`);
    const enqueue = vi.fn(async () => {});
    core.setEnrichmentEnqueuer(enqueue);
    expect(await core.saveFeedPost(row.feedId ?? '', row.id)).toEqual({
      id: pond.id,
      outcome: 'revived',
    });
    expect(await core.getById(pond.id)).toMatchObject({
      title: 'My custom title',
      titleSource: 'user',
      captureStatus: 'full',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it.each(['bare', 'partial'] as const)(
    'keeps full Home content when a %s feed post revives it',
    async (status) => {
      const core = h.mod();
      const row = await post();
      const pond = await core.createLink({ url: row.url, sourceKind: 'link' });
      await h.rawDb().execute(sql`update links set capture_status = 'full',
        title = 'Original title', title_source = 'page', description = 'Description',
        image_url = 'https://example.com/cover.jpg', site_name = 'Original site',
        extracted_text = 'Full text', content_html = '<p>Full text</p>',
        content_images = '[]', reader_version = 5, reader_captured_at = '2026-10-29T00:00:00Z'
        where id = ${pond.id}`);
      await core.softDelete(pond.id);
      await h.rawDb().execute(sql`update links set capture_status = ${status}, title = null
        where id = ${row.id}`);
      const enqueue = vi.fn(async () => {});
      core.setEnrichmentEnqueuer(enqueue);
      expect(await core.saveFeedPost(row.feedId ?? '', row.id)).toEqual({
        id: pond.id,
        outcome: 'revived',
      });
      expect(await core.getById(pond.id)).toMatchObject({
        title: 'Original title',
        titleSource: 'page',
        description: 'Description',
        imageUrl: 'https://example.com/cover.jpg',
        siteName: 'Original site',
        extractedText: 'Full text',
        captureStatus: 'full',
      });
      const stored = await h.rawDb().execute(sql`select content_html, reader_version,
        reader_captured_at from links where id = ${pond.id}`);
      expect(stored.rows[0]).toMatchObject({
        content_html: '<p>Full text</p>',
        reader_version: 5,
      });
      expect(new Date(String(stored.rows[0]?.reader_captured_at)).toISOString()).toBe(
        '2026-10-29T00:00:00.000Z',
      );
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
  it('enqueues a revived incomplete merge with its preserved status', async () => {
    const core = h.mod();
    const row = await post();
    const pond = await core.createLink({ url: row.url, sourceKind: 'link' });
    await h.rawDb().execute(sql`update links set capture_status = 'partial',
      extracted_text = 'Existing text' where id = ${pond.id}`);
    await core.softDelete(pond.id);
    await h.rawDb().execute(sql`update links set capture_status = 'bare' where id = ${row.id}`);
    const enqueue = vi.fn(async () => {});
    core.setEnrichmentEnqueuer(enqueue);
    await core.saveFeedPost(row.feedId ?? '', row.id);
    expect(await core.getById(pond.id)).toMatchObject({
      captureStatus: 'partial',
      extractedText: 'Existing text',
      titleSource: 'page',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), pond.id, {
      trigger: 'capture',
      previousStatus: 'partial',
    });
  });
  it('enqueues only a new or revived enriching copy, and repeated/concurrent saves are idempotent', async () => {
    const core = h.mod();
    const row = await post();
    const enqueue = vi.fn(async () => {});
    core.setEnrichmentEnqueuer(enqueue);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => core.saveFeedPost(row.feedId ?? '', row.id)),
    );
    const id = savedId(results[0] ?? { error: 'not_found' });
    expect(
      results.filter((result) => 'outcome' in result && result.outcome === 'created'),
    ).toHaveLength(1);
    expect(new Set(results.map(savedId))).toEqual(new Set([id]));
    expect(await core.saveFeedPost(row.feedId ?? '', row.id)).toEqual({ id, outcome: 'existing' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    await core.softDelete(id);
    expect(await core.saveFeedPost(row.feedId ?? '', row.id)).toEqual({ id, outcome: 'revived' });
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
  it('arbitrates concurrent copies from different feeds using the pond unique index', async () => {
    const core = h.mod();
    const url = `https://example.com/${randomUUID()}`;
    const a = await post(url);
    const b = await post(url);
    const results = await Promise.all([
      core.saveFeedPost(a.feedId ?? '', a.id),
      core.saveFeedPost(b.feedId ?? '', b.id),
    ]);
    expect(new Set(results.map(savedId)).size).toBe(1);
    expect(results.map((result) => 'outcome' in result && result.outcome).sort()).toEqual([
      'created',
      'existing',
    ]);
    expect((await core.list()).links).toHaveLength(1);
    await core.softDelete(savedId(results[0] ?? { error: 'not_found' }));
    const revived = await Promise.all([
      core.saveFeedPost(a.feedId ?? '', a.id),
      core.saveFeedPost(b.feedId ?? '', b.id),
    ]);
    expect(new Set(revived.map(savedId)).size).toBe(1);
    expect(revived.map((result) => 'outcome' in result && result.outcome).sort()).toEqual([
      'existing',
      'revived',
    ]);
  });
  it.each([false, true])(
    'shares the canonical slot when capture wins first: %s',
    async (captureFirst) => {
      const core = h.mod();
      const row = await post();
      let release = () => {};
      let inserted = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        inserted = resolve;
      });
      let first = true;
      core.setEnrichmentEnqueuer(async () => {
        if (!first) return;
        first = false;
        inserted();
        await held;
      });
      const save = () => core.saveFeedPost(row.feedId ?? '', row.id);
      const capture = () => core.createLink({ url: row.url, sourceKind: 'link' });
      const firstWrite = captureFirst ? capture() : save();
      await ready;
      const secondWrite = captureFirst ? save() : capture();
      try {
        // The second writer cannot see the uncommitted row; its INSERT waits on the index.
        await vi.waitFor(async () => {
          const waiting = await h
            .rawDb()
            .execute(sql`select count(*)::integer as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query like 'insert into "links"%'`);
          expect(waiting.rows[0]?.count).toBeGreaterThan(0);
        });
      } finally {
        release();
      }
      const [a, b] = await Promise.all([firstWrite, secondWrite]);
      if (!('id' in a) || !('id' in b)) throw new Error('save failed');
      expect(a.id).toBe(b.id);
      expect((await core.list()).links).toHaveLength(1);
      expect(await core.getById(row.id)).toMatchObject({ savedLinkId: a.id });
    },
  );
  it.each(['partial', 'bare'] as const)('does not enqueue a %s copy', async (status) => {
    const row = await post();
    await h.rawDb().execute(sql`update links set capture_status = ${status} where id = ${row.id}`);
    const enqueue = vi.fn(async () => {});
    h.mod().setEnrichmentEnqueuer(enqueue);
    const id = savedId(await h.mod().saveFeedPost(row.feedId ?? '', row.id));
    expect(await h.mod().getById(id)).toMatchObject({ captureStatus: status });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rolls back the copy and saved pointer when enqueue fails', async () => {
    const row = await post();
    h.mod().setEnrichmentEnqueuer(async () => {
      throw new Error('queue unavailable');
    });
    await expect(h.mod().saveFeedPost(row.feedId ?? '', row.id)).rejects.toThrow(
      'queue unavailable',
    );
    expect((await h.mod().list()).links).toEqual([]);
    expect(await h.mod().getById(row.id)).toMatchObject({ savedLinkId: null });
  });
  it('returns typed errors for a missing post, pond link and wrong feed', async () => {
    const core = h.mod();
    const row = await post();
    const pond = await core.createLink({ url: 'https://example.com/pond', sourceKind: 'link' });
    expect(await core.saveFeedPost(row.feedId ?? '', randomUUID())).toEqual({ error: 'not_found' });
    expect(await core.saveFeedPost(row.feedId ?? '', pond.id)).toEqual({ error: 'not_feed_post' });
    expect(await core.saveFeedPost(randomUUID(), row.id)).toEqual({ error: 'not_found' });
  });
});
