import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  deleteFeed,
  listFeedPosts,
  listFeedsPage,
  normalizeFeedUrl,
  type PageParams,
  refreshFeed,
  saveFeedPost,
  setFeedPostArchived,
  subscribeFeed,
} from '@silo/core';
import { z } from 'zod';
import {
  feedPostMissing,
  feedResult,
  feedShape,
  runFeedTool,
  toFeedContent,
} from './feed-result.js';
import { snippetLinkShape, toSnippetLinkContent } from './link-shape.js';

const pageShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Page size, default 20, maximum 100.'),
  cursor: z.string().optional().describe('Pass nextCursor from the previous page. Omit to start.'),
};
const postInput = {
  feedId: z.uuid().describe('Subscription id from list_feeds.'),
  postId: z.uuid().describe('Post id from list_feed_posts.'),
};
const postShape = {
  ...snippetLinkShape,
  feedId: z.uuid(),
  publishedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  savedLinkId: z.uuid().nullable(),
};

function pageParams(limit: number | undefined, cursor: string | undefined): PageParams {
  return { ...(limit !== undefined ? { limit } : {}), ...(cursor !== undefined ? { cursor } : {}) };
}

function registerFeedReads(server: McpServer): void {
  server.registerTool(
    'list_feeds',
    {
      annotations: { readOnlyHint: true },
      description:
        'List feed subscriptions, their Inbox counts and health, with paging. Feed posts stay outside the library. Use list_feed_posts to read a subscription.',
      inputSchema: pageShape,
      outputSchema: { feeds: z.array(z.object(feedShape)), nextCursor: z.string().optional() },
    },
    ({ limit, cursor }) =>
      runFeedTool(async () => {
        const page = await listFeedsPage(pageParams(limit, cursor));
        const feeds = page.feeds.map(toFeedContent);
        const summary = feeds
          .map((feed) => `${feed.id}: ${feed.title} (${feed.inboxCount} in Inbox, ${feed.status})`)
          .join('\n');
        return feedResult(
          feeds.length
            ? `${summary}\nUse list_feed_posts with feedId.${page.nextCursor ? ' Pass nextCursor to list more feeds.' : ''}`
            : 'No subscriptions. Use subscribe_feed with a site or feed URL.',
          { ...page, feeds },
        );
      }),
  );
  server.registerTool(
    'list_feed_posts',
    {
      annotations: { readOnlyHint: true },
      description:
        'List posts in one feed, newest first. tab is inbox (default) or archive. Results include savedLinkId for the Home copy. Use get_link with a post id to read its full content, or save_feed_post to copy it into the library.',
      inputSchema: {
        feedId: postInput.feedId,
        tab: z.enum(['inbox', 'archive']).default('inbox'),
        ...pageShape,
      },
      outputSchema: { posts: z.array(z.object(postShape)), nextCursor: z.string().optional() },
    },
    ({ feedId, tab, limit, cursor }) =>
      runFeedTool(async () => {
        const page = await listFeedPosts(feedId, { ...pageParams(limit, cursor), tab });
        const posts = page.links.map((link) => ({
          ...toSnippetLinkContent({ ...link, snippet: link.extractedText?.slice(0, 280) ?? null }),
          feedId,
          publishedAt: link.publishedAt?.toISOString() ?? null,
          archivedAt: link.archivedAt?.toISOString() ?? null,
          savedLinkId: link.savedLinkId,
        }));
        return feedResult(
          posts.length
            ? `${posts.map((post) => `${post.id}: ${post.title ?? post.url}`).join('\n')}\nUse save_feed_post to keep a copy in Home.${page.nextCursor ? ' Pass nextCursor to continue this tab.' : ''}`
            : `No posts in ${tab}. Try the other tab, or list_feeds to check the subscription.`,
          { posts, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
        );
      }),
  );
}

function registerFeedSubscription(server: McpServer): void {
  server.registerTool(
    'subscribe_feed',
    {
      description:
        'Subscribe to an HTTP(S) feed or site URL. syncRecents (default true) captures the newest 20 posts; false starts with future posts only. Posts enrich asynchronously and stay outside the library until save_feed_post.',
      inputSchema: {
        url: z
          .string()
          .transform(normalizeFeedUrl)
          .pipe(z.url({ protocol: /^https?$/ }).max(8192)),
        syncRecents: z.boolean().default(true),
      },
      outputSchema: { feed: z.object(feedShape).optional(), deduped: z.boolean().optional() },
    },
    (input) =>
      runFeedTool(async () => {
        const result = await subscribeFeed(input);
        if ('error' in result)
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  result.error === 'feeds_unavailable'
                    ? 'feeds_unavailable: Feed discovery is unavailable in this process. Run the Silo app entry point with its feed resolver and queue, then retry subscribe_feed.'
                    : 'feed_not_found: No feed found at this URL. Try a direct RSS, Atom or JSON feed URL.',
              },
            ],
          };
        return feedResult(
          `${result.deduped ? 'Already subscribed' : 'Subscribed'}: ${result.feed.title}. Use list_feed_posts with feedId ${result.feed.id}; enrichment runs asynchronously.`,
          { feed: toFeedContent(result.feed), deduped: result.deduped },
        );
      }),
  );
  server.registerTool(
    'unsubscribe_feed',
    {
      title: 'Unsubscribe from feed',
      description:
        'Remove a subscription and permanently delete all its feed posts. This cannot be undone. Copies saved to Home remain in the library.',
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: { feedId: postInput.feedId },
      outputSchema: { found: z.boolean() },
    },
    ({ feedId }) =>
      runFeedTool(async () => {
        const found = await deleteFeed(feedId);
        return feedResult(
          found
            ? 'Unsubscribed. Home copies remain. Use list_feeds to choose another feed.'
            : 'Subscription not found. Use list_feeds to find current subscriptions.',
          { found },
        );
      }),
  );
}

function registerFeedWrites(server: McpServer): void {
  server.registerTool(
    'refresh_feed',
    {
      description:
        'Queue a poll now, including retrying a gone feed. Use list_feeds to check health and list_feed_posts for new posts after the worker polls.',
      inputSchema: { feedId: postInput.feedId },
      outputSchema: { found: z.boolean(), id: z.uuid().optional() },
    },
    ({ feedId }) =>
      runFeedTool(async () => {
        const result = await refreshFeed(feedId);
        if ('error' in result) {
          if (result.error === 'not_found')
            return feedResult('Subscription not found. Use list_feeds to find it.', {
              found: false,
            });
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'feeds_unavailable: Run the Silo app entry point with its feed queue, then retry refresh_feed.',
              },
            ],
          };
        }
        return feedResult(
          'Refresh queued. Use list_feeds to check health, then list_feed_posts for new posts.',
          { found: true, id: result.id },
        );
      }),
  );
  server.registerTool(
    'save_feed_post',
    {
      description:
        'Copy a feed post into Home, or reuse/revive its existing library copy. The copy keeps its content after archiving the post or unsubscribing. Use the returned id with library tools for tags, notes and search.',
      inputSchema: postInput,
      outputSchema: {
        found: z.boolean(),
        id: z.uuid().optional(),
        outcome: z.enum(['created', 'existing', 'revived']).optional(),
        error: z.string().optional(),
      },
    },
    ({ feedId, postId }) =>
      runFeedTool(async () => {
        const result = await saveFeedPost(feedId, postId, 'agent');
        if ('error' in result) return feedPostMissing(result.error);
        return feedResult(
          `Home copy ${result.id} (${result.outcome}). Use get_link or search_links to find it; use edit_link or add_link_tag to organize it.`,
          { found: true, ...result },
        );
      }),
  );
  for (const archived of [true, false]) {
    const name = archived ? 'archive_feed_post' : 'unarchive_feed_post';
    server.registerTool(
      name,
      {
        description: archived
          ? 'Move a post from its feed Inbox to Archive. The Home copy is unchanged. Repeat safely; use unarchive_feed_post to undo.'
          : 'Move a post from its feed Archive to Inbox. The Home copy is unchanged. Repeat safely; use archive_feed_post to undo.',
        annotations: { idempotentHint: true },
        inputSchema: postInput,
        outputSchema: {
          found: z.boolean(),
          id: z.uuid().optional(),
          archivedAt: z.iso.datetime().nullable().optional(),
          error: z.string().optional(),
        },
      },
      ({ feedId, postId }) =>
        runFeedTool(async () => {
          const result = await setFeedPostArchived(feedId, postId, archived);
          if ('error' in result) return feedPostMissing(result.error);
          return feedResult(
            `Post ${archived ? 'archived' : 'returned to Inbox'}. Use list_feed_posts with tab ${archived ? 'archive' : 'inbox'} to find it.`,
            { found: true, id: result.id, archivedAt: result.archivedAt?.toISOString() ?? null },
          );
        }),
    );
  }
}

export function registerFeedTools(server: McpServer): void {
  registerFeedReads(server);
  registerFeedSubscription(server);
  registerFeedWrites(server);
}
