import { db, links, pageSnapshots } from '@silo/db';
import { and, eq, sql } from 'drizzle-orm';
import { FULL_TEXT_THRESHOLD } from '../capture.js';
import { canonicalize } from './canonicalize.js';
import { FIELD_MAX } from './enrichment.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PageEnqueuer = (tx: Tx, linkId: string) => Promise<void>;
let enqueue: PageEnqueuer = async () => {
  throw new Error('Page queue unavailable');
};
export function setPageEnqueuer(next: PageEnqueuer): void {
  enqueue = next;
}

export async function savePageSnapshot(
  id: string,
  page: { url: string; html: string; capturedAt: Date },
) {
  return db
    .transaction(async (tx) => {
      const [link] = await tx
        .select({ url: links.url })
        .from(links)
        .where(and(eq(links.id, id), sql`${links.deletedAt} is null`))
        .for('update');
      if (!link) return 'not_found' as const;
      const incoming = canonicalize(page.url);
      const stored = canonicalize(link.url);
      if (!incoming.ok || !stored.ok || incoming.canonical !== stored.canonical)
        return 'url_mismatch' as const;
      const [saved] = await tx
        .insert(pageSnapshots)
        .values({ linkId: id, ...page })
        .onConflictDoUpdate({
          target: pageSnapshots.linkId,
          set: { ...page, createdAt: new Date() },
          setWhere: sql`${pageSnapshots.capturedAt} < ${page.capturedAt}`,
        })
        .returning({ id: pageSnapshots.linkId });
      if (saved) await enqueue(tx, id);
      return 'accepted' as const;
    })
    .catch(() => {
      // Database errors include bound parameters, which can contain private page HTML.
      throw new Error('Could not store browser page');
    });
}

export async function getPageSnapshot(id: string) {
  const [page] = await db.select().from(pageSnapshots).where(eq(pageSnapshots.linkId, id));
  return page;
}
export async function deletePageSnapshot(id: string, capturedAt: Date): Promise<void> {
  await db
    .update(links)
    .set({ readerUploadAt: sql`greatest(${links.readerUploadAt}, ${capturedAt})` })
    .where(eq(links.id, id));
  await db
    .delete(pageSnapshots)
    .where(and(eq(pageSnapshots.linkId, id), eq(pageSnapshots.capturedAt, capturedAt)));
}
export async function cleanupPageSnapshots(): Promise<void> {
  await db.delete(pageSnapshots).where(sql`${pageSnapshots.createdAt} < now() - interval '1 day'`);
}
export async function fillPageMetadata(
  id: string,
  result: { title?: string; description?: string; imageUrl?: string; siteName?: string },
): Promise<void> {
  await db
    .update(links)
    .set({
      title: sql`coalesce(nullif(${links.title}, ''), ${result.title?.slice(0, FIELD_MAX.title) ?? null})`,
      description: sql`coalesce(nullif(${links.description}, ''), ${result.description?.slice(0, FIELD_MAX.description) ?? null})`,
      imageUrl: sql`coalesce(nullif(${links.imageUrl}, ''), ${result.imageUrl && result.imageUrl.length <= FIELD_MAX.imageUrl ? result.imageUrl : null})`,
      siteName: sql`coalesce(nullif(${links.siteName}, ''), ${result.siteName?.slice(0, FIELD_MAX.siteName) ?? null})`,
      captureStatus: sql`case when length(coalesce(${links.extractedText}, '')) >= ${FULL_TEXT_THRESHOLD} then 'full'::capture_status when ${links.contentHtml} is not null then 'partial'::capture_status else ${links.captureStatus} end`,
      updatedAt: sql`${links.updatedAt}`,
    })
    .where(and(eq(links.id, id), sql`${links.deletedAt} is null`));
}
