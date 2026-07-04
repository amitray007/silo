import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ListFilter, PageParams } from '@silo/core';
import { InvalidCursorError, list } from '@silo/core';
import { z } from 'zod';
import { type BaseLinkContent, baseLinkShape, toBaseLinkContent } from './link-shape.js';

/**
 * `list_links`'s per-link output shape is just the shared whitelist — unlike
 * `search_links`'s shape, there is no `rank` (a browse listing carries no
 * relevance score) and unlike `get_link`, no `found` discriminator: browsing
 * always succeeds as a normal tool result — an empty page is `links: [],
 * count: 0`, never a not-found case — so every field is always present.
 */
const listLinksOutputShape = {
  links: z.array(z.object(baseLinkShape)),
  count: z.number(),
  nextCursor: z.string().optional(),
};

type ListLinksStructuredContent = z.infer<z.ZodObject<typeof listLinksOutputShape>>;

/**
 * Builds the `content[0].text` block: a readable newest-first list,
 * independent of `structuredContent` (a spec-conforming client may ignore the
 * latter without a declared `outputSchema` — moot here since one is declared,
 * but the text channel is universally rendered regardless). `extractedText`
 * is deliberately NOT dumped here (arbitrarily large) — same restraint as
 * `get_link`'s and `search_links`'s text summaries.
 */
function toTextSummary(links: BaseLinkContent[], nextCursor?: string): string {
  if (links.length === 0) {
    return 'No links found.';
  }
  const lines = [`${links.length} link${links.length === 1 ? '' : 's'} (newest first):`];
  for (const link of links) {
    const tagsPart = link.tags.length > 0 ? ` [${link.tags.join(', ')}]` : '';
    lines.push(`- ${link.title ?? link.url} — ${link.url}${tagsPart}`);
  }
  if (nextCursor !== undefined) {
    lines.push('More links available (pass cursor to continue).');
  }
  return lines.join('\n');
}

/**
 * Registers `list_links` on `server`: parse (Zod) -> one `core.list` call ->
 * shape the MCP result. Per docs/rules/mcp.md, all business logic (live-
 * scoping, tag/status filtering, tag hydration, keyset pagination) lives in
 * `core` already — this handler only translates, plus turns a forged/expired
 * cursor into a clean tool error instead of an uncaught throw (an external
 * agent WILL hand back stale cursors).
 */
export function registerListLinks(server: McpServer): void {
  server.registerTool(
    'list_links',
    {
      title: 'List links',
      description:
        'Browse saved links newest-first, optionally filtered by `tag` (an ' +
        'exact tag name) and/or `status` (capture status: enriching, full, ' +
        'partial, bare). Returns each link with its metadata and tags. This ' +
        'is BROWSE — a chronological, filterable listing — not relevance ' +
        'search; use `search_links` instead when looking for links matching ' +
        'keywords. Paginate with `limit` (default 20, max 100) and the ' +
        'returned `nextCursor`: pass it back as `cursor` to fetch the next ' +
        'page; omit `cursor` for the first page. An empty `links` array ' +
        'means no matches, not an error.',
      inputSchema: {
        tag: z.string().optional().describe('Filter to links carrying this exact tag name.'),
        status: z
          .enum(['enriching', 'full', 'partial', 'bare'])
          .optional()
          .describe('Filter to links with this capture status.'),
        limit: z
          .number()
          .int()
          .optional()
          .describe('Max links per page (default 20, clamped to [1, 100]).'),
        cursor: z
          .string()
          .optional()
          .describe(
            "Opaque pagination cursor from a previous call's nextCursor. Omit for the first page.",
          ),
      },
      outputSchema: listLinksOutputShape,
    },
    async ({ tag, status, limit, cursor }): Promise<CallToolResult> => {
      // Built conditionally (not object-literal spread) because
      // `exactOptionalPropertyTypes` makes `ListFilter`/`PageParams`'s
      // optional fields reject an explicit `undefined` — the input schema's
      // `.optional()` fields come through as `undefined` when omitted, so
      // each is only assigned when actually present.
      const filter: ListFilter = {};
      if (tag !== undefined) filter.tag = tag;
      if (status !== undefined) filter.status = status;

      const pageParams: PageParams = {};
      if (limit !== undefined) pageParams.limit = limit;
      if (cursor !== undefined) pageParams.cursor = cursor;

      let page: Awaited<ReturnType<typeof list>>;
      try {
        page = await list(filter, pageParams);
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Invalid or expired cursor; omit cursor to restart from the first page.',
              },
            ],
          };
        }
        throw error;
      }

      const links = page.links.map(toBaseLinkContent);
      const structuredContent: ListLinksStructuredContent =
        page.nextCursor === undefined
          ? { links, count: links.length }
          : { links, count: links.length, nextCursor: page.nextCursor };

      return {
        content: [
          {
            type: 'text',
            text: toTextSummary(links, page.nextCursor),
          },
        ],
        structuredContent,
      };
    },
  );
}
