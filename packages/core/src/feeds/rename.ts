import { db, feeds } from '@silo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getFeed } from './feeds.js';

export const feedTitleSchema = z.string().trim().min(1).max(200).nullable();

/** Null restores the publisher's latest title; polling only changes that fetched title. */
export async function renameFeed(id: string, title: string | null) {
  const customTitle = feedTitleSchema.parse(title);
  const [row] = await db
    .update(feeds)
    .set({ customTitle })
    .where(eq(feeds.id, id))
    .returning({ id: feeds.id });
  return row ? getFeed(row.id) : null;
}
