import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { feedTitleSchema, renameFeed, renameTag, tagTitleSchema } from '@silo/core';
import { z } from 'zod';
import { feedResult, feedShape, runFeedTool, toFeedContent, toolError } from './feed-result.js';

export function registerRenameTools(server: McpServer): void {
  server.registerTool(
    'rename_feed',
    {
      annotations: { idempotentHint: true },
      description:
        'Set an owner title for a feed. Polling preserves it. Pass title: null to restore the latest publisher title. Use list_feeds to find the subscription.',
      inputSchema: { feedId: z.uuid(), title: feedTitleSchema },
      outputSchema: { feed: z.object(feedShape).optional(), found: z.boolean() },
    },
    ({ feedId, title }) =>
      runFeedTool(async () => {
        const feed = await renameFeed(feedId, title);
        return feed
          ? feedResult('Feed renamed. Use list_feed_posts to read its posts.', {
              found: true,
              feed: toFeedContent(feed),
            })
          : feedResult('Feed not found. Use list_feeds to find the subscription.', {
              found: false,
            });
      }),
  );
  server.registerTool(
    'rename_tag',
    {
      description:
        'Rename a tag while keeping link associations. If the target exists, returns tag_exists without changes. Ask the owner to confirm the merge, then retry with merge: true. Use list_tags to see names.',
      inputSchema: {
        name: z.string().min(1),
        newName: tagTitleSchema,
        merge: z.boolean().default(false),
      },
      outputSchema: {
        name: z.string(),
        merged: z.boolean().optional(),
        error: z.enum(['not_found', 'tag_exists']).optional(),
      },
    },
    async ({ name, newName, merge }) => {
      let result: Awaited<ReturnType<typeof renameTag>>;
      try {
        result = await renameTag(name, newName, merge);
      } catch (error) {
        console.error('[silo/mcp] tag rename failed:', error);
        return toolError('Tag operation failed. Use list_tags to check the tag, then retry.');
      }
      if ('error' in result)
        return {
          ...feedResult(
            result.error === 'tag_exists'
              ? `Tag #${result.name} exists. Ask the owner to confirm the merge, then retry with merge: true.`
              : 'Tag not found. Use list_tags to find it.',
            result,
          ),
          isError: true,
        };
      return feedResult(
        result.merged
          ? 'Tags merged. Links keep their tags. Use list_tags to see the result.'
          : 'Tag renamed. Use list_tags to see the result.',
        result,
      );
    },
  );
}
