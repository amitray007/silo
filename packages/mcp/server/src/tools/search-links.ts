import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PageParams, SearchFilter, SearchResultRow } from '@silo/core';
import { countLinks, InvalidCursorError, search } from '@silo/core';
import { z } from 'zod';
import { snippetLinkShape, toRankedResultLine, toSnippetLinkContent } from './link-shape.js';
import {
  countFieldsShape,
  isoDateTime,
  SOURCE_KIND_VALUES,
  toCountTextSummary,
} from './query-filters.js';

/**
 * Agent-facing output shape for one `search_links` result — the snippet
 * whitelist (`./link-shape.js`, `extractedText` dropped, `snippet` added —
 * agent-navigation slice U4) plus `rank` (the full-text relevance score) on
 * top — a search result carries relevance, a plain `get_link`/`list_links`
 * fetch doesn't. Full text is opt-in via `get_link`.
 */
const searchResultShape = {
  ...snippetLinkShape,
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
 *
 * `count_only` mode (agent-navigation slice U4) reuses this SAME
 * `outputSchema`: `results`/`count`/`nextCursor` are omitted and the count
 * fields (`total`/`bySource`/`topTags`) are populated instead — all of
 * `results`/`count`/`total`/`bySource`/`topTags` are `.optional()` so both
 * shapes validate against one declared schema (no second `registerTool`, no
 * new tool — `count_only` is a MODE of this one, per the spec's guiding
 * constraint).
 */
const searchLinksOutputShape = {
  results: z.array(z.object(searchResultShape)).optional(),
  count: z.number().optional(),
  nextCursor: z.string().optional(),
  ...countFieldsShape,
};

type SearchLinksStructuredContent = z.infer<z.ZodObject<typeof searchLinksOutputShape>>;
type SearchResultContent = z.infer<z.ZodObject<typeof searchResultShape>>;

/**
 * Builds one result's `structuredContent` entry: the snippet whitelist pick
 * (`toSnippetLinkContent`) plus `rank` — never a spread of `SearchResultRow`.
 * Same rationale as `link-shape.ts`'s doc: makes the leak
 * (`searchVector`/`canonicalUrl`/`deletedAt`) structurally impossible.
 */
function toResultContent(result: SearchResultRow): SearchResultContent {
  return { ...toSnippetLinkContent(result), rank: result.rank };
}

/**
 * Builds the `content[0].text` block: a readable ranked list, independent of
 * `structuredContent` (a spec-conforming client may ignore the latter without
 * a declared `outputSchema` — moot here since one is declared, but the text
 * channel is universally rendered regardless). Full `extractedText` is never
 * available here (search results carry `snippet`, not the full body) — same
 * restraint as `get_link`'s text summary, now structural rather than a
 * choice.
 */
function toTextSummary(query: string, results: SearchResultContent[], nextCursor?: string): string {
  if (results.length === 0) {
    return `No results for "${query}".`;
  }
  const lines = [`${results.length} result${results.length === 1 ? '' : 's'} for "${query}":`];
  for (const result of results) {
    lines.push(toRankedResultLine(result));
  }
  if (nextCursor !== undefined) {
    lines.push('More results available (pass cursor to continue).');
  }
  return lines.join('\n');
}

/**
 * The subset of `search_links`'s parsed input that maps onto `SearchFilter`.
 * Every field allows an explicit `undefined` (not just `?`) because the
 * caller passes the handler's destructured params straight through, and
 * those come through as `undefined` (not absent) when the agent omits them
 * — `exactOptionalPropertyTypes` distinguishes the two, so `field?: T`
 * (absent-only) would reject that call site.
 */
type SearchLinksFilterInput = {
  source?: (typeof SOURCE_KIND_VALUES)[number] | undefined;
  tags?: string[] | undefined;
  since?: string | undefined;
  until?: string | undefined;
  sort?: 'relevance' | 'newest' | 'oldest' | undefined;
};

/**
 * Builds `SearchFilter` conditionally (not object-literal spread) because
 * `exactOptionalPropertyTypes` makes its optional fields reject an explicit
 * `undefined` — the input schema's `.optional()` fields come through as
 * `undefined` when omitted, so each is only assigned when actually present.
 * Factored out of the handler to keep its cognitive-complexity under Biome's
 * ceiling (the handler otherwise ORs six independent optional-field checks
 * inline, on top of its two response branches).
 */
function buildSearchFilter(input: SearchLinksFilterInput): SearchFilter {
  const filter: SearchFilter = {};
  if (input.source !== undefined) filter.source = input.source;
  if (input.tags !== undefined) filter.tags = input.tags;
  if (input.since !== undefined) filter.since = input.since;
  if (input.until !== undefined) filter.until = input.until;
  if (input.sort !== undefined) filter.sort = input.sort;
  return filter;
}

/**
 * Runs the `count_only: true` branch: one `countLinks` call, shaped into
 * `structuredContent`. Per docs/rules/mcp.md, this handler otherwise
 * dispatches straight to `core.search`/`core.countLinks` — see this file's
 * top-level doc comment above `registerSearchLinks`.
 */
async function runCountOnly(query: string, filter: SearchFilter): Promise<CallToolResult> {
  const counts = await countLinks({ query, ...filter });
  const structuredContent: SearchLinksStructuredContent = {
    total: counts.total,
    bySource: counts.bySource,
    topTags: counts.topTags,
  };
  return {
    content: [{ type: 'text', text: toCountTextSummary(`match "${query}"`, counts) }],
    structuredContent,
  };
}

/**
 * Registers `search_links` on `server`: parse (Zod) -> one `core.search` call
 * -> shape the MCP result. Per docs/rules/mcp.md, all business logic (the
 * `websearch_to_tsquery` ranking, live-scoping, tag hydration, offset
 * pagination) lives in `core` already — this handler only translates, plus
 * turns a forged/expired cursor into a clean tool error instead of an
 * uncaught throw (an external agent WILL hand back stale cursors).
 *
 * `isoDateTime`/`SOURCE_KIND_VALUES`/`toCountTextSummary` are shared with
 * `list_links` via `./query-filters.js` (factored out once both tools'
 * near-identical declarations were flagged as a jscpd clone).
 */
export function registerSearchLinks(server: McpServer): void {
  server.registerTool(
    'search_links',
    {
      title: 'Search links',
      description:
        "Full-text search over saved links' title, description, extracted " +
        'text, notes, and tags. Returns matches ranked by relevance (best ' +
        "match first) by default, each with the link's metadata, tags, a " +
        'numeric relevance rank, and a short `snippet` — a highlighted ' +
        'excerpt around the matched terms (the `**...**` markers denote the ' +
        'match; they may occasionally collide with literal `**` already in ' +
        'the text, so treat them as hints, not structure). This is ' +
        'KEYWORD/full-text search, not semantic search — phrase `query` as ' +
        'search terms (e.g. "rust async runtime"), not a natural-language ' +
        "question. To read a result's FULL text (not just the snippet), " +
        'call `get_link` with its id. Narrow with `source`, `tags`, ' +
        '`since`/`until`, and `sort`. Set `count_only: true` to get just the ' +
        'total + a per-source/tag breakdown instead of result rows — use ' +
        'that to see the shape of the corpus before drilling in. Paginate ' +
        'with `limit` (default 20, max 100) and the returned `nextCursor`: ' +
        'pass it back as `cursor` to fetch the next page; omit `cursor` for ' +
        'the first page. An empty `results` array means no matches, not an error.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Search terms (keyword/full-text query, not a natural-language question).'),
        source: z
          .enum(SOURCE_KIND_VALUES)
          .optional()
          .describe('Filter to a single source: twitter, github, youtube, hacker_news, or link.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Require ALL of these tags (case-insensitive AND-match).'),
        since: isoDateTime
          .optional()
          .describe(
            'Date-only (YYYY-MM-DD) or full ISO 8601 datetime (with Z or a numeric offset); only links captured on/after this instant. Malformed values are rejected with a clean error.',
          ),
        until: isoDateTime
          .optional()
          .describe(
            'Date-only (YYYY-MM-DD) or full ISO 8601 datetime (with Z or a numeric offset); only links captured strictly before this instant. Malformed values are rejected with a clean error.',
          ),
        sort: z
          .enum(['relevance', 'newest', 'oldest'])
          .optional()
          .describe(
            "Result order (default 'relevance'). 'newest'/'oldest' order by capture date " +
              'instead — the query still FILTERS results, it just stops ranking them.',
          ),
        count_only: z
          .boolean()
          .optional()
          .describe(
            'Return just the total + per-source + top-tags breakdown, no result rows; use ' +
              'to see the shape of the corpus before drilling in.',
          ),
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
    async ({
      query,
      source,
      tags,
      since,
      until,
      sort,
      count_only: countOnly,
      limit,
      cursor,
    }): Promise<CallToolResult> => {
      const filter = buildSearchFilter({ source, tags, since, until, sort });

      if (countOnly) {
        return runCountOnly(query, filter);
      }

      // Built conditionally (not object-literal spread) — see
      // `buildSearchFilter`'s doc comment for the `exactOptionalPropertyTypes`
      // rationale, which applies identically to `PageParams` here.
      const pageParams: PageParams = {};
      if (limit !== undefined) pageParams.limit = limit;
      if (cursor !== undefined) pageParams.cursor = cursor;

      let page: Awaited<ReturnType<typeof search>>;
      try {
        page = await search(query, filter, pageParams);
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
