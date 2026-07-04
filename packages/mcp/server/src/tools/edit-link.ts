import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EditLinkInput } from '@silo/core';
import { editLink, getById } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, foundResult, notFoundResult } from './found-result.js';

/**
 * Registers `edit_link` on `server`: parse (Zod) -> one `core.editLink` call
 * -> (on success) re-fetch via `getById` to hydrate tags -> shape the MCP
 * result. Per docs/rules/mcp.md and the `capture_link` precedent
 * (`capture-link.ts`'s doc comment), `core.editLink` returns a bare `Link`
 * (no `tags`), so a successful edit re-fetches before shaping rather than
 * echoing the bare row.
 */
export function registerEditLink(server: McpServer): void {
  server.registerTool(
    'edit_link',
    {
      title: 'Edit link',
      description:
        "Update a saved link's title, description, and/or note. Only the " +
        'fields you pass are changed; omitted fields are left as-is (an ' +
        'edit with no fields is a no-op that returns the link unchanged). ' +
        "Cannot change the link's url, sourceKind, or tags — use `add_tag`/" +
        '`remove_tag` for tags. Returns a clean not-found result (not an ' +
        'error) if the id is unknown or the link has been trashed.',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid) to edit.'),
        title: z.string().optional().describe('New title. Omit to leave unchanged.'),
        description: z.string().optional().describe('New description. Omit to leave unchanged.'),
        note: z.string().optional().describe('New note. Omit to leave unchanged.'),
      },
      outputSchema: foundLinkOutputShape,
    },
    async ({ id, title, description, note }): Promise<CallToolResult> => {
      // Built conditionally (not object-literal spread) because
      // `exactOptionalPropertyTypes` makes `EditLinkInput`'s optional fields
      // reject an explicit `undefined` — the input schema's `.optional()`
      // fields come through as `undefined` when omitted, so each is only
      // assigned when actually present.
      const input: EditLinkInput = {};
      if (title !== undefined) input.title = title;
      if (description !== undefined) input.description = description;
      if (note !== undefined) input.notes = note;

      const updated = await editLink(id, input);
      if (!updated) {
        return notFoundResult(
          `No live link with id ${id} (unknown or trashed) — nothing was edited. ` +
            'Use list_links or search_links to find it, or restore_link first if it is trashed.',
        );
      }

      // `editLink` returns a bare `Link` (no `tags`) — re-fetch via
      // `getById` to hydrate tags before shaping, same pattern
      // `capture_link` established.
      const link = await getById(id);
      if (!link) {
        // Shouldn't happen immediately after a successful live-scoped edit,
        // but guarded rather than asserted — a clean tool error beats a
        // thrown TypeError on `null`.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Edited link ${id} but could not re-fetch it immediately after; try get_link with id ${id} to confirm.`,
            },
          ],
        };
      }

      return foundResult(
        link,
        `Updated link ${id}. Call get_link with this id to see the full result.`,
      );
    },
  );
}
