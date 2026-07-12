import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LinkWithTags, LinkWithTextWindow } from '@silo/core';
import { getById, getByIds } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, runBulkGuarded } from './found-result.js';
import { toBaseLinkContent } from './link-shape.js';

/**
 * Agent-facing output shape for `get_link`'s SINGLE-id path — reuses the
 * shared `foundLinkOutputShape` (`./found-result.js`: the whitelist with
 * every field `.optional()`, `found` discriminating found vs. not-found/
 * trashed) plus `extractedTextLength`. Per docs/rules/mcp.md, a not-found id
 * is a normal tool result, never a thrown error — but SDK 1.29.0's
 * `validateToolOutput` requires ANY non-error result to carry
 * `structuredContent` matching `outputSchema` once one is declared (an empty
 * structuredContent throws `"has an output schema but no structured content
 * was provided"`), which is exactly why `foundLinkOutputShape`'s link fields
 * are all `.optional()`.
 *
 * `extractedTextLength` (agent-navigation slice U4): present only when
 * `textWindow` was requested (see `GetByIdOptions`'s doc comment in core) —
 * tells the agent the FULL text's length so it knows there's more beyond the
 * slice it received and can request a later offset.
 *
 * The BATCH path (`ids`, agent-navigation slice U4) uses a SEPARATE
 * `getLinkBatchResultShape` below (an array of these same per-link fields,
 * no top-level `found`) rather than trying to fold both shapes into one
 * schema — see that shape's doc comment for why.
 *
 * This is also the SDK's `outputSchema` raw shape (passed the same way
 * `inputSchema` is — a Zod raw shape object, not a wrapped `z.object`), so
 * the SDK validates every `structuredContent` response against it.
 */
const getLinkOutputShape = {
  ...foundLinkOutputShape,
  extractedTextLength: z.number().optional(),
};

type GetLinkStructuredContent = z.infer<z.ZodObject<typeof getLinkOutputShape>>;

/**
 * `get_link`'s BATCH (`ids`) output shape (agent-navigation slice U4): a
 * `results` array, one entry per requested id, each carrying `id` + `found`
 * + (when found) the full link fields — mirrors `core.getByIds`'s
 * `BulkGetResult[]` (parallel to input, order/duplicates preserved). Built by
 * making `foundLinkOutputShape`'s `id` REQUIRED (every batch entry names
 * which id it answers, found or not) rather than reusing `getLinkOutputShape`
 * for both single and batch: the single path's top-level `found: boolean` is
 * semantically a different shape than "an array of per-id found/not-found
 * entries" — folding both into one object would need every field
 * `.optional()` either way, and a separate `results` array is the honest,
 * unambiguous shape for "many ids in, many outcomes out". `results` itself
 * is `.optional()` on the combined schema below so a `structuredContent`
 * from the SINGLE path (no `results` field) and one from the BATCH path (no
 * top-level `found`) can both validate against the ONE combined
 * `outputSchema` this tool declares (see the SDK's per-tool single-
 * `outputSchema` constraint noted on `search_links`'s `count_only` mode).
 */
const getLinkBatchResultShape = {
  ...foundLinkOutputShape,
  id: foundLinkOutputShape.id.unwrap(),
};

type GetLinkBatchResult = z.infer<z.ZodObject<typeof getLinkBatchResultShape>>;

const getLinkOutputSchema = {
  ...getLinkOutputShape,
  results: z.array(z.object(getLinkBatchResultShape)).optional(),
};

type GetLinkOutputStructuredContent = GetLinkStructuredContent & { results?: GetLinkBatchResult[] };

/**
 * Builds `structuredContent` from the shared whitelist pick
 * (`toBaseLinkContent`) plus `found: true` — never a spread of raw
 * `LinkWithTags`. This makes the leak (`searchVector`/`canonicalUrl`/
 * `deletedAt`) structurally impossible: adding a field requires a conscious
 * edit to `./link-shape.js`, not an accidental one from a new DB column.
 *
 * When `link` carries `extractedTextLength` (the `textWindow`-windowed
 * shape, `LinkWithTextWindow`), it's included in the result — see
 * `getLinkOutputShape`'s doc comment.
 */
function toStructuredContent(link: LinkWithTags | LinkWithTextWindow): GetLinkStructuredContent {
  const base = { found: true as const, ...toBaseLinkContent(link) };
  return 'extractedTextLength' in link
    ? { ...base, extractedTextLength: link.extractedTextLength }
    : base;
}

/**
 * Builds one `results[]` entry for the batch (`ids`) path. `link.id` (from
 * `toBaseLinkContent`) always equals the requested `id` for a found result
 * (`getByIds` looks each id up directly), so spreading it first and letting
 * it stand is equivalent to overriding — done this way (rather than `{ id,
 * ...toBaseLinkContent(link) }`) only to avoid TS's "specified more than
 * once" duplicate-key flag on the object literal.
 */
function toBatchResult(id: string, link: LinkWithTags | null): GetLinkBatchResult {
  if (!link) return { id, found: false };
  return { ...toBaseLinkContent(link), found: true };
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
function toTextSummary(link: LinkWithTags | LinkWithTextWindow): string {
  const windowNote =
    'extractedTextLength' in link
      ? `showing a ${link.extractedText?.length ?? 0}-char window of ${link.extractedTextLength} total chars`
      : undefined;
  const lines = [
    link.title ?? link.url,
    link.url,
    link.siteName ? `site: ${link.siteName}` : undefined,
    `status: ${link.captureStatus}`,
    link.description ? `description: ${link.description}` : undefined,
    `tags: ${link.tags.length > 0 ? link.tags.join(', ') : '(none)'}`,
    link.notes ? `note: ${link.notes}` : undefined,
    link.extractedText
      ? `full text: ${link.extractedText.length} chars (see structuredContent.extractedText)${windowNote ? ` — ${windowNote}` : ''}`
      : undefined,
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
}

/** Builds the `content[0].text` block for the batch (`ids`) path. */
function toBatchTextSummary(results: GetLinkBatchResult[]): string {
  if (results.length === 0) {
    return 'No ids were given.';
  }
  const foundCount = results.filter((r) => r.found).length;
  const lines = [
    `${foundCount} of ${results.length} link${results.length === 1 ? '' : 's'} found (full text included; textWindow is not applied in batch mode):`,
  ];
  for (const result of results) {
    if (!result.found) {
      lines.push(`- ${result.id}: not found (unknown or trashed)`);
      continue;
    }
    const tagsPart = result.tags && result.tags.length > 0 ? ` [${result.tags.join(', ')}]` : '';
    lines.push(`- ${result.id}: ${result.title ?? result.url} — ${result.url}${tagsPart}`);
  }
  return lines.join('\n');
}

/**
 * Registers `get_link` on `server`: parse (Zod) -> one `core.getById`/
 * `core.getByIds` call -> shape the MCP result. Per docs/rules/mcp.md, all
 * business logic (the live-scoping, the tag hydration) lives in `core`
 * already — this handler only translates.
 *
 * `id` (single) and `ids` (batch, agent-navigation slice U4) are BOTH
 * accepted on the one tool — the one-or-many pattern the spec's guiding
 * constraint requires ("never a `bulk_*` twin"). Precedence when BOTH are
 * given: `ids` WINS and `id` is ignored — documented in the tool description
 * below, so an agent that (mistakenly) sends both gets predictable behavior
 * rather than a rejected call. The single-`id` path is UNCHANGED (full text,
 * optional `textWindow` slice); the batch `ids` path always returns full
 * text per link (no `textWindow` — see `core.getByIds`'s doc comment on why
 * a single shared window doesn't fit a multi-article batch read).
 */
export function registerGetLink(server: McpServer): void {
  server.registerTool(
    'get_link',
    {
      title: 'Get link',
      description:
        "Fetch one or more saved links' full detail by id: metadata (url, " +
        'title, description, image, site name), extracted full text, tags, ' +
        'capture status, and notes. Pass `id` for ONE link, or `ids` for a ' +
        'BATCH read of several in one call (if both are given, `ids` wins). ' +
        'A single-`id` fetch may pass `textWindow: { offset, limit }` to ' +
        'read a character slice of a long article instead of the whole ' +
        'body — the result then also carries `extractedTextLength`, the ' +
        "FULL text's length, so you know there's more beyond the window " +
        '(omit `textWindow` for the full text, the default). `textWindow` ' +
        'is NOT applied in batch (`ids`) mode — a batch read always returns ' +
        "each link's full text. Each requested id resolves independently: " +
        'a not-found (unknown or trashed) id is reported cleanly, never a ' +
        'thrown error — trashed links are never returned. Use this after ' +
        '`search_links` or `list_links` (whose results carry only a short ' +
        '`snippet`) to read one or more results in full.',
      inputSchema: {
        id: z.uuid().optional().describe('The link id (uuid) to fetch (single-link mode).'),
        ids: z
          .array(z.uuid())
          .optional()
          .describe(
            'Link ids (uuids) to fetch in one batch call, up to 500 per call. Wins over `id` ' +
              'if both are given. Full text only (textWindow is not applied to batch reads).',
          ),
        textWindow: z
          .object({
            offset: z
              .number()
              .int()
              .min(0)
              .describe('Character offset into the full text to start at.'),
            limit: z.number().int().min(1).describe('Max characters to return from offset.'),
          })
          .optional()
          .describe(
            'Read only a character slice of extractedText (single-`id` mode only). Omit for ' +
              'the full text.',
          ),
      },
      outputSchema: getLinkOutputSchema,
    },
    async ({ id, ids, textWindow }): Promise<CallToolResult> => {
      if (ids !== undefined) {
        const outcome = await runBulkGuarded(() => getByIds(ids));
        if (!outcome.ok) return outcome.error;
        const results = outcome.value.map((r) => toBatchResult(r.id, r.link));
        const structuredContent: GetLinkOutputStructuredContent = { found: false, results };
        return {
          content: [{ type: 'text', text: toBatchTextSummary(results) }],
          structuredContent,
        };
      }

      if (id === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `id` (single) or `ids` (batch) to get_link.' },
          ],
        };
      }

      const link = textWindow !== undefined ? await getById(id, { textWindow }) : await getById(id);
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
