import { db, links } from '@silo/db';
import { eq, sql } from 'drizzle-orm';
import { whereFeed } from '../links/live.js';

export type FeedPostTriageResult =
  | { id: string; archivedAt: Date | null }
  | { error: 'not_found' | 'not_feed_post' };

/** Scope the write to its feed. Repeated requests keep the original archive time. */
export async function setFeedPostArchived(
  feedId: string,
  postId: string,
  archived: boolean,
): Promise<FeedPostTriageResult> {
  const [post] = await db
    .update(links)
    .set({ archivedAt: archived ? sql`coalesce(${links.archivedAt}, now())` : null })
    .where(whereFeed(feedId, eq(links.id, postId)))
    .returning({ id: links.id, archivedAt: links.archivedAt });
  if (post) return post;
  const [existing] = await db
    .select({ feedId: links.feedId })
    .from(links)
    .where(eq(links.id, postId));
  return { error: existing?.feedId === null ? 'not_feed_post' : 'not_found' };
}
