import { db, feedEntries, feeds, links } from '@silo/db';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { canonicalize } from '../links/canonicalize.js';
import type { Tx } from '../links/executor.js';
import { createFeedPost } from '../links/links.js';
import { whereFeed } from '../links/live.js';
import {
  decodeListCursor,
  effectiveLimit,
  encodeListCursor,
  hydrateTags,
  listColumns,
  type PageParams,
} from '../links/pagination.js';
import {
  type FeedEntry,
  type FeedPollResult,
  getFeedResolver,
  type ResolvedFeed,
} from './types.js';

export type FeedRow = typeof feeds.$inferSelect;
const feedColumns = {
  id: feeds.id,
  title: feeds.title,
  feedUrl: feeds.feedUrl,
  siteUrl: feeds.siteUrl,
  format: feeds.format,
  status: feeds.status,
  lastError: feeds.lastError,
  createdAt: feeds.createdAt,
  postCount: sql<number>`(select count(*)::integer from links as posts where posts.feed_id = feeds.id and posts.deleted_at is null)`,
};
export type Feed = Pick<
  FeedRow,
  'id' | 'title' | 'feedUrl' | 'siteUrl' | 'format' | 'status' | 'lastError' | 'createdAt'
> & { postCount: number };

export function listFeeds(): Promise<Feed[]> {
  return db.select(feedColumns).from(feeds).orderBy(asc(feeds.createdAt), asc(feeds.id));
}
export async function getFeed(id: string): Promise<Feed | null> {
  const [row] = await db.select(feedColumns).from(feeds).where(eq(feeds.id, id));
  return row ?? null;
}
export async function deleteFeed(id: string): Promise<boolean> {
  const rows = await db.delete(feeds).where(eq(feeds.id, id)).returning({ id: feeds.id });
  return rows.length > 0;
}

/** Stable publisher identity wins; only HTTP(S), canonicalizable entry URLs enter the seen-set. */
export function entryIdentity(entry: FeedEntry): string | null {
  if (!entry.url) return null;
  const { canonical, ok } = canonicalize(entry.url);
  if (!ok) return null;
  return entry.id?.trim() || canonical;
}

function newest(entries: FeedEntry[]): FeedEntry[] {
  return [...entries].sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
}

async function captureEntries(
  tx: Tx,
  feedId: string,
  entries: FeedEntry[],
  limit: number,
  markAll: boolean,
): Promise<void> {
  let captured = 0;
  for (const entry of newest(entries)) {
    if (!markAll && captured >= limit) break;
    const key = entryIdentity(entry);
    if (!key) continue;
    const [seen] = await tx
      .insert(feedEntries)
      .values({ feedId, entryKey: key })
      .onConflictDoNothing()
      .returning({ key: feedEntries.entryKey });
    if (!seen || captured >= limit) continue;
    await createFeedPost({ ...entry, feedId }, tx);
    captured++;
  }
}

export type SubscribeFeedResult =
  | { error: 'feeds_unavailable' | 'feed_not_found' }
  | { feed: Feed; deduped: boolean };

export async function subscribeFeed(input: {
  url: string;
  syncRecents: boolean;
}): Promise<SubscribeFeedResult> {
  const resolver = getFeedResolver();
  if (!resolver) return { error: 'feeds_unavailable' };
  const resolved = await resolver(input.url);
  if (!resolved) return { error: 'feed_not_found' };
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(feeds)
      .values({
        feedUrl: resolved.feedUrl,
        siteUrl: resolved.siteUrl,
        title: resolved.title,
        description: resolved.description,
        format: resolved.format,
        etag: resolved.etag,
        lastModified: resolved.lastModified,
        pollIntervalSeconds: resolved.intervalSeconds,
        nextPollAt: new Date(Date.now() + resolved.intervalSeconds * 1000),
        lastPolledAt: new Date(),
        lastSuccessAt: new Date(),
      })
      .onConflictDoNothing({ target: feeds.feedUrl })
      .returning();
    if (inserted) {
      await captureEntries(tx, inserted.id, resolved.entries, input.syncRecents ? 20 : 0, true);
      return { id: inserted.id, deduped: false };
    }
    const [existing] = await tx
      .select({ id: feeds.id })
      .from(feeds)
      .where(eq(feeds.feedUrl, resolved.feedUrl));
    if (!existing) throw new Error('subscribeFeed: concurrent feed disappeared');
    return { id: existing.id, deduped: true };
  });
  const feed = await getFeed(result.id);
  if (!feed) throw new Error('subscribeFeed: feed disappeared');
  return { feed, deduped: result.deduped };
}

export async function listFeedPosts(feedId: string, page: PageParams = {}) {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor ? decodeListCursor(page.cursor) : undefined;
  const date = sql`coalesce(${links.publishedAt}, ${links.createdAt})`;
  const after = cursor
    ? sql`(${date}, ${links.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : undefined;
  const rows = await db
    .select({ link: listColumns, sortDate: sql<string>`${date}::text` })
    .from(links)
    .where(whereFeed(feedId, after))
    .orderBy(desc(date), desc(links.id))
    .limit(limit + 1);
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  const hydrated = await hydrateTags(
    db,
    visible.map((row) => row.link),
  );
  return {
    links: hydrated,
    ...(rows.length > limit && last
      ? { nextCursor: encodeListCursor(last.sortDate, last.link.id) }
      : {}),
  };
}

export async function listDueFeeds(now = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: feeds.id })
    .from(feeds)
    .where(and(inArray(feeds.status, ['active', 'failing']), lte(feeds.nextPollAt, now)));
  return rows.map((row) => row.id);
}

/** Row lock serializes polls across workers and makes seen keys, captures, and schedule atomic. */
export async function pollFeed(
  id: string,
  fetchFeed: (feed: FeedRow) => Promise<FeedPollResult>,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(feeds).where(eq(feeds.id, id)).for('update');
    if (!row || row.status === 'gone' || row.nextPollAt > now) return;
    const result = await fetchFeed(row);
    if (result.kind === 'failure') {
      const failures = row.consecutiveFailures + 1;
      const delay = Math.min(
        86400,
        Math.max(row.pollIntervalSeconds * 2 ** failures, result.retryAfterSeconds ?? 0),
      );
      await tx
        .update(feeds)
        .set({
          status: result.gone || failures >= 10 ? 'gone' : 'failing',
          consecutiveFailures: failures,
          lastError: result.message,
          lastPolledAt: now,
          nextPollAt: new Date(now.getTime() + delay * 1000),
        })
        .where(eq(feeds.id, id));
      return;
    }
    const interval =
      result.kind === 'modified'
        ? result.feed.intervalSeconds
        : (result.intervalSeconds ?? row.pollIntervalSeconds);
    if (result.kind === 'modified') await captureEntries(tx, id, result.feed.entries, 50, false);
    await tx
      .update(feeds)
      .set({
        ...successfulMetadata(result),
        status: 'active',
        consecutiveFailures: 0,
        lastError: null,
        lastPolledAt: now,
        lastSuccessAt: now,
        pollIntervalSeconds: interval,
        nextPollAt: new Date(now.getTime() + interval * 1000),
      })
      .where(eq(feeds.id, id));
  });
}

function successfulMetadata(result: Exclude<FeedPollResult, { kind: 'failure' }>) {
  if (result.kind === 'not-modified')
    return { etag: result.etag, lastModified: result.lastModified };
  const feed: ResolvedFeed = result.feed;
  return {
    title: feed.title,
    siteUrl: feed.siteUrl,
    feedUrl: feed.feedUrl,
    description: feed.description,
    format: feed.format,
    etag: feed.etag ?? null,
    lastModified: feed.lastModified ?? null,
  };
}
