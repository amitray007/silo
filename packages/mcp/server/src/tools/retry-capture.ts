import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getById, requestRetry } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, foundResult, notFoundResult } from './found-result.js';

/**
 * Registers `retry_capture` on `server`: parse (Zod) -> one
 * `core.requestRetry` call -> (on success) re-fetch via `getById` to hydrate
 * tags -> shape the MCP result. Same shape as `edit_link` (`edit-link.ts`'s
 * doc comment): `core.requestRetry` returns a bare `Link` (no `tags`), so a
 * successful retry re-fetches before shaping rather than echoing the bare row.
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
        'Re-run enrichment for a link whose capture was degraded (captureStatus ' +
        "'partial' or 'bare') or is stuck 'enriching' — resets its status back " +
        "to 'enriching' so the worker re-fetches and re-extracts it in the " +
        'background. Does nothing for a link that is already fully captured ' +
        "(status 'full'), unknown, or trashed — a good capture is never " +
        'downgraded by a retry. Enrichment runs ASYNCHRONOUSLY, same as ' +
        'capture_link: after calling retry_capture, call get_link with this ' +
        'id shortly after to see whether the re-capture succeeded. Typical ' +
        "loop: capture_link -> get_link shows 'partial'/'bare' -> " +
        'retry_capture -> get_link again.',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid) whose capture to retry.'),
      },
      outputSchema: foundLinkOutputShape,
    },
    async ({ id }): Promise<CallToolResult> => {
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
