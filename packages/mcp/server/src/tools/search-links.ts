import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LinkWithTags, PageParams } from '@silo/core';
import { InvalidCursorError, search } from '@silo/core';
import { z } from 'zod';
import { baseLinkShape, toBaseLinkContent } from './link-shape.js';

/**
 * Agent-facing output shape for one `search_links` result — the shared
 * whitelist (`./link-shape.js`) plus `rank` (the full-text relevance score)
 * on top — a search result carries relevance, a plain `get_link`/`list_links`
 * fetch doesn't.
 */
const searchResultShape = {
  ...baseLinkShape,
  rank: z.number(),
};

/**
 * `search_links`'s `outputSchema` raw shape (passed the same way
 * `inputSchema` is). Unlike `get_link`, there is no `found` discriminator: a
 * search always succeeds as a normal tool result — an empty match is
 * `results: [], count: 0`, never a not-found case — so every field here is
 * always present (no `.optional()` needed to satisfy the SDK's
 * `validateToolOutput` on an empty-result path, since `results`/`count` are
 * always populated).
 */
const searchLinksOutputShape = {
  results: z.array(z.object(searchResultShape)),
  count: z.number(),
  nextCursor: z.string().optional(),
};

type SearchLinksStructuredContent = z.infer<z.ZodObject<typeof searchLinksOutputShape>>;
type SearchResultContent = z.infer<z.ZodObject<typeof searchResultShape>>;

/**
 * Builds one result's `structuredContent` entry: the shared whitelist pick
 * (`toBaseLinkContent`) plus `rank` — never a spread of `LinkWithTags & {
 * rank: number }`. Same rationale as `link-shape.ts`'s doc: makes the leak
 * (`searchVector`/`canonicalUrl`/`sourceData`/`deletedAt`) structurally
 * impossible.
 */
function toResultContent(result: LinkWithTags & { rank: number }): SearchResultContent {
  return { ...toBaseLinkContent(result), rank: result.rank };
}

/**
 * Builds the `content[0].text` block: a readable ranked list, independent of
 * `structuredContent` (a spec-conforming client may ignore the latter without
 * a declared `outputSchema` — moot here since one is declared, but the text
 * channel is universally rendered regardless). `extractedText` is
 * deliberately NOT dumped here (arbitrarily large) — same restraint as
 * `get_link`'s text summary.
 */
function toTextSummary(query: string, results: SearchResultContent[], nextCursor?: string): string {
  if (results.length === 0) {
    return `No results for "${query}".`;
  }
  const lines = [`${results.length} result${results.length === 1 ? '' : 's'} for "${query}":`];
  for (const result of results) {
    const tagsPart = result.tags.length > 0 ? ` [${result.tags.join(', ')}]` : '';
    lines.push(
      `- (rank ${result.rank.toFixed(3)}) ${result.title ?? result.url} — ${result.url}${tagsPart}`,
    );
  }
  if (nextCursor !== undefined) {
    lines.push('More results available (pass cursor to continue).');
  }
  return lines.join('\n');
}

/**
 * Registers `search_links` on `server`: parse (Zod) -> one `core.search` call
 * -> shape the MCP result. Per docs/rules/mcp.md, all business logic (the
 * `websearch_to_tsquery` ranking, live-scoping, tag hydration, offset
 * pagination) lives in `core` already — this handler only translates, plus
 * turns a forged/expired cursor into a clean tool error instead of an
 * uncaught throw (an external agent WILL hand back stale cursors).
 */
export function registerSearchLinks(server: McpServer): void {
  server.registerTool(
    'search_links',
    {
      title: 'Search links',
      description:
        "Full-text search over saved links' title, description, and extracted " +
        'text. Returns matches ranked by relevance (best match first), each ' +
        "with the link's metadata, tags, and a numeric relevance rank. This is " +
        'KEYWORD/full-text search, not semantic search — phrase `query` as ' +
        'search terms (e.g. "rust async runtime"), not a natural-language ' +
        'question. Paginate with `limit` (default 20, max 100) and the ' +
        'returned `nextCursor`: pass it back as `cursor` to fetch the next ' +
        'page; omit `cursor` for the first page. An empty `results` array ' +
        'means no matches, not an error.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Search terms (keyword/full-text query, not a natural-language question).'),
        limit: z
          .number()
          .int()
          .optional()
          .describe('Max results per page (default 20, clamped to [1, 100]).'),
        cursor: z
          .string()
          .optional()
          .describe(
            "Opaque pagination cursor from a previous call's nextCursor. Omit for the first page.",
          ),
      },
      outputSchema: searchLinksOutputShape,
    },
    async ({ query, limit, cursor }): Promise<CallToolResult> => {
      // Built conditionally (not `{ limit, cursor }` spread) because
      // `exactOptionalPropertyTypes` makes `PageParams`'s optional fields
      // reject an explicit `undefined` — the input schema's `.optional()`
      // fields come through as `undefined` when omitted, so each is only
      // assigned when actually present.
      const pageParams: PageParams = {};
      if (limit !== undefined) pageParams.limit = limit;
      if (cursor !== undefined) pageParams.cursor = cursor;

      let page: Awaited<ReturnType<typeof search>>;
      try {
        page = await search(query, pageParams);
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

      const results = page.results.map(toResultContent);
      const structuredContent: SearchLinksStructuredContent =
        page.nextCursor === undefined
          ? { results, count: results.length }
          : { results, count: results.length, nextCursor: page.nextCursor };

      return {
        content: [
          {
            type: 'text',
            text: toTextSummary(query, results, page.nextCursor),
          },
        ],
        structuredContent,
      };
    },
  );
}
