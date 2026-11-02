import { db, links } from '@silo/db';
import { eq, sql } from 'drizzle-orm';
import { whereLiveAnywhere } from './live.js';

/** Cold image requests need no full text, tags, highlights or Reader data. */
export async function getPreviewImageFields(id: string) {
  const [row] = await db
    .select({
      imageUrl: links.imageUrl,
      thumbnailUrl: sql<unknown>`${links.sourceData}->'thumbnailUrl'`,
    })
    .from(links)
    .where(whereLiveAnywhere(eq(links.id, id)))
    .limit(1);
  return row ?? null;
}
