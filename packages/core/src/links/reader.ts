import { db, links } from '@silo/db';
import { asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { whereLive } from './live.js';

export const READER_HTML_MAX_BYTES = 1024 * 1024;

/** HTML and its ordered image targets must always be written together. */
export const readerContentSchema = z.object({
  contentHtml: z
    .string()
    .min(1)
    .refine((html) => Buffer.byteLength(html) <= READER_HTML_MAX_BYTES),
  contentImages: z.array(z.httpUrl()).max(10_000),
});
export type ReaderContent = z.infer<typeof readerContentSchema>;

/** Keyset traversal visits failures once per run. A restart skips completed rows. */
export async function findReaderUpgradeCandidates(afterId?: string) {
  return db
    .select({ id: links.id, url: links.url })
    .from(links)
    .where(whereLive(isNull(links.contentHtml), afterId ? gt(links.id, afterId) : undefined))
    .orderBy(asc(links.id))
    .limit(100);
}

/** Fill missing Reader content without changing status, metadata, attempts or timestamps. */
export async function recordReaderUpgrade(
  linkId: string,
  content: ReaderContent,
): Promise<boolean> {
  const parsed = readerContentSchema.parse(content);
  const updated = await db
    .update(links)
    .set({ ...parsed, updatedAt: sql`${links.updatedAt}` })
    .where(whereLive(eq(links.id, linkId), isNull(links.contentHtml)))
    .returning({ id: links.id });
  return updated.length > 0;
}
