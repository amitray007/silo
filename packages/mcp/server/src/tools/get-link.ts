import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LinkWithTags } from '@silo/core';
import { getById } from '@silo/core';
import { z } from 'zod';

/**
 * Agent-facing output shape for `get_link` — a WHITELIST (not a blacklist) of
 * `LinkWithTags` fields. Internal-only columns (`searchVector`, a raw
 * Postgres tsvector; `canonicalUrl`, which can carry an `#unsafe-<uuid>`
 * dedup suffix; `sourceData`, an internal blob; `deletedAt`, live-scoping
 * plumbing) are deliberately NOT named here, so a future `links` schema
 * column can never auto-leak into the agent-facing result — it would have to
 * be added to this shape explicitly.
 *
 * `found` discriminates the two cases (found vs. not-found/trashed). Per
 * docs/rules/mcp.md, a not-found id is a normal tool result, never a thrown
 * error — but SDK 1.29.0's `validateToolOutput` requires ANY non-error result
 * to carry `structuredContent` matching `outputSchema` once one is declared
 * (an empty structuredContent throws `"has an output schema but no
 * structured content was provided"`). So the link fields are `.optional()`
 * (present + populated only when `found: true`) rather than dropping
 * `outputSchema`/`structuredContent` on the not-found path.
 *
 * This is also the SDK's `outputSchema` raw shape (passed the same way
 * `inputSchema` is — a Zod raw shape object, not a wrapped `z.object`), so
 * the SDK validates every `structuredContent` response against it.
 */
const getLinkOutputShape = {
  found: z.boolean(),
  id: z.uuid().optional(),
  url: z.string().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  extractedText: z.string().nullable().optional(),
  sourceKind: z.string().optional(),
  captureStatus: z.enum(['enriching', 'full', 'partial', 'bare']).optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
};

type GetLinkStructuredContent = z.infer<z.ZodObject<typeof getLinkOutputShape>>;

/**
 * Builds `structuredContent` as an EXPLICIT field-by-field pick of the
 * whitelisted shape above — never a spread of `LinkWithTags`. This makes the
 * leak (`searchVector`/`canonicalUrl`/`sourceData`/`deletedAt`) structurally
 * impossible: adding a field here requires a conscious edit, not an
 * accidental one from a new DB column.
 */
function toStructuredContent(link: LinkWithTags): GetLinkStructuredContent {
  return {
    found: true,
    id: link.id,
    url: link.url,
    title: link.title,
    description: link.description,
    imageUrl: link.imageUrl,
    siteName: link.siteName,
    extractedText: link.extractedText,
    sourceKind: link.sourceKind,
    captureStatus: link.captureStatus,
    notes: link.notes,
    tags: link.tags,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

/**
 * Builds the `content[0].text` block. This channel is universally rendered
 * by MCP clients (unlike `structuredContent`, which a spec-conforming client
 * may ignore without a declared `outputSchema`), so it must independently
 * carry the "full detail" the tool's description promises — not just a
 * title/url/tags stub. `extractedText` is deliberately NOT dumped here (it
 * can be arbitrarily large); only its presence/length is noted, with the
 * full text left to `structuredContent`.
 */
function toTextSummary(link: LinkWithTags): string {
  const lines = [
    link.title ?? link.url,
    link.url,
    link.siteName ? `site: ${link.siteName}` : undefined,
    `status: ${link.captureStatus}`,
    link.description ? `description: ${link.description}` : undefined,
    `tags: ${link.tags.length > 0 ? link.tags.join(', ') : '(none)'}`,
    link.notes ? `note: ${link.notes}` : undefined,
    link.extractedText
      ? `full text: ${link.extractedText.length} chars (see structuredContent.extractedText)`
      : undefined,
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
}

/**
 * Registers `get_link` on `server`: parse (Zod) -> one `core.getById` call ->
 * shape the MCP result. Per docs/rules/mcp.md, all business logic (the
 * live-scoping, the tag hydration) lives in `core` already — this handler
 * only translates.
 */
export function registerGetLink(server: McpServer): void {
  server.registerTool(
    'get_link',
    {
      title: 'Get link',
      description:
        "Fetch one saved link's full detail by id: its metadata (url, title, " +
        'description, image, site name), extracted full text, tags, capture ' +
        'status, and notes. Returns a clean not-found result (not an error) ' +
        'if the id is unknown or the link has been trashed — trashed links ' +
        'are never returned. Use this after `search_links` or `list_links` ' +
        'to read one result in full.',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid) to fetch, as returned by search/list results.'),
      },
      outputSchema: getLinkOutputShape,
    },
    async ({ id }): Promise<CallToolResult> => {
      const link = await getById(id);
      if (!link) {
        return {
          content: [
            {
              type: 'text',
              text: `No link found with id ${id} (unknown or trashed).`,
            },
          ],
          structuredContent: { found: false },
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: toTextSummary(link),
          },
        ],
        structuredContent: toStructuredContent(link),
      };
    },
  );
}
