import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getById, restore, restoreMany } from '@silo/core';
import { z } from 'zod';
import {
  bulkItemResultShape,
  foundLinkOutputShape,
  runBulkGuarded,
  toBulkItemResult,
  toBulkTextSummary,
} from './found-result.js';
import { toBaseLinkContent } from './link-shape.js';

/**
 * `restore_link`'s `outputSchema`: the same whitelisted link-field shape
 * `foundLinkOutputShape` declares (all fields optional, so an outcome that
 * carries no link still validates), but with an `outcome` discriminator
 * carrying FOUR values instead of the plain `found` boolean the other write
 * tools use — `core.restore` returns a `RestoreResult` with three cases
 * (`restored`/`merged`/`not_found`), and the BATCH (`ids`) path adds a
 * fourth, `'batch'`, for a call whose real per-item outcomes live in
 * `results` (agent-navigation slice U4) rather than one top-level outcome —
 * `'batch'` is a distinct, honest value rather than overloading `not_found`
 * (which would misleadingly claim nothing was restored). Built by
 * destructuring `found` out of `foundLinkOutputShape` and spreading the
 * rest, rather than repeating the 13-field list here (jscpd flagged the
 * verbatim repeat).
 */
const { found: _found, ...restoreLinkOutputShape } = foundLinkOutputShape;
void _found;
const restoreLinkOutputSchema = {
  outcome: z.enum(['restored', 'merged', 'not_found', 'batch']),
  ...restoreLinkOutputShape,
  results: z.array(z.object(bulkItemResultShape)).optional(),
};

/**
 * Runs the batch (`ids`) branch: one `core.restoreMany` call via the shared
 * `runBulkGuarded` (turns an oversized batch's `TooManyIdsError` into a clean
 * tool error — F1, U4 adversarial review), then shapes the `outcome: 'batch'`
 * result. Factored out of the handler (mirrors `capture-link.ts`'s
 * `runBatchCapture`) to keep the handler's cognitive-complexity under
 * Biome's ceiling now that it also guards the oversized-batch case.
 */
async function runBatchRestore(ids: readonly string[]): Promise<CallToolResult> {
  const outcome = await runBulkGuarded(() => restoreMany(ids));
  if (!outcome.ok) return outcome.error;
  const results = outcome.value.map(toBulkItemResult);
  return {
    content: [{ type: 'text', text: toBulkTextSummary('Restore', results) }],
    structuredContent: { outcome: 'batch', results },
  };
}

/**
 * Registers `restore_link` on `server`: parse (Zod) -> one `core.restore`
 * call -> switch on its discriminated `RestoreResult` -> re-fetch via
 * `getById` to hydrate tags -> shape the MCP result.
 *
 * The `merged` case is the one that needs the most care: `core.restore`'s
 * doc comment explains that if a live link now occupies the same
 * `canonical_url` the trashed row had, restoring merges the trashed row's
 * notes/tags INTO that live row instead of colliding — so the link the agent
 * gets back has a DIFFERENT id than the one it asked to restore, and the
 * requested id no longer exists at all (it stays trashed, its data now
 * duplicated into the live row). The text says this explicitly, including
 * both ids, because silently returning a link under a different id than the
 * one requested — without calling that out — would be exactly the kind of
 * non-actionable result docs/rules/mcp.md's guidance rule forbids.
 */
export function registerRestoreLink(server: McpServer): void {
  server.registerTool(
    'restore_link',
    {
      title: 'Restore link',
      description:
        'Bring one or more trashed links back to live. Pass `id` for ONE ' +
        'link, or `ids` for MANY in one call (if both are given, `ids` ' +
        'wins) — the batch call returns a `results` array (`{ id, ok, ' +
        'reason? }`, a `merged` outcome still counts as `ok: true`) so one ' +
        'bad id never blocks the rest. If another live link has since been ' +
        'saved for the same url, the trashed link is instead merged into ' +
        'that existing live link (its notes/tags fold in) and the (single-' +
        'id) restored result comes back under the OTHER, already-live id — ' +
        'the result explains this when it happens. The single-`id` path ' +
        'returns a clean not-found result (not an error) if the id is ' +
        'unknown or not currently in the trash (e.g. it is already live).',
      inputSchema: {
        id: z.uuid().optional().describe('The link id (uuid) to restore (single-link mode).'),
        ids: z
          .array(z.uuid())
          .optional()
          .describe(
            'Link ids (uuids) to restore in one batch call, up to 500 per call. Wins over `id` if both are given.',
          ),
      },
      outputSchema: restoreLinkOutputSchema,
    },
    async ({ id, ids }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        return runBatchRestore(ids);
      }

      if (id === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `id` (single) or `ids` (batch) to restore_link.' },
          ],
        };
      }

      const res = await restore(id);

      if (res.status === 'not_found') {
        return {
          content: [
            {
              type: 'text',
              text:
                `Nothing to restore for id ${id} — it's unknown or not in ` +
                'the trash (it may already be live). Use list_links to find it.',
            },
          ],
          structuredContent: { outcome: 'not_found' },
        };
      }

      // Both `restored` and `merged` return a bare `Link` — re-fetch via
      // `getById` to hydrate tags before shaping, same pattern every other
      // write tool uses.
      const link = await getById(res.link.id);
      if (!link) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Restored link ${id} but could not re-fetch it immediately after; try get_link with id ${res.link.id} to confirm.`,
            },
          ],
        };
      }

      if (res.status === 'merged') {
        return {
          content: [
            {
              type: 'text',
              text:
                `The link you restored was merged into an existing live link ` +
                `(id ${res.link.id}) that already had the same URL — its notes ` +
                `and tags were folded in. The original id ${id} no longer ` +
                `exists as a live link; use id ${res.link.id} going forward.`,
            },
          ],
          structuredContent: { outcome: 'merged', ...toBaseLinkContent(link) },
        };
      }

      return {
        content: [{ type: 'text', text: `Restored link ${id} — it's live again.` }],
        structuredContent: { outcome: 'restored', ...toBaseLinkContent(link) },
      };
    },
  );
}
