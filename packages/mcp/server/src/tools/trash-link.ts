import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { softDelete, trashMany } from '@silo/core';
import { z } from 'zod';
import {
  bulkItemResultShape,
  foundLinkOutputShape,
  notFoundResult,
  runBulkGuarded,
  toBulkItemResult,
  toBulkTextSummary,
} from './found-result.js';

const trashLinkOutputSchema = {
  ...foundLinkOutputShape,
  results: z.array(z.object(bulkItemResultShape)).optional(),
};

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
        'Move one or more saved links to the trash (soft delete) — a ' +
        'trashed link stops appearing in get_link/list_links/search_links ' +
        'but is not permanently deleted. Pass `id` for ONE link, or `ids` ' +
        'for MANY in one call (if both are given, `ids` wins) — the batch ' +
        'call returns a `results` array (`{ id, ok, reason? }`) so one bad ' +
        'id never blocks the rest. Use restore_link to bring a trashed link ' +
        'back. The single-`id` path returns a clean not-found result (not ' +
        'an error) if the id is unknown or the link is already trashed (the ' +
        'two cases cannot be told apart).',
      inputSchema: {
        id: z.uuid().optional().describe('The link id (uuid) to trash (single-link mode).'),
        ids: z
          .array(z.uuid())
          .optional()
          .describe(
            'Link ids (uuids) to trash in one batch call, up to 500 per call. Wins over `id` if both are given.',
          ),
      },
      outputSchema: trashLinkOutputSchema,
    },
    async ({ id, ids }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        const outcome = await runBulkGuarded(() => trashMany(ids));
        if (!outcome.ok) return outcome.error;
        const results = outcome.value.map(toBulkItemResult);
        return {
          content: [{ type: 'text', text: toBulkTextSummary('Trash', results) }],
          structuredContent: { found: false, batch: true, results },
        };
      }

      if (id === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `id` (single) or `ids` (batch) to trash_link.' },
          ],
        };
      }

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
          addedBy: deleted.addedBy,
          notes: deleted.notes,
          tags: [],
          createdAt: deleted.createdAt.toISOString(),
          updatedAt: deleted.updatedAt.toISOString(),
        },
      };
    },
  );
}
