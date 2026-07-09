import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { exportLinks } from '@silo/core';
import { z } from 'zod';

/**
 * `export_links`'s `structuredContent` shape — deliberately minimal (`format`
 * + `count`), NOT the exported links themselves. The full snapshot lives in
 * `content[0].text` (see `registerExportLinks`'s doc comment for why); this
 * is just enough structured metadata for an agent to confirm what it got
 * back without re-parsing the text body.
 *
 * This is also the SDK's `outputSchema` raw shape (passed the same way
 * `inputSchema` is — a Zod raw shape object, not a wrapped `z.object`), so
 * SDK 1.29.0's `validateToolOutput` validates every `structuredContent`
 * response against it. Per `get-link.ts`'s doc comment: once `outputSchema`
 * is declared, ANY non-error result MUST carry a matching `structuredContent`
 * or the SDK throws `"has an output schema but no structured content was
 * provided"`. `export_links` has no not-found/error branch that skips this —
 * every successful call returns both fields, so that failure mode can't arise
 * here.
 */
const exportLinksOutputShape = {
  format: z.string(),
  count: z.number(),
};

type ExportLinksStructuredContent = z.infer<z.ZodObject<typeof exportLinksOutputShape>>;

/**
 * Registers `export_links` on `server`: parse (Zod) -> one `core.exportLinks`
 * call -> shape the MCP result. Per docs/rules/mcp.md, all business logic
 * (the live-scoping query, tag hydration, per-format serialization) lives in
 * `core` already — this handler only translates.
 *
 * Unlike every other read tool here (`get_link`/`search_links`/`list_links`),
 * this is NOT a bounded, paginated result — it is a deliberate full-library
 * snapshot (design spec: a backup + whole-library feed-to-agent use case), so
 * the entire serialized body is placed in `content[0].text` rather than
 * summarized. `structuredContent` intentionally stays tiny (`format`+`count`
 * only) — echoing the full link set there too would duplicate the (large)
 * text payload for no benefit.
 */
export function registerExportLinks(server: McpServer): void {
  server.registerTool(
    'export_links',
    {
      title: 'Export links',
      description:
        'Export the FULL library as a single snapshot, in `json` (default), ' +
        '`yaml`, or `csv`. JSON and YAML are lossless full backups — every ' +
        'link, including its nested `sourceData` and full `extractedText`. ' +
        'CSV is a flat, partial view: one row per link with only the ' +
        'top-level fields (no `sourceData`, no `extractedText`) — use it for ' +
        'a spreadsheet-friendly list, not a full backup. The output can be ' +
        'LARGE — this is intentional. Unlike `list_links`/`search_links`, ' +
        'this tool is not paginated or summarized: it is meant to be ' +
        'ingested by the agent as a whole-library snapshot in one call, e.g. ' +
        'for backup, migration, or bulk analysis.',
      inputSchema: {
        format: z
          .enum(['json', 'yaml', 'csv'])
          .optional()
          .describe(
            'Export format — json (default) and yaml are lossless full ' +
              'backups (include sourceData + extractedText); csv is a flat ' +
              'partial view.',
          ),
      },
      outputSchema: exportLinksOutputShape,
    },
    async ({ format }): Promise<CallToolResult> => {
      // Conditional (not object-literal spread) because
      // `exactOptionalPropertyTypes` makes `exportLinks`'s optional `format`
      // reject an explicit `undefined` — the input schema's `.optional()`
      // field comes through as `undefined` when omitted, so it's only
      // assigned when actually present.
      const result = await exportLinks(format ? { format } : {});

      const structuredContent: ExportLinksStructuredContent = {
        format: result.format,
        count: result.count,
      };

      return {
        content: [
          {
            type: 'text',
            text: result.body,
          },
        ],
        structuredContent,
      };
    },
  );
}
