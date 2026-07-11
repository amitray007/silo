import type { LinkWithTags } from '@silo/core';
import { CAPTURE_SOURCES, sourceDataSchema } from '@silo/core';
import { z } from 'zod';

/**
 * The WHITELIST (not a blacklist) of `LinkWithTags` fields every read tool
 * (`get_link`, `search_links`, `list_links`) exposes to an agent. Internal-
 * only columns (`searchVector`, a raw Postgres tsvector; `canonicalUrl`,
 * which can carry an `#unsafe-<uuid>` dedup suffix; `deletedAt`, live-scoping
 * plumbing) are deliberately NOT named here, so a future `links` schema
 * column can never auto-leak into an agent-facing result — it would have to
 * be added to this shape explicitly. Factored out of the three tool files
 * (each of which extends this base with its own extra fields/optionality —
 * `get_link` adds `found`, `search_links` adds `rank`) once they were
 * duplicating it verbatim (jscpd flagged the clone).
 *
 * This is also the SDK's `outputSchema` raw-shape convention (a Zod raw
 * shape object, not a wrapped `z.object`) — each tool spreads this into its
 * own outputSchema/result-shape object.
 *
 * `sourceData` IS NOW whitelisted (source-data/rich-previews slice, plan 012
 * — this was the prior watch-item noted here, and closes agent-native read
 * parity with the human UI's rich hover previews once those render): per-
 * source richness (an HN item's points/comments, a GitHub repo's stats, a
 * YouTube video's channel+thumbnail), all display data, none of it internal.
 * `sourceDataSchema` is the same strict, validated union `@silo/core` writes
 * through — used here as `outputSchema`'s own type for the field.
 *
 * `addedBy` (plan 007, C1) IS whitelisted: it's provenance (who saved this —
 * a human or an agent, backing the mockup's `◆` mark), not an internal-only
 * field like `searchVector` — agent-native parity means the agent should see
 * the same origin signal a human sees in the UI.
 *
 * `source` (capture-source slice) IS ALSO whitelisted: it's provenance too,
 * but a different axis — the capture SURFACE a link came through (web UI,
 * this MCP server, the CLI, Raycast, the Chrome extension, generic ingest),
 * orthogonal to `addedBy`'s who (human vs agent). `z.enum(CAPTURE_SOURCES)`
 * imports the single source of truth from `@silo/core` (mirrored, not
 * re-declared) rather than re-listing the 7 values here — see the
 * capture-source method file's "value-set drift guard".
 */
export const baseLinkShape = {
  id: z.uuid(),
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  siteName: z.string().nullable(),
  extractedText: z.string().nullable(),
  sourceKind: z.string(),
  sourceData: sourceDataSchema,
  captureStatus: z.enum(['enriching', 'full', 'partial', 'bare']),
  addedBy: z.enum(['user', 'agent']),
  source: z.enum(CAPTURE_SOURCES),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export type BaseLinkContent = z.infer<z.ZodObject<typeof baseLinkShape>>;

/**
 * Agent-facing output shape for a `search_links`/`list_links` RESULT ROW
 * (agent-navigation slice U4): the shared whitelist MINUS `extractedText`,
 * PLUS a short `snippet` — mirrors core's `ListResultRow`/`SearchResultRow`
 * (`Omit<LinkWithTags, 'extractedText'> & { snippet }`, see `links.ts`).
 * `get_link` is unaffected: it keeps `baseLinkShape`'s full `extractedText`,
 * since its whole job is "read the full content of a link I've identified"
 * (see `get-link.ts`) — only the two discovery tools (search by words,
 * browse newest-first) drop the full body from their result ROWS, so a page
 * of hits doesn't drag every article's full text into an agent's context.
 */
const { extractedText: _extractedText, ...snippetLinkBaseShape } = baseLinkShape;
void _extractedText;
export const snippetLinkShape = {
  ...snippetLinkBaseShape,
  snippet: z.string().nullable(),
};

export type SnippetLinkContent = z.infer<z.ZodObject<typeof snippetLinkShape>>;

/**
 * Re-validate the DB's loosely-typed `source_data` jsonb into the strict
 * `SourceData` union before it's ever handed to an agent — mirrors
 * `@silo/api`'s `link-json.ts`'s identical `shapeSourceData` (deliberately
 * duplicated, not shared — see this file's own boundary note on
 * `toBaseLinkContent` below). `core` only ever WRITES a validated payload,
 * so this should always succeed; re-parsing here too is defense in depth,
 * falling back to the universal `{ kind: 'link' }` floor rather than ever
 * throwing into a tool response.
 */
function shapeSourceData(raw: unknown): BaseLinkContent['sourceData'] {
  const parsed = sourceDataSchema.safeParse(raw);
  if (!parsed.success) {
    // Should never happen (core only writes validated payloads) — log rather
    // than silently mask real corruption, then fall back safely.
    console.warn('[silo/mcp] stored source_data failed validation; using link floor', {
      issues: parsed.error.issues,
    });
    return { kind: 'link' };
  }
  return parsed.data;
}

/**
 * Builds the whitelisted base fields as an EXPLICIT field-by-field pick —
 * never a spread of `LinkWithTags`. Makes the leak (`searchVector`/
 * `canonicalUrl`/`deletedAt`) structurally impossible: adding a field
 * requires a conscious edit here, not an accidental one from a new DB
 * column. `sourceData` IS included (see the doc comment above) but always
 * through `shapeSourceData`, never the raw DB value. Callers that need extra
 * fields (e.g. `search_links`'s `rank`) spread this result and add their own
 * on top.
 */
export function toBaseLinkContent(link: LinkWithTags): BaseLinkContent {
  return {
    id: link.id,
    url: link.url,
    title: link.title,
    description: link.description,
    imageUrl: link.imageUrl,
    siteName: link.siteName,
    extractedText: link.extractedText,
    sourceKind: link.sourceKind,
    sourceData: shapeSourceData(link.sourceData),
    captureStatus: link.captureStatus,
    addedBy: link.addedBy,
    source: link.source,
    notes: link.notes,
    tags: link.tags,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

/**
 * A row shape shared by core's `ListResultRow`/`SearchResultRow`: the same
 * fields `LinkWithTags` has, minus `extractedText`, plus `snippet`. Narrowed
 * with a structural type (not imported from `@silo/core`'s two distinct
 * exported row types) so one function serves both `search_links` and
 * `list_links` — the fields this function reads are identical across both.
 */
type SnippetSourceRow = Omit<LinkWithTags, 'extractedText'> & { snippet: string | null };

/**
 * Builds the whitelisted `search_links`/`list_links` result-row fields by
 * delegating to `toBaseLinkContent` (same field-by-field whitelist pick, so
 * the two can never drift on which fields are exposed) — `link` is missing
 * `extractedText` (`SnippetSourceRow` omits it), so a placeholder `null` is
 * passed through to satisfy `toBaseLinkContent`'s `LinkWithTags` param and
 * immediately dropped from the result — then swaps in `snippet`. Never a
 * spread of the raw row. Callers that need extra fields (e.g. `search_links`'s
 * `rank`) spread this result and add their own on top.
 */
export function toSnippetLinkContent(link: SnippetSourceRow): SnippetLinkContent {
  const { extractedText: _extractedText, ...base } = toBaseLinkContent({
    ...link,
    extractedText: null,
  });
  void _extractedText;
  return { ...base, snippet: link.snippet };
}

/**
 * One `content[0].text` line for a ranked, snippet-carrying result — shared
 * by `search_links` and `find_related` (agent-navigation slice U4), both of
 * which list `SnippetLinkContent & { rank: number }` rows: `- (rank 0.123)
 * Title — url [tags] — snippet`. Factored out once the two tools' otherwise
 * near-identical `toTextSummary` loop bodies were flagged as a jscpd clone.
 */
export function toRankedResultLine(result: SnippetLinkContent & { rank: number }): string {
  const tagsPart = result.tags.length > 0 ? ` [${result.tags.join(', ')}]` : '';
  const snippetPart = result.snippet ? ` — ${result.snippet}` : '';
  return `- (rank ${result.rank.toFixed(3)}) ${result.title ?? result.url} — ${result.url}${tagsPart}${snippetPart}`;
}
