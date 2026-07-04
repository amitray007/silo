import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getById, removeTag } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, foundResult, notFoundResult } from './found-result.js';

/**
 * Registers `remove_tag` on `server`: parse (Zod) -> GUARD with `getById` ->
 * one `core.removeTag` call -> re-fetch via `getById` -> shape the MCP
 * result.
 *
 * The `getById` guard mirrors `add_tag`'s (see `add-tag.ts`'s doc comment):
 * an unknown or trashed id resolves to a clean `found: false` result rather
 * than reaching `core.removeTag` at all — consistent write-tool behavior for
 * a live-scoping guard, even though `core.removeTag` itself is a harmless
 * no-op on a bogus id (unlike `addTag`, it doesn't FK-throw), for the same
 * reason `add_tag` refuses to operate on a trashed link.
 */
export function registerRemoveTag(server: McpServer): void {
  server.registerTool(
    'remove_tag',
    {
      title: 'Remove tag',
      description:
        'Detach a tag from a saved link. Matching is case-insensitive: ' +
        "removing 'ai' also removes a tag stored as 'AI'. A no-op (still " +
        "found: true) if the link doesn't currently carry that tag. Returns " +
        'a clean not-found result (not an error) if the id is unknown or the ' +
        'link has been trashed.',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid) to untag.'),
        tag: z.string().min(1).describe('The tag name to remove (matched case-insensitively).'),
      },
      outputSchema: foundLinkOutputShape,
    },
    async ({ id, tag }): Promise<CallToolResult> => {
      const existing = await getById(id);
      if (!existing) {
        return notFoundResult(
          `No live link with id ${id} (unknown or trashed) — no tag was removed. ` +
            'Use list_links or search_links to find it, or restore_link first if it is trashed.',
        );
      }

      await removeTag(id, tag);

      // `removeTag` returns void — re-fetch via `getById` to get the updated
      // tag set before shaping, same re-fetch-after-write pattern
      // `capture_link`/`edit_link`/`add_tag` use.
      const link = await getById(id);
      if (!link) {
        // Shouldn't happen immediately after untagging a link just confirmed
        // live above, but guarded rather than asserted.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Removed tag '${tag}' from link ${id} but could not re-fetch it immediately after; try get_link with id ${id} to confirm.`,
            },
          ],
        };
      }

      return foundResult(link, `Removed tag '${tag}' from link ${id} (or it wasn't present).`);
    },
  );
}
