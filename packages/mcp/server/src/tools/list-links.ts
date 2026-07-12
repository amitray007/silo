import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CountFilter, ListFilter, PageParams } from '@silo/core';
import { countLinks, InvalidCursorError, list } from '@silo/core';
import { z } from 'zod';
import { type SnippetLinkContent, snippetLinkShape, toSnippetLinkContent } from './link-shape.js';
import {
  countFieldsShape,
  isoDateTime,
  SOURCE_KIND_VALUES,
  toCountTextSummary,
} from './query-filters.js';

/**
 * `list_links`'s per-link output shape is the snippet whitelist
 * (`extractedText` dropped, `snippet` added — agent-navigation slice U4) —
 * unlike `search_links`'s shape, there is no `rank` (a browse listing
 * carries no relevance score) and unlike `get_link`, no `found`
 * discriminator: browsing always succeeds as a normal tool result — an
 * empty page is `links: [], count: 0`, never a not-found case — so every
 * field is always present.
 *
 * `count_only` mode (agent-navigation slice U4) reuses this SAME
 * `outputSchema`: `links`/`count`/`nextCursor` are omitted and the count
 * fields (`total`/`bySource`/`topTags`) are populated instead — see
 * `search-links.ts`'s identical `count_only`-mode doc comment for the
 * one-schema-two-shapes rationale.
 */
const listLinksOutputShape = {
  links: z.array(z.object(snippetLinkShape)).optional(),
  count: z.number().optional(),
  nextCursor: z.string().optional(),
  ...countFieldsShape,
};

type ListLinksStructuredContent = z.infer<z.ZodObject<typeof listLinksOutputShape>>;

/**
 * Builds the `content[0].text` block: a readable newest-first list,
 * independent of `structuredContent` (a spec-conforming client may ignore the
 * latter without a declared `outputSchema` — moot here since one is declared,
 * but the text channel is universally rendered regardless). Full
 * `extractedText` is never available here (list rows carry `snippet`, not
 * the full body) — same restraint as `get_link`'s and `search_links`'s text
 * summaries, now structural rather than a choice.
 */
function toTextSummary(links: SnippetLinkContent[], nextCursor?: string): string {
  if (links.length === 0) {
    return 'No links found.';
  }
  const lines = [`${links.length} link${links.length === 1 ? '' : 's'} (newest first):`];
  for (const link of links) {
    const tagsPart = link.tags.length > 0 ? ` [${link.tags.join(', ')}]` : '';
    const snippetPart = link.snippet ? ` — ${link.snippet}` : '';
    lines.push(`- ${link.title ?? link.url} — ${link.url}${tagsPart}${snippetPart}`);
  }
  if (nextCursor !== undefined) {
    lines.push('More links available (pass cursor to continue).');
  }
  return lines.join('\n');
}

/**
 * The subset of `list_links`'s parsed input that maps onto
 * `ListFilter`/`CountFilter`. Every field allows an explicit `undefined`
 * (not just `?`) — see `search-links.ts`'s identical `SearchLinksFilterInput`
 * doc comment for the `exactOptionalPropertyTypes` rationale.
 */
type ListLinksFilterInput = {
  tag?: string | undefined;
  tags?: string[] | undefined;
  status?: 'enriching' | 'full' | 'partial' | 'bare' | undefined;
  source?: (typeof SOURCE_KIND_VALUES)[number] | undefined;
  since?: string | undefined;
  until?: string | undefined;
};

/**
 * Builds `ListFilter` conditionally (not object-literal spread) — see
 * `search-links.ts`'s `buildSearchFilter` for the identical
 * `exactOptionalPropertyTypes` rationale. Factored out of the handler to
 * keep its cognitive-complexity under Biome's ceiling.
 */
function buildListFilter(input: ListLinksFilterInput): ListFilter {
  const filter: ListFilter = {};
  if (input.tag !== undefined) filter.tag = input.tag;
  if (input.tags !== undefined) filter.tags = input.tags;
  if (input.status !== undefined) filter.status = input.status;
  if (input.source !== undefined) filter.source = input.source;
  if (input.since !== undefined) filter.since = input.since;
  if (input.until !== undefined) filter.until = input.until;
  return filter;
}

/**
 * Builds `CountFilter` by delegating to `buildListFilter` (same field-by-
 * field conditional assignment, so the two can never drift) and dropping
 * `status` — `countLinks` has no `status` filter (counts are always over
 * live links, matching `list`'s default live scope — see its doc comment).
 */
function buildCountFilter(input: ListLinksFilterInput): CountFilter {
  const { status: _status, ...filter } = buildListFilter(input);
  void _status;
  return filter;
}

/** Runs the `count_only: true` branch: one `countLinks` call, shaped into `structuredContent`. */
async function runCountOnly(input: ListLinksFilterInput): Promise<CallToolResult> {
  const counts = await countLinks(buildCountFilter(input));
  const structuredContent: ListLinksStructuredContent = {
    total: counts.total,
    bySource: counts.bySource,
    topTags: counts.topTags,
  };
  return {
    content: [{ type: 'text', text: toCountTextSummary('match this filter', counts) }],
    structuredContent,
  };
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
        'exact tag name), `tags` (require ALL of several), `status` (capture ' +
        'status: enriching, full, partial, bare), `source`, and/or a ' +
        '`since`/`until` date range. Returns each link with its metadata, ' +
        'tags, and a short `snippet` excerpt (not the full text). This is ' +
        'BROWSE — a chronological, filterable listing, always newest-first — ' +
        'not relevance search; use `search_links` instead when looking for ' +
        "links matching keywords. To read a result's FULL text, call " +
        '`get_link` with its id. Set `count_only: true` to get just the ' +
        'total + a per-source/tag breakdown instead of rows. Paginate with ' +
        '`limit` (default 20, max 100) and the returned `nextCursor`: pass ' +
        'it back as `cursor` to fetch the next page; omit `cursor` for the ' +
        'first page. An empty `links` array means no matches, not an error.',
      inputSchema: {
        tag: z.string().optional().describe('Filter to links carrying this exact tag name.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Require ALL of these tags (case-insensitive AND-match).'),
        status: z
          .enum(['enriching', 'full', 'partial', 'bare'])
          .optional()
          .describe('Filter to links with this capture status.'),
        source: z
          .enum(SOURCE_KIND_VALUES)
          .optional()
          .describe('Filter to a single source: twitter, github, youtube, hacker_news, or link.'),
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
    async ({
      tag,
      tags,
      status,
      source,
      since,
      until,
      count_only: countOnly,
      limit,
      cursor,
    }): Promise<CallToolResult> => {
      const filterInput: ListLinksFilterInput = { tag, tags, status, source, since, until };

      if (countOnly) {
        return runCountOnly(filterInput);
      }

      const filter = buildListFilter(filterInput);
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

      const links = page.links.map(toSnippetLinkContent);
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
