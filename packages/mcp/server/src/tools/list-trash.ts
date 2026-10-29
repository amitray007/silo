import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LinkSummaryWithTags, PageParams, SearchResultRow } from '@silo/core';
import { InvalidCursorError, listTrash, searchTrash } from '@silo/core';
import { z } from 'zod';
import { snippetLinkShape, toSnippetLinkContent } from './link-shape.js';

function toTrashContent(link: LinkSummaryWithTags | SearchResultRow) {
  return {
    ...toSnippetLinkContent('snippet' in link ? link : { ...link, snippet: null }),
    deletedAt: link.deletedAt?.toISOString() ?? '',
    ...('rank' in link ? { rank: link.rank } : {}),
  };
}

function trashText(links: ReturnType<typeof toTrashContent>[], nextCursor?: string): string {
  return [
    ...links.map((link) => `${link.id}: ${link.title ?? link.url}`),
    'Use restore_link to restore or hard_delete_link to permanently delete a trashed link.',
    ...(nextCursor ? ['Pass nextCursor as cursor to continue.'] : []),
  ].join('\n');
}

export function registerListTrash(server: McpServer): void {
  server.registerTool(
    'list_trash',
    {
      title: 'List trash',
      description:
        'Browse trashed links newest deletion first, or search trash with query. Returns snippets, deletedAt, and search rank when searching. Use restore_link or hard_delete_link on a result.',
      inputSchema: {
        query: z.string().min(1).optional(),
        limit: z
          .number()
          .int()
          .optional()
          .describe('Max links per page (default 20, clamped to [1, 100]).'),
        cursor: z
          .string()
          .optional()
          .describe('Opaque nextCursor from the previous page. Omit for the first page.'),
      },
      outputSchema: {
        links: z.array(
          z.object({
            ...snippetLinkShape,
            deletedAt: z.iso.datetime(),
            rank: z.number().optional(),
          }),
        ),
        nextCursor: z.string().optional(),
      },
    },
    async ({ query, limit, cursor }) => {
      const params: PageParams = {};
      if (limit !== undefined) params.limit = limit;
      if (cursor !== undefined) params.cursor = cursor;
      try {
        const page =
          query === undefined ? await listTrash(params) : await searchTrash(query, params);
        const rows = 'results' in page ? page.results : page.links;
        const links = rows.map(toTrashContent);
        return {
          structuredContent: {
            links,
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          },
          content: [
            {
              type: 'text',
              text: trashText(links, page.nextCursor),
            },
          ],
        };
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Invalid or expired cursor; omit cursor to restart from the first page.',
            },
          ],
        };
      }
    },
  );
}
