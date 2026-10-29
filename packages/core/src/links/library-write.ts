import { db, links } from '@silo/db';
import { eq } from 'drizzle-orm';

export class FeedPostNotEditableError extends Error {
  readonly code = 'feed_post_not_editable';
  constructor() {
    super('feed_post_not_editable: Save this feed post to Home before changing it.');
    this.name = 'FeedPostNotEditableError';
  }
}

/** Membership is fixed at creation. Include trashed posts so every library write rejects them. */
export async function assertLibraryWrite(id: string): Promise<void> {
  const [row] = await db.select({ feedId: links.feedId }).from(links).where(eq(links.id, id));
  if (row?.feedId != null) throw new FeedPostNotEditableError();
}
