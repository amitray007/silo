import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getById, removeTag, removeTagMany } from '@silo/core';
import { z } from 'zod';
import {
  bulkItemResultShape,
  foundLinkOutputShape,
  foundResult,
  notFoundResult,
  runBulkGuarded,
  toBulkItemResult,
  toBulkTextSummary,
} from './found-result.js';

const removeTagOutputSchema = {
  ...foundLinkOutputShape,
  results: z.array(z.object(bulkItemResultShape)).optional(),
};

/**
 * Registers `remove_tag` on `server`: parse (Zod) -> GUARD with `getById`
 * (single) or one `core.removeTagMany` call (batch) -> shape the MCP result.
 *
 * One-or-many (agent-navigation slice U4): `id`/`ids` precedence mirrors
 * `add_tag`'s (see `add-tag.ts`'s doc comment) — `ids` wins if both given.
 * The SINGLE path is UNCHANGED behavior: the `getById` guard mirrors
 * `add_tag`'s — an unknown or trashed id resolves to a clean `found: false`
 * result rather than reaching `core.removeTag` at all — consistent
 * write-tool behavior for a live-scoping guard, even though `core.removeTag`
 * itself is a harmless no-op on a bogus id (unlike `addTag`, it doesn't
 * FK-throw), for the same reason `add_tag` refuses to operate on a trashed
 * link. The BATCH path delegates to `core.removeTagMany`, which reports
 * every item `ok: true` unless the underlying call throws (see its doc
 * comment).
 */
export function registerRemoveTag(server: McpServer): void {
  server.registerTool(
    'remove_tag',
    {
      title: 'Remove tag',
      description:
        'Detach a tag from one or more saved links. Pass `id` for ONE link, ' +
        'or `ids` for MANY in one call (if both are given, `ids` wins) — the ' +
        'batch call returns a `results` array (`{ id, ok, reason? }`) so one ' +
        'bad id never blocks the rest. Matching is case-insensitive: ' +
        "removing 'ai' also removes a tag stored as 'AI'. A no-op (still " +
        "found: true / ok: true) if a link doesn't currently carry that " +
        'tag. The single-`id` path returns a clean not-found result (not an ' +
        'error) if the id is unknown or the link has been trashed.',
      inputSchema: {
        id: z.uuid().optional().describe('The link id (uuid) to untag (single-link mode).'),
        ids: z
          .array(z.uuid())
          .optional()
          .describe(
            'Link ids (uuids) to untag in one batch call, up to 500 per call. Wins over `id` if both are given.',
          ),
        tag: z.string().min(1).describe('The tag name to remove (matched case-insensitively).'),
      },
      outputSchema: removeTagOutputSchema,
    },
    async ({ id, ids, tag }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        const outcome = await runBulkGuarded(() => removeTagMany(ids, tag));
        if (!outcome.ok) return outcome.error;
        const results = outcome.value.map(toBulkItemResult);
        return {
          content: [{ type: 'text', text: toBulkTextSummary(`Remove tag '${tag}'`, results) }],
          structuredContent: { found: false, batch: true, results },
        };
      }

      if (id === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `id` (single) or `ids` (batch) to remove_tag.' },
          ],
        };
      }

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
