import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { findRelated } from '@silo/core';
import { z } from 'zod';
import { snippetLinkShape, toRankedResultLine, toSnippetLinkContent } from './link-shape.js';

/**
 * `find_related`'s per-result output shape (agent-navigation slice U4): the
 * SAME snippet whitelist `search_links` uses (`./link-shape.js` —
 * `extractedText` dropped, `snippet` added) plus `rank` — `core.findRelated`
 * is a seeded `search()` call under the hood, so its result rows carry the
 * exact same `SearchResultRow` shape (see `related.ts`'s doc comment).
 */
const relatedResultShape = {
  ...snippetLinkShape,
  rank: z.number(),
};

/**
 * `find_related`'s `outputSchema` raw shape. Unlike `get_link`, there is no
 * `found` discriminator: an unknown/trashed seed id or a seed with no
 * mechanical signal (no tags, no significant title words) both resolve to
 * an empty `results: []` — a normal, non-error tool result (see
 * `core.findRelated`'s doc comment for both documented empty-result cases) —
 * so every field here is always present.
 */
const findRelatedOutputShape = {
  results: z.array(z.object(relatedResultShape)),
  count: z.number(),
};

type FindRelatedStructuredContent = z.infer<z.ZodObject<typeof findRelatedOutputShape>>;
type RelatedResultContent = z.infer<z.ZodObject<typeof relatedResultShape>>;

/**
 * Builds the `content[0].text` block: a readable list of related links,
 * independent of `structuredContent`. Full `extractedText` is never
 * available here (results carry `snippet`, same restraint as
 * `search_links`/`list_links`).
 */
function toTextSummary(id: string, results: RelatedResultContent[]): string {
  if (results.length === 0) {
    return `No links related to ${id} (unknown/trashed id, or the link has no tags or usable title terms to relate from).`;
  }
  const lines = [`${results.length} link${results.length === 1 ? '' : 's'} related to ${id}:`];
  for (const result of results) {
    lines.push(toRankedResultLine(result));
  }
  return lines.join('\n');
}

/**
 * Registers `find_related` on `server`: parse (Zod) -> one
 * `core.findRelated` call -> shape the MCP result. Per docs/rules/mcp.md,
 * all business logic (the seeded search, term extraction, ranking) lives in
 * `core` already — this handler only translates.
 *
 * The ONE genuinely new tool this slice adds (agent-navigation spec's
 * guiding constraint: "never grow tool count or overlap jobs" — every other
 * change is a richer input/leaner output on an EXISTING tool). Distinct job
 * from `search_links` ("start from a link I have" vs. "start from words"),
 * so it adds power without adding a "which tool?" decision.
 */
export function registerFindRelated(server: McpServer): void {
  server.registerTool(
    'find_related',
    {
      title: 'Find related links',
      description:
        'Given a saved link, find OTHER saved links related to it by shared ' +
        'tags and title terms — "more like this". Use to explore outward ' +
        'from a link you have already found (via search_links, list_links, ' +
        'or get_link), when you want its neighborhood rather than a fresh ' +
        'keyword search. Distinct from `search_links`, which starts from ' +
        "words you supply — this starts from an existing link's own tags " +
        'and title, no query needed. Results are ranked by overlap and carry ' +
        'a short `snippet` (not full text — call `get_link` for that); the ' +
        'seed link itself is never included. An empty `results` array means ' +
        'the id is unknown/trashed, or the link has no tags and no usable ' +
        'title terms to relate from — not an error.',
      inputSchema: {
        id: z.uuid().describe('The id (uuid) of the link to find others related to.'),
        limit: z
          .number()
          .int()
          .optional()
          .describe('Max related links to return (default 10, clamped to [1, 50]).'),
      },
      outputSchema: findRelatedOutputShape,
    },
    async ({ id, limit }): Promise<CallToolResult> => {
      const rows = await findRelated(id, limit);
      const results = rows.map((row) => ({ ...toSnippetLinkContent(row), rank: row.rank }));
      const structuredContent: FindRelatedStructuredContent = {
        results,
        count: results.length,
      };

      return {
        content: [{ type: 'text', text: toTextSummary(id, results) }],
        structuredContent,
      };
    },
  );
}
