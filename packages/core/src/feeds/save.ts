import { db, links } from '@silo/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { enqueueEnrichment } from '../links/enqueue.js';
import type { Link, Tx } from '../links/executor.js';
import { bestCaptureStatus, mergeCaptureFields } from '../links/merge-content.js';

export type SaveFeedPostResult =
  | { id: string; outcome: 'created' | 'existing' | 'revived' }
  | { error: 'not_found' | 'not_feed_post' };

/** Captured content is already trusted storage. Keep Reader provenance with its payload. */
function copiedContent(post: Link) {
  return {
    url: post.url,
    canonicalUrl: post.canonicalUrl,
    title: post.title,
    titleSource: post.titleSource,
    description: post.description,
    imageUrl: post.imageUrl,
    siteName: post.siteName,
    extractedText: post.extractedText,
    contentHtml: post.contentHtml,
    contentImages: post.contentImages,
    readerVersion: post.readerVersion,
    readerCapturedAt: post.readerCapturedAt,
    readerRenderPending: post.readerRenderPending,
    sourceKind: post.sourceKind,
    sourceData: post.sourceData,
    captureStatus: post.captureStatus,
    enrichFloorStatus: post.enrichFloorStatus,
  };
}

function revivedContent(existing: Link, post: Link) {
  const titleOwner = existing.titleSource === 'user' || post.title === null ? existing : post;
  const reader = post.contentHtml === null ? existing : post;
  const source = existing.sourceKind === 'link' && post.sourceKind !== 'link' ? post : existing;
  return {
    ...copiedContent(post),
    ...mergeCaptureFields(existing, {
      ...post,
      title: titleOwner.title,
      titleSource: titleOwner.titleSource,
    }),
    contentHtml: reader.contentHtml,
    contentImages: reader.contentImages,
    readerVersion: reader.readerVersion,
    readerCapturedAt: reader.readerCapturedAt,
    readerRenderPending: reader.readerRenderPending,
    sourceKind: source.sourceKind,
    sourceData: source.sourceData,
    captureStatus: bestCaptureStatus(
      existing.captureStatus,
      existing.enrichFloorStatus,
      post.captureStatus,
      post.enrichFloorStatus,
    ),
    enrichFloorStatus: existing.enrichFloorStatus,
    deletedAt: null,
    enrichAttempts: 0,
  };
}

async function saveWith(tx: Tx, feedId: string, postId: string): Promise<SaveFeedPostResult> {
  // Serialize saves of this post, including the saved pointer and enqueue decision.
  const [post] = await tx.select().from(links).where(eq(links.id, postId)).for('update');
  if (!post || post.deletedAt) return { error: 'not_found' };
  if (!post.feedId) return { error: 'not_feed_post' };
  if (post.feedId !== feedId) return { error: 'not_found' };
  const [existing] = await tx
    .select()
    .from(links)
    .where(and(isNull(links.feedId), eq(links.canonicalUrl, post.canonicalUrl)))
    .orderBy(desc(isNull(links.deletedAt)), desc(links.deletedAt), desc(links.id))
    .limit(1)
    .for('update');
  let id = existing?.id;
  let captureStatus = post.captureStatus;
  const outcome = existing ? (existing.deletedAt ? 'revived' : 'existing') : 'created';
  if (existing?.deletedAt) {
    const content = revivedContent(existing, post);
    captureStatus = content.captureStatus;
    await tx.update(links).set(content).where(eq(links.id, existing.id));
  } else if (!existing) {
    const [created] = await tx
      .insert(links)
      .values({
        ...copiedContent(post),
        // This is an explicit manual save in the web app, not automatic feed capture.
        source: 'web',
        addedBy: 'user',
      })
      .returning({ id: links.id });
    id = created?.id;
  }
  if (!id) throw new Error('saveFeedPost: no pond link');
  await tx.update(links).set({ savedLinkId: id }).where(eq(links.id, postId));
  const needsEnrichment =
    outcome === 'revived' ? captureStatus !== 'full' : captureStatus === 'enriching';
  if (outcome !== 'existing' && needsEnrichment) {
    await enqueueEnrichment(tx, id, { trigger: 'capture', previousStatus: captureStatus });
  }
  return { id, outcome };
}

/** The pond partial unique index arbitrates races with other saves and normal captures. */
export async function saveFeedPost(feedId: string, postId: string): Promise<SaveFeedPostResult> {
  try {
    return await db.transaction((tx) => saveWith(tx, feedId, postId));
  } catch (error) {
    const cause =
      error instanceof Error ? (error.cause as { code?: string; constraint?: string }) : undefined;
    if (cause?.code !== '23505' || cause.constraint !== 'links_canonical_url_library_unique_idx')
      throw error;
    return db.transaction((tx) => saveWith(tx, feedId, postId));
  }
}
