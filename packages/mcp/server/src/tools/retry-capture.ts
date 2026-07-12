import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getById, requestRetry, retryCaptureMany } from '@silo/core';
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

const retryCaptureOutputSchema = {
  ...foundLinkOutputShape,
  results: z.array(z.object(bulkItemResultShape)).optional(),
};

/**
 * Registers `retry_capture` on `server`: parse (Zod) -> one
 * `core.requestRetry` call (single) or `core.retryCaptureMany` (batch) ->
 * (on success) re-fetch via `getById` to hydrate tags -> shape the MCP
 * result. Same shape as `edit_link` (`edit-link.ts`'s doc comment):
 * `core.requestRetry` returns a bare `Link` (no `tags`), so a successful
 * single-id retry re-fetches before shaping rather than echoing the bare row.
 *
 * One-or-many (agent-navigation slice U4): `id`/`ids` precedence mirrors
 * `add_tag`'s — `ids` wins if both given.
 *
 * Closes an agent-native parity gap (scope.html Now-tier): a human UI can
 * retry a degraded capture, and core already has `requestRetry` (U4) — this
 * is the MCP wrapper so an agent has the same capability.
 */
export function registerRetryCapture(server: McpServer): void {
  server.registerTool(
    'retry_capture',
    {
      title: 'Retry capture',
      description:
        'Re-run enrichment for one or more links whose capture was degraded ' +
        "(captureStatus 'partial' or 'bare') or is stuck 'enriching' — " +
        "resets status back to 'enriching' so the worker re-fetches and " +
        're-extracts in the background. Pass `id` for ONE link, or `ids` ' +
        'for MANY in one call (if both are given, `ids` wins) — the batch ' +
        'call returns a `results` array (`{ id, ok, reason? }`) so one bad ' +
        'id never blocks the rest. Does nothing for a link that is already ' +
        "fully captured (status 'full'), unknown, or trashed — a good " +
        'capture is never downgraded by a retry. Enrichment runs ' +
        'ASYNCHRONOUSLY, same as capture_link: after calling retry_capture, ' +
        'call get_link with the id(s) shortly after to see whether the ' +
        're-capture succeeded. Typical loop: capture_link -> get_link shows ' +
        "'partial'/'bare' -> retry_capture -> get_link again.",
      inputSchema: {
        id: z.uuid().optional().describe('The link id (uuid) to retry (single-link mode).'),
        ids: z
          .array(z.uuid())
          .optional()
          .describe(
            'Link ids (uuids) to retry in one batch call, up to 500 per call. Wins over `id` if both are given.',
          ),
      },
      outputSchema: retryCaptureOutputSchema,
    },
    async ({ id, ids }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        const outcome = await runBulkGuarded(() => retryCaptureMany(ids));
        if (!outcome.ok) return outcome.error;
        const results = outcome.value.map(toBulkItemResult);
        return {
          content: [{ type: 'text', text: toBulkTextSummary('Retry capture', results) }],
          structuredContent: { found: false, batch: true, results },
        };
      }

      if (id === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `id` (single) or `ids` (batch) to retry_capture.' },
          ],
        };
      }

      const retried = await requestRetry(id);
      if (!retried) {
        return notFoundResult(
          `Could not retry link ${id} — it's either unknown, trashed, or ` +
            "already fully captured (status 'full', nothing to retry). Use " +
            'get_link to check its current status, or list_links to find it.',
        );
      }

      // `requestRetry` returns a bare `Link` (no `tags`) — re-fetch via
      // `getById` to hydrate tags before shaping, same pattern `edit_link`
      // established.
      const link = await getById(id);
      if (!link) {
        // Shouldn't happen immediately after a successful live-scoped retry,
        // but guarded rather than asserted — a clean tool error beats a
        // thrown TypeError on `null`.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Retried link ${id} but could not re-fetch it immediately after; try get_link with id ${id} to confirm.`,
            },
          ],
        };
      }

      return foundResult(
        link,
        `Retrying capture for ${id} — status reset to 'enriching'. The ` +
          'worker will re-fetch and re-extract in the background; call ' +
          'get_link with this id shortly to see the result.',
      );
    },
  );
}
