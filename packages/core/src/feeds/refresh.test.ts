import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../links/executor.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_feed_refresh', () => import('../index.js'));
afterEach(async () => {
  h.mod().setFeedResolver(undefined);
  h.mod().setFeedPollEnqueuer(undefined);
  await h.rawDb().execute(sql`delete from feeds`);
});
async function feed() {
  h.mod().setFeedResolver(async () => ({
    feedUrl: `https://example.com/${randomUUID()}.rss`,
    siteUrl: 'https://example.com',
    title: 'Publisher',
    format: 'rss',
    entries: [],
    intervalSeconds: 3600,
  }));
  const result = await h.mod().subscribeFeed({ url: 'https://example.com', syncRecents: false });
  if ('error' in result) throw new Error(result.error);
  return result.feed.id;
}

describe('manual feed refresh on real Postgres', () => {
  it('returns missing before unavailable, and leaves a feed unchanged without an enqueuer', async () => {
    const id = await feed();
    await h
      .rawDb()
      .execute(
        sql`update feeds set status = 'gone', next_poll_at = '2100-01-01', consecutive_failures = 10 where id = ${id}`,
      );
    expect(await h.mod().refreshFeed(randomUUID())).toEqual({ error: 'not_found' });
    expect(await h.mod().refreshFeed(id)).toEqual({ error: 'feeds_unavailable' });
    expect(await h.mod().getFeed(id)).toMatchObject({ status: 'gone' });
    expect(await h.mod().listDueFeeds()).not.toContain(id);
  });
  it.each(['active', 'failing', 'gone'] as const)(
    'makes a %s feed due and queues on the transaction',
    async (status) => {
      const id = await feed();
      await h
        .rawDb()
        .execute(
          sql`update feeds set status = ${status}, next_poll_at = '2100-01-01', consecutive_failures = 10 where id = ${id}`,
        );
      const enqueue = vi.fn(async (tx: Tx, feedId: string) => {
        const result = await tx.execute(
          sql`select status, next_poll_at <= clock_timestamp() as due, consecutive_failures from feeds where id = ${feedId}`,
        );
        expect(result.rows[0]).toMatchObject({
          status: status === 'gone' ? 'active' : status,
          due: true,
          consecutive_failures: status === 'gone' ? 0 : 10,
        });
      });
      h.mod().setFeedPollEnqueuer(enqueue);
      expect(await h.mod().refreshFeed(id)).toEqual({ id });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(await h.mod().listDueFeeds()).toContain(id);
    },
  );
  it('rolls back the due time and gone reset when enqueue fails', async () => {
    const id = await feed();
    await h
      .rawDb()
      .execute(sql`update feeds set status = 'gone', next_poll_at = '2100-01-01' where id = ${id}`);
    h.mod().setFeedPollEnqueuer(async () => {
      throw new Error('queue down');
    });
    await expect(h.mod().refreshFeed(id)).rejects.toThrow('queue down');
    expect(await h.mod().getFeed(id)).toMatchObject({ status: 'gone' });
    expect(await h.mod().listDueFeeds()).not.toContain(id);
  });
  it('tries a gone feed again and lets a successful poll clear its error', async () => {
    const id = await feed();
    await h
      .rawDb()
      .execute(
        sql`update feeds set status = 'gone', consecutive_failures = 10, last_error = 'HTTP 410' where id = ${id}`,
      );
    h.mod().setFeedPollEnqueuer(async () => {});
    await h.mod().refreshFeed(id);
    const fetch = vi.fn(async () => ({ kind: 'not-modified' as const }));
    await h.mod().pollFeed(id, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await h.mod().getFeed(id)).toMatchObject({ status: 'active', lastError: null });
    expect(await h.mod().listDueFeeds()).not.toContain(id);
  });
});
