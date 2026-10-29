import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Feed, InvalidCursorError } from '@silo/core';
import { z } from 'zod';

export const feedShape = {
  id: z.uuid(),
  title: z.string(),
  feedUrl: z.string(),
  siteUrl: z.string().nullable(),
  format: z.enum(['rss', 'atom', 'rdf', 'json']),
  status: z.enum(['active', 'failing', 'gone']),
  lastError: z.string().nullable(),
  lastPolledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  inboxCount: z.number(),
  postCount: z.number(),
};

export function toFeedContent(feed: Feed): z.infer<z.ZodObject<typeof feedShape>> {
  return {
    id: feed.id,
    title: feed.title,
    feedUrl: feed.feedUrl,
    siteUrl: feed.siteUrl,
    format: feed.format,
    status: feed.status,
    lastError: feed.lastError,
    lastPolledAt: feed.lastPolledAt?.toISOString() ?? null,
    createdAt: feed.createdAt.toISOString(),
    inboxCount: feed.inboxCount,
    postCount: feed.postCount,
  };
}

export function feedResult(
  text: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

/** Keep database and fetch diagnostics on stderr, outside protocol results. */
export async function runFeedTool(
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    const text =
      error instanceof InvalidCursorError
        ? 'Invalid cursor. Omit cursor to restart from the first page.'
        : 'Feed operation failed. Try list_feeds to check the subscription, then retry.';
    console.error('[silo/mcp] feed operation failed:', error);
    return { isError: true, content: [{ type: 'text', text }] };
  }
}

export function feedPostMissing(error: 'not_found' | 'not_feed_post'): CallToolResult {
  return feedResult(
    error === 'not_feed_post'
      ? 'This is a library link. Use list_feed_posts to find a feed post.'
      : 'Feed post not found in this feed. Use list_feeds, then list_feed_posts to find it.',
    { found: false, error },
  );
}
