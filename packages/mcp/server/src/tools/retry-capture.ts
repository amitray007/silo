import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ENRICH_FIELD_DESCRIPTIONS,
  ENRICH_FIELDS,
  type EnrichField,
  enrichFieldSchema,
  getById,
  requestEnrich,
  retryCaptureMany,
} from '@silo/core';
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
 * `core.requestEnrich` call (single) or `core.retryCaptureMany` (batch) ->
 * (on success) re-fetch via `getById` to hydrate tags -> shape the MCP
 * result. Same shape as `edit_link` (`edit-link.ts`'s doc comment):
 * `core.requestEnrich` returns a bare `Link` (no `tags`), so a successful
 * single-id retry re-fetches before shaping rather than echoing the bare row.
 *
 * One-or-many (agent-navigation slice U4): `id`/`ids` precedence mirrors
 * `add_link_tag`'s — `ids` wins if both given.
 *
 * Closes an agent-native parity gap (scope.html Now-tier): a human UI can
 * retry a degraded capture, and core has `requestEnrich` — this
 * is the MCP wrapper so an agent has the same capability.
 */
export function registerRetryCapture(server: McpServer): void {
  server.registerTool(
    'retry_capture',
    {
      title: 'Retry capture',
      description:
        'Re-run enrichment for live links, including complete links. ' +
        'Pass id for one link or ids for a batch of up to 500; ids wins if both are given. ' +
        'Unknown or trashed links are not changed. Batch results report each id separately. ' +
        'Leave fields out for a full run. A narrow run writes only the requested fields, ' +
        'keeps user-edited titles and restores the previous capture status. ' +
        'Enrichment runs asynchronously; call get_link with the id(s) shortly after to see the result.\n\n' +
        '| Field | Writes and work |\n| --- | --- |\n' +
        ENRICH_FIELDS.map((field) => `| ${field} | ${ENRICH_FIELD_DESCRIPTIONS[field]} |`).join(
          '\n',
        ) +
        '\n\nX title backfill: retry_capture { ids: [<saved X post ids>], fields: ["title"] } ' +
        'uses stored post text without fetching x.com or rendering Reader. ' +
        'If AI titles are off or unavailable, X title writes nothing; enable AI titles before retrying.',
      inputSchema: {
        fields: z
          .array(enrichFieldSchema)
          .min(1)
          .optional()
          .describe(
            'Re-enrich only these fields. Leave out for a full run. See each choice for writes and work.',
          ),
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
    async ({ id, ids, fields }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        const outcome = await runBulkGuarded(() =>
          fields === undefined ? retryCaptureMany(ids) : retryCaptureMany(ids, { fields }),
        );
        if (!outcome.ok) return outcome.error;
        const results = outcome.value.map(toBulkItemResult);
        return {
          content: [{ type: 'text', text: batchText(fields, results) }],
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

      const retried =
        fields === undefined ? await requestEnrich(id) : await requestEnrich(id, { fields });
      if (!retried) {
        return notFoundResult(
          `Could not retry link ${id} — it's either unknown or trashed. Use ` +
            'get_link to check its current status, or list_links to find it.',
        );
      }

      // `requestEnrich` returns a bare `Link` (no `tags`) — re-fetch via
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

      return foundResult(link, singleText(id, fields));
    },
  );
}

function targetedText(fields: readonly EnrichField[], count: number): string {
  const titleNote = fields.includes('title')
    ? ' For X title, AI off or unavailable means no title change; enable AI titles before retrying.'
    : '';
  return `Re-enriching ${fields.join(', ')} for ${count} ${count === 1 ? 'link' : 'links'}.${titleNote}`;
}

function batchText(
  fields: readonly EnrichField[] | undefined,
  results: ReturnType<typeof toBulkItemResult>[],
): string {
  const summary = toBulkTextSummary('Retry capture', results);
  if (!fields) return summary;
  const count = results.filter((result) => result.ok).length;
  return `${targetedText(fields, count)}\n${summary}\nCall get_link with the id(s) shortly to see the result.`;
}

function singleText(id: string, fields: readonly EnrichField[] | undefined): string {
  if (fields) {
    return `${targetedText(fields, 1)} Call get_link with id ${id} shortly to see the result.`;
  }
  return (
    `Retrying capture for ${id} - status reset to 'enriching'. The ` +
    'worker will re-fetch and re-extract in the background; call ' +
    'get_link with this id shortly to see the result.'
  );
}
