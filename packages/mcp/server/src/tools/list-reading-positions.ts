import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { listReadingPositions, loadUrlCleaner } from '@silo/core';
import { z } from 'zod';
import {
  compactLinkShape,
  readerListError,
  readerPageInputShape,
  readingSourceShape,
  readingSourceText,
} from './reader-shape.js';

export function registerListReadingPositions(server: McpServer): void {
  server.registerTool(
    'list_reading_positions',
    {
      title: 'List reading positions',
      description:
        'Browse saved places on live library links, newest update first. ' +
        'position is a share from 0 (start) to 1 (end). Filter source: pencil means read to, ' +
        'listen means listened to, mark means saved place (Continue here). Trash and feed posts are excluded. ' +
        'Use get_link to read on, or edit_link to move the saved place. Paginate with nextCursor.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        source: readingSourceShape
          .optional()
          .describe('Only places saved by pencil, listen or mark.'),
        ...readerPageInputShape,
      },
      outputSchema: {
        positions: z.array(
          z.object({
            link: compactLinkShape,
            position: z.number().min(0).max(1),
            source: readingSourceShape,
            updatedAt: z.iso.datetime(),
          }),
        ),
        count: z.number(),
        nextCursor: z.string().optional(),
      },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const cleaner = await loadUrlCleaner();
        const page = await listReadingPositions(input);
        const positions = page.positions.map((row) => ({
          link: { ...row.link, url: cleaner(row.link.url), originalUrl: row.link.url },
          position: row.position,
          source: row.source,
          updatedAt: row.updatedAt.toISOString(),
        }));
        const lines = [
          `${positions.length} reading position${positions.length === 1 ? '' : 's'} (newest update first):`,
        ];
        for (const row of positions)
          lines.push(
            `- ${row.link.title ?? row.link.url}: ${readingSourceText(row.source)} ${Math.round(row.position * 100)}% (link ${row.link.id}, saved ${row.updatedAt})`,
          );
        if (page.nextCursor !== undefined)
          lines.push(
            `Next cursor: ${page.nextCursor}\nPass it as cursor to list_reading_positions.`,
          );
        lines.push(
          'Use get_link with the link id to read on, or edit_link with readingPosition to move the saved place.',
        );
        return {
          structuredContent: {
            positions,
            count: positions.length,
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
