import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchFeedPosts } from '@silo/core';
import { z } from 'zod';
import { feedResult, runFeedTool } from './feed-result.js';
import { snippetLinkShape, toRankedResultLine, toSnippetLinkContent } from './link-shape.js';

export function registerSearchFeedPosts(server: McpServer): void {
  server.registerTool(
    'search_feed_posts',
    {
      annotations: { readOnlyHint: true },
      description:
        'Search one feed across Inbox and Archive by text, title or URL. Library links and other feeds are excluded. Use get_link with a result id to read its content.',
      inputSchema: {
        feedId: z.uuid().describe('Subscription id from list_feeds.'),
        query: z.string().min(1).describe('Search text; supports word prefixes and substrings.'),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional().describe('Pass nextCursor to continue the same search.'),
      },
      outputSchema: {
        results: z.array(
          z.object({
            ...snippetLinkShape,
            rank: z.number(),
            feedId: z.uuid(),
            publishedAt: z.iso.datetime().nullable(),
            archivedAt: z.iso.datetime().nullable(),
            savedLinkId: z.uuid().nullable(),
          }),
        ),
        nextCursor: z.string().optional(),
      },
    },
    ({ feedId, query, limit, cursor }) =>
      runFeedTool(async () => {
        const page = await searchFeedPosts(feedId, query, {
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        });
        const results = page.results.map((post) => ({
          ...toSnippetLinkContent(post),
          rank: post.rank,
          feedId,
          publishedAt: post.publishedAt?.toISOString() ?? null,
          archivedAt: post.archivedAt?.toISOString() ?? null,
          savedLinkId: post.savedLinkId,
        }));
        return feedResult(
          results.length
            ? [
                `Found ${results.length} posts.`,
                ...results.map((result) => `${toRankedResultLine(result)} (id: ${result.id})`),
                'Use get_link with an id to read it. Pass nextCursor, when present, to continue.',
              ].join('\n')
            : 'No matching posts. Try another query, or list_feeds to choose a subscription.',
          { results, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
        );
      }),
  );
}
