import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { addTag, getById } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, foundResult, notFoundResult } from './found-result.js';

/**
 * Registers `add_tag` on `server`: parse (Zod) -> GUARD with `getById` ->
 * one `core.addTag` call -> re-fetch via `getById` -> shape the MCP result.
 *
 * The `getById` guard is required, not optional: per plan 004's key-contract
 * facts, `core.addTag` is NOT live-scoped and will FK-throw on a bogus id or
 * silently tag an already-trashed link. Checking `getById(id)` first (live-
 * scoped) turns both the unknown-id and trashed-id cases into a clean
 * `found: false` result — refusing to tag a link that shouldn't be tagged —
 * before `core.addTag` ever runs.
 */
export function registerAddTag(server: McpServer): void {
  server.registerTool(
    'add_tag',
    {
      title: 'Add tag',
      description:
        'Attach a tag to a saved link. Matching is case-insensitive: adding ' +
        "'ai' to a link that already has 'AI' is a no-op (one tag survives, " +
        'keeping whichever casing was entered first) — this call is safe to ' +
        'repeat. Returns a clean not-found result (not an error) if the id ' +
        'is unknown or the link has been trashed (trashed links cannot be tagged).',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid) to tag.'),
        tag: z.string().min(1).describe('The tag name to attach (matched case-insensitively).'),
      },
      outputSchema: foundLinkOutputShape,
    },
    async ({ id, tag }): Promise<CallToolResult> => {
      const existing = await getById(id);
      if (!existing) {
        return notFoundResult(
          `No live link with id ${id} (unknown or trashed) — no tag was added. ` +
            'Use list_links or search_links to find it, or restore_link first if it is trashed.',
        );
      }

      await addTag(id, tag);

      // `addTag` returns void — re-fetch via `getById` to get the updated
      // tag set before shaping, same re-fetch-after-write pattern
      // `capture_link`/`edit_link` use.
      const link = await getById(id);
      if (!link) {
        // Shouldn't happen immediately after tagging a link just confirmed
        // live above, but guarded rather than asserted.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Added tag '${tag}' to link ${id} but could not re-fetch it immediately after; try get_link with id ${id} to confirm.`,
            },
          ],
        };
      }

      return foundResult(link, `Added tag '${tag}' to link ${id} (or it was already present).`);
    },
  );
}
