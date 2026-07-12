import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { addTag, addTagMany, getById } from '@silo/core';
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

const addTagOutputSchema = {
  ...foundLinkOutputShape,
  results: z.array(z.object(bulkItemResultShape)).optional(),
};

/**
 * Registers `add_link_tag` on `server`: parse (Zod) -> GUARD with `getById`
 * (single) or one `core.addTagMany` call (batch) -> shape the MCP result.
 *
 * One-or-many (agent-navigation slice U4): `id` (single) OR `ids` (batch) —
 * `ids` wins if both are given (documented in the tool description, same
 * precedence rule `get_link` uses). The SINGLE path is UNCHANGED behavior:
 * the `getById` guard is required, not optional, because `core.addTag` is
 * NOT live-scoped and will FK-throw on a bogus id or silently tag an
 * already-trashed link — checking `getById(id)` first (live-scoped) turns
 * both the unknown-id and trashed-id cases into a clean `found: false`
 * result before `core.addTag` ever runs. The BATCH path delegates that same
 * guard logic to `core.addTagMany`, which already reports a bad id as a
 * per-item `ok: false` (see its doc comment) rather than duplicating the
 * guard here.
 */
export function registerAddLinkTag(server: McpServer): void {
  server.registerTool(
    'add_link_tag',
    {
      title: 'Add tag to link',
      description:
        'Attach a tag to one or more saved links. Pass `id` for ONE link, or ' +
        '`ids` for MANY in one call (if both are given, `ids` wins) — the ' +
        'batch call returns a `results` array (`{ id, ok, reason? }`) so one ' +
        'bad id never blocks the rest. Matching is case-insensitive: adding ' +
        "'ai' to a link that already has 'AI' is a no-op (one tag survives, " +
        'keeping whichever casing was entered first) — this call is safe to ' +
        'repeat. If the tag does not exist yet, it is created automatically ' +
        '(same effect as `create_tag`, just implicit) — use `create_tag` ' +
        'instead if you want to make an empty tag ahead of time, with no ' +
        'link attached yet. The single-`id` path returns a clean not-found ' +
        'result (not an error) if the id is unknown or the link has been ' +
        'trashed (trashed links cannot be tagged).',
      inputSchema: {
        id: z.uuid().optional().describe('The link id (uuid) to tag (single-link mode).'),
        ids: z
          .array(z.uuid())
          .optional()
          .describe(
            'Link ids (uuids) to tag in one batch call, up to 500 per call. Wins over `id` if both are given.',
          ),
        tag: z.string().min(1).describe('The tag name to attach (matched case-insensitively).'),
      },
      outputSchema: addTagOutputSchema,
    },
    async ({ id, ids, tag }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        const outcome = await runBulkGuarded(() => addTagMany(ids, tag));
        if (!outcome.ok) return outcome.error;
        const results = outcome.value.map(toBulkItemResult);
        return {
          content: [{ type: 'text', text: toBulkTextSummary(`Add tag '${tag}'`, results) }],
          structuredContent: { found: false, batch: true, results },
        };
      }

      if (id === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `id` (single) or `ids` (batch) to add_link_tag.' },
          ],
        };
      }

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
