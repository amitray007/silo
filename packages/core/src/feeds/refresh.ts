import { db, feeds } from '@silo/db';
import { eq } from 'drizzle-orm';
import type { Tx } from '../links/executor.js';

export type FeedPollEnqueuer = (tx: Tx, feedId: string) => Promise<void>;
let enqueuer: FeedPollEnqueuer | undefined;

export function setFeedPollEnqueuer(next: FeedPollEnqueuer | undefined): void {
  enqueuer = next;
}

/** The due time and queue insert commit together. An explicit retry revives a gone feed. */
export async function refreshFeed(
  id: string,
): Promise<{ id: string } | { error: 'not_found' | 'feeds_unavailable' }> {
  return db.transaction(async (tx) => {
    const [feed] = await tx.select().from(feeds).where(eq(feeds.id, id)).for('update');
    if (!feed) return { error: 'not_found' };
    const enqueue = enqueuer;
    if (!enqueue) return { error: 'feeds_unavailable' };
    await tx
      .update(feeds)
      .set({
        nextPollAt: new Date(),
        ...(feed.status === 'gone' ? { status: 'active' as const, consecutiveFailures: 0 } : {}),
      })
      .where(eq(feeds.id, id));
    await enqueue(tx, id);
    return { id };
  });
}
