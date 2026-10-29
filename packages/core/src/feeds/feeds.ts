import { db, feedEntries, feeds, links } from '@silo/db';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
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
  lastPolledAt: feeds.lastPolledAt,
  createdAt: feeds.createdAt,
  inboxCount: sql<number>`(select count(*)::integer from links as posts where posts.feed_id = feeds.id and posts.deleted_at is null and posts.archived_at is null)`,
  postCount: sql<number>`(select count(*)::integer from links as posts where posts.feed_id = feeds.id and posts.deleted_at is null)`,
};
export type Feed = Pick<
  FeedRow,
  | 'id'
  | 'title'
  | 'feedUrl'
  | 'siteUrl'
  | 'format'
  | 'status'
  | 'lastError'
  | 'lastPolledAt'
  | 'createdAt'
> & { postCount: number; inboxCount: number };

export function listFeeds(): Promise<Feed[]> {
  return db.select(feedColumns).from(feeds).orderBy(asc(feeds.createdAt), asc(feeds.id));
}

/** Bounded feed discovery for agents, ordered by subscription time and id. */
export async function listFeedsPage(page: PageParams = {}) {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor ? decodeListCursor(page.cursor) : undefined;
  const rows = await db
    .select({ feed: feedColumns, sortDate: sql<string>`${feeds.createdAt}::text` })
    .from(feeds)
    .where(
      cursor
        ? sql`(${feeds.createdAt}, ${feeds.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(asc(feeds.createdAt), asc(feeds.id))
    .limit(limit + 1);
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    feeds: visible.map((row) => row.feed),
    ...(rows.length > limit && last
      ? { nextCursor: encodeListCursor(last.sortDate, last.feed.id) }
      : {}),
  };
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
  let resolved: ResolvedFeed | null;
  try {
    resolved = await resolver(input.url);
  } catch (error) {
    console.error('[silo/core] subscribe-feed: resolver failed:', error);
    return { error: 'feeds_unavailable' };
  }
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

export async function listFeedPosts(
  feedId: string,
  page: PageParams & { tab?: 'inbox' | 'archive' } = {},
) {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor ? decodeListCursor(page.cursor) : undefined;
  const date = sql`coalesce(${links.publishedAt}, ${links.createdAt})`;
  const after = cursor
    ? sql`(${date}, ${links.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : undefined;
  const rows = await db
    .select({ link: listColumns, sortDate: sql<string>`${date}::text` })
    .from(links)
    .where(
      whereFeed(
        feedId,
        page.tab === 'archive' ? isNotNull(links.archivedAt) : isNull(links.archivedAt),
        after,
      ),
    )
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

/** Fetch without holding a connection; the locked recheck discards stale results. */
export async function pollFeed(
  id: string,
  fetchFeed: (feed: FeedRow) => Promise<FeedPollResult>,
  now = new Date(),
): Promise<void> {
  const [snapshot] = await db.select().from(feeds).where(eq(feeds.id, id));
  if (!snapshot || !isDue(snapshot, now)) return;
  let result: FeedPollResult;
  try {
    result = await fetchFeed(snapshot);
  } catch (error) {
    console.error('[silo/core] poll-feed: fetch failed:', error);
    result = { kind: 'failure', message: 'Could not fetch this feed.' };
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(feeds).where(eq(feeds.id, id)).for('update');
    if (!row || !isDue(row, now) || !samePoll(row, snapshot)) return;
    const captured = await capturePoll(tx, row.id, result);
    if (captured.kind === 'failure') {
      await recordFailure(tx, row, captured, now);
      return;
    }
    const interval =
      captured.kind === 'modified'
        ? captured.feed.intervalSeconds
        : (captured.intervalSeconds ?? row.pollIntervalSeconds);
    const metadata = await pollMetadata(tx, row, captured);
    await tx
      .update(feeds)
      .set({
        ...metadata,
        status: 'active',
        consecutiveFailures: 0,
        lastPolledAt: now,
        lastSuccessAt: now,
        pollIntervalSeconds: interval,
        nextPollAt: new Date(now.getTime() + interval * 1000),
      })
      .where(eq(feeds.id, id));
  });
}

function isDue(row: FeedRow, now: Date): boolean {
  return row.status !== 'gone' && row.nextPollAt <= now;
}
function samePoll(row: FeedRow, snapshot: FeedRow): boolean {
  return (
    row.nextPollAt.getTime() === snapshot.nextPollAt.getTime() &&
    row.updatedAt.getTime() === snapshot.updatedAt.getTime()
  );
}
async function capturePoll(tx: Tx, id: string, result: FeedPollResult): Promise<FeedPollResult> {
  if (result.kind !== 'modified') return result;
  try {
    await tx.transaction((savepoint) =>
      captureEntries(savepoint, id, result.feed.entries, 50, false),
    );
    return result;
  } catch (error) {
    console.error('[silo/core] poll-feed: capture failed:', error);
    return { kind: 'failure', message: 'Could not capture feed posts.' };
  }
}
async function recordFailure(
  tx: Tx,
  row: FeedRow,
  result: Extract<FeedPollResult, { kind: 'failure' }>,
  now: Date,
): Promise<void> {
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
    .where(eq(feeds.id, row.id));
}

const REDIRECT_CONFLICT = 'This feed now redirects to a feed you already follow.';
async function pollMetadata(
  tx: Tx,
  row: FeedRow,
  result: Exclude<FeedPollResult, { kind: 'failure' }>,
) {
  const metadata = successfulMetadata(result);
  if (result.kind !== 'modified' || result.feed.feedUrl === row.feedUrl)
    return { ...metadata, lastError: null };
  const target = result.feed.feedUrl;
  const [existing] = await tx.select({ id: feeds.id }).from(feeds).where(eq(feeds.feedUrl, target));
  if (existing) return { ...metadata, feedUrl: row.feedUrl, lastError: REDIRECT_CONFLICT };
  // A concurrent subscription can claim the URL after the check. Roll back only this update.
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.update(feeds).set({ feedUrl: target }).where(eq(feeds.id, row.id));
    });
  } catch (error) {
    const cause =
      error instanceof Error ? (error.cause as { constraint?: string } | undefined) : undefined;
    if (cause?.constraint !== 'feeds_feed_url_unique') throw error;
    return { ...metadata, feedUrl: row.feedUrl, lastError: REDIRECT_CONFLICT };
  }
  return { ...metadata, lastError: null };
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
