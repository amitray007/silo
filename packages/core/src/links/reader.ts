import { db, links } from '@silo/db';
import { asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
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

const missingText = or(isNull(links.extractedText), eq(links.extractedText, ''));

/** Keyset traversal visits failures once per run. A restart skips completed rows. */
export async function findReaderUpgradeCandidates(afterId?: string, refreshHtml = false) {
  return db
    .select({ id: links.id, url: links.url })
    .from(links)
    .where(
      whereLive(
        refreshHtml ? undefined : or(isNull(links.contentHtml), missingText),
        afterId ? gt(links.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(links.id))
    .limit(100);
}

/** Fill missing text; optionally refresh HTML after a sanitizer change. Preserve metadata/status. */
export async function recordReaderUpgrade(
  linkId: string,
  content: ReaderContent,
  text?: string,
  refreshHtml = false,
): Promise<boolean> {
  const parsed = readerContentSchema.parse(content);
  const recoveredText = text?.trim() ? text : undefined;
  const updated = await db
    .update(links)
    .set({
      contentHtml: refreshHtml
        ? parsed.contentHtml
        : sql`coalesce(${links.contentHtml}, ${parsed.contentHtml})`,
      contentImages: refreshHtml
        ? parsed.contentImages
        : sql`case when ${links.contentHtml} is null then ${JSON.stringify(parsed.contentImages)}::jsonb else ${links.contentImages} end`,
      ...(recoveredText
        ? {
            extractedText: sql`case when ${missingText} then ${recoveredText} else ${links.extractedText} end`,
          }
        : {}),
      updatedAt: sql`${links.updatedAt}`,
    })
    .where(
      whereLive(
        eq(links.id, linkId),
        refreshHtml
          ? undefined
          : or(isNull(links.contentHtml), recoveredText ? missingText : undefined),
      ),
    )
    .returning({ id: links.id });
  return updated.length > 0;
}
