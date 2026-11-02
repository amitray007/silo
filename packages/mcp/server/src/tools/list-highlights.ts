import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HIGHLIGHT_COLORS, listLibraryHighlights } from '@silo/core';
import { z } from 'zod';
import { passageShape, toPassageContent } from './link-shape.js';
import { compactLinkShape, readerListError, readerPageInputShape } from './reader-shape.js';

function highlightLine(
  row: ReturnType<typeof toPassageContent> & {
    link: { id: string; title: string | null; url: string };
  },
): string {
  const quote = row.quote.length > 200 ? `${row.quote.slice(0, 199)}…` : row.quote;
  return `- ${row.link.title ?? row.link.url}: "${quote}"${row.note ? ` - note: ${row.note}` : ''} (highlight ${row.id}, link ${row.link.id})`;
}

export function registerListHighlights(server: McpServer): void {
  server.registerTool(
    'list_highlights',
    {
      title: 'List highlights',
      description:
        'Browse or search passage highlights and their notes across live library links, newest first. ' +
        'query is a case-insensitive substring of the quote or passage note; %, _ and backslash are literal. ' +
        'Filter by linkId, tag, hasNote or color. Trash and feed posts are excluded. ' +
        'Use get_link for the article and edit_highlight to change a note. Paginate with nextCursor.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Substring of the quote or passage note, case-insensitive.'),
        linkId: z.uuid().optional().describe('Only highlights on this library link.'),
        tag: z.string().optional().describe('Exact tag name, case-insensitive.'),
        hasNote: z
          .boolean()
          .optional()
          .describe('true keeps only highlights with a passage note; false or omitted keeps all.'),
        color: z.enum(HIGHLIGHT_COLORS).optional().describe('Only highlights of this color.'),
        ...readerPageInputShape,
      },
      outputSchema: {
        highlights: z.array(z.object({ ...passageShape, link: compactLinkShape })),
        count: z.number(),
        nextCursor: z.string().optional(),
      },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const page = await listLibraryHighlights(input);
        const highlights = page.highlights.map((row) => ({
          ...toPassageContent(row),
          link: row.link,
        }));
        const lines = [
          `${highlights.length} highlight${highlights.length === 1 ? '' : 's'} (newest first):`,
        ];
        lines.push(...highlights.map(highlightLine));
        if (page.nextCursor !== undefined)
          lines.push('More highlights available; pass nextCursor as cursor to list_highlights.');
        lines.push(
          'Use get_link with the link id for the full article, or edit_highlight with the highlight id to change a note.',
        );
        return {
          structuredContent: {
            highlights,
            count: highlights.length,
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          },
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        return readerListError(error);
      }
    },
  );
}
