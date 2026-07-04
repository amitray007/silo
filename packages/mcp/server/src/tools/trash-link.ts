import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { softDelete } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, notFoundResult } from './found-result.js';

/**
 * Registers `trash_link` on `server`: parse (Zod) -> one `core.softDelete`
 * call -> shape the MCP result.
 *
 * `core.softDelete` is live-scoped and returns bare `Link | null` (never
 * `LinkWithTags`) — unlike `edit_link`/`add_tag`/`remove_tag`, a successful
 * trash CANNOT be re-hydrated via `getById` afterward, because `getById` is
 * itself live-scoped and the row is now trashed (it would return `null`,
 * indistinguishable from "vanished"). So the success branch shapes
 * `structuredContent` directly from the bare `deleted` row rather than
 * reusing `foundResult` (which requires a `LinkWithTags`): every whitelisted
 * field `foundLinkOutputShape` declares is included from `deleted` except
 * `tags`, which is reported as `[]` with the text explicitly saying the tag
 * list isn't included (honest omission, not a silent leak-shaped lie) — the
 * link is leaving the live set, so its tag set isn't needed to act on this
 * result the way it is for a normal read.
 *
 * `softDelete` returns `null` for BOTH an unknown id and an already-trashed
 * one (the query is `WHERE live AND id = ...`, so it can't tell which). The
 * not-found text says so plainly rather than guessing.
 */
export function registerTrashLink(server: McpServer): void {
  server.registerTool(
    'trash_link',
    {
      title: 'Trash link',
      description:
        'Move a saved link to the trash (soft delete) — it stops appearing ' +
        'in get_link/list_links/search_links but is not permanently deleted. ' +
        'Use restore_link to bring it back. Returns a clean not-found result ' +
        '(not an error) if the id is unknown or the link is already trashed ' +
        '(the two cases cannot be told apart).',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid) to trash.'),
      },
      outputSchema: foundLinkOutputShape,
    },
    async ({ id }): Promise<CallToolResult> => {
      const deleted = await softDelete(id);
      if (!deleted) {
        return notFoundResult(
          `No LIVE link with id ${id} to trash — it's either unknown or ` +
            'already in the trash. Use list_links to find live links, or ' +
            'restore_link if you meant to recover it.',
        );
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `Trashed link ${id}${deleted.title ? ` (${deleted.title})` : ''}. ` +
              'Recover it with restore_link, or it will be purged after the ' +
              'retention window. (Its tag list is omitted here since it is no ' +
              'longer live — call restore_link first if you need it.)',
          },
        ],
        structuredContent: {
          found: true,
          id: deleted.id,
          url: deleted.url,
          title: deleted.title,
          description: deleted.description,
          imageUrl: deleted.imageUrl,
          siteName: deleted.siteName,
          extractedText: deleted.extractedText,
          sourceKind: deleted.sourceKind,
          captureStatus: deleted.captureStatus,
          notes: deleted.notes,
          tags: [],
          createdAt: deleted.createdAt.toISOString(),
          updatedAt: deleted.updatedAt.toISOString(),
        },
      };
    },
  );
}
