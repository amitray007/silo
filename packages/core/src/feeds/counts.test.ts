import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('feed grouped counts (Postgres)', () => {
  const h = setupPgHarness('silo_feed_counts', () => import('../index.js'));
  it('matches both old counts including empty, all-deleted and archived feeds across pages', async () => {
    await h.rawDb().execute(sql`
      insert into feeds(id, feed_url, title, custom_title, format, next_poll_at, created_at)
      select md5('countsfeed' || n)::uuid, 'https://feed.example/' || n, 'Feed ' || n,
        case when n = 1 then 'Custom title' end, 'rss', now(), '2026-01-01'
      from generate_series(1,4) n;
      insert into links(url, canonical_url, feed_id, archived_at, deleted_at, source_kind)
      select 'https://post.example/' || n, 'https://post.example/' || n,
        md5('countsfeed' || case when n < 4 then 1 else 2 end)::uuid,
        case when n = 2 then now() end, case when n >= 3 then now() end, 'link'
      from generate_series(1,6) n;
    `);
    const expected = await h
      .rawDb()
      .execute<{ id: string; inboxCount: number; postCount: number }>(sql`
      select feeds.id,
        (select count(*)::int from links where feed_id = feeds.id and deleted_at is null and archived_at is null) as "inboxCount",
        (select count(*)::int from links where feed_id = feeds.id and deleted_at is null) as "postCount"
      from feeds order by created_at, id
    `);
    const { pool } = await import('@silo/db');
    const spy = vi.spyOn(pool, 'query');
    const listed = await h.mod().listFeeds();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(listed.map(({ id, inboxCount, postCount }) => ({ id, inboxCount, postCount }))).toEqual(
      expected.rows,
    );
    expect(listed.filter((row) => row.postCount === 0)).toHaveLength(3);
    expect(listed.find((row) => row.title === 'Custom title')).toMatchObject({
      inboxCount: 1,
      postCount: 2,
    });
    let cursor: string | undefined;
    const paged = [];
    do {
      const page = await h.mod().listFeedsPage({ limit: 1, ...(cursor ? { cursor } : {}) });
      paged.push(...page.feeds);
      cursor = page.nextCursor;
    } while (cursor);
    expect(paged).toEqual(listed);
    for (const feed of listed) expect(await h.mod().getFeed(feed.id)).toEqual(feed);
  });
});
