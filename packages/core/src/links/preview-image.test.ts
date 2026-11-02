import { randomUUID } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('preview image fields (Postgres)', () => {
  const h = setupPgHarness('silo_image_fields', () => import('./preview-image.js'));
  it('reads just image fields in one query and keeps missing, trash and feed visibility', async () => {
    await h.rawDb().execute(sql`
      insert into feeds(id, feed_url, title, format, next_poll_at) values
        (md5('imagefeed')::uuid, 'https://feed.example/rss', 'Feed', 'rss', now());
      insert into links(id, url, canonical_url, image_url, source_data, extracted_text, feed_id, deleted_at, source_kind)
      select md5('image' || n)::uuid, 'https://image.example/' || n, 'https://image.example/' || n,
        case when n = 1 then 'https://cdn.example/image.jpg' end,
        '{"kind":"youtube","thumbnailUrl":"https://cdn.example/thumb.jpg","other":"unused"}',
        repeat('large text',10000), case when n = 2 then md5('imagefeed')::uuid end,
        case when n = 3 then now() end, 'link' from generate_series(1,3) n;
    `);
    const { pool } = await import('@silo/db');
    const ids = await h
      .rawDb()
      .execute<{ id: string }>(sql`select id from links where deleted_at is null order by url`);
    for (const { id } of ids.rows) {
      const spy = vi.spyOn(pool, 'query');
      const fields = await h.mod().getPreviewImageFields(id);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
      expect(fields).toEqual({
        imageUrl: id === ids.rows[0]?.id ? 'https://cdn.example/image.jpg' : null,
        thumbnailUrl: 'https://cdn.example/thumb.jpg',
      });
    }
    const trash = await h
      .rawDb()
      .execute<{ id: string }>(sql`select id from links where deleted_at is not null`);
    expect(await h.mod().getPreviewImageFields(trash.rows[0]?.id ?? randomUUID())).toBeNull();
    expect(await h.mod().getPreviewImageFields(randomUUID())).toBeNull();
  });
});
