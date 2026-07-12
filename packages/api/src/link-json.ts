import type {
  CaptureSource,
  LinkWithTags,
  LinkWithTextWindow,
  ListResultRow,
  SearchResultRow,
  SourceData,
} from '@silo/core';
import { sourceDataSchema } from '@silo/core';

/**
 * The WHITELISTED, JSON-serialized shape of a `LinkWithTags` this API returns
 * over HTTP. Mirrors the discipline of `packages/mcp/server/src/tools/
 * link-shape.ts`'s `baseLinkShape`/`toBaseLinkContent` — deliberately NOT
 * shared with it: `@silo/api` and `@silo/mcp-server` are sibling adapters
 * (see `docs/rules/architecture.md`), and an adapter may import `@silo/core`
 * and nothing else in the workspace. So this is an INTENTIONAL, boundary-
 * required duplication of that whitelist, not an oversight — the shared
 * invariant ("no internal-field leak") is enforced independently in each
 * adapter, each with its own leak-guard test (see `link-json.test.ts` here,
 * and `link-shape`'s own tests on the MCP side).
 *
 * Internal-only `LinkWithTags` fields are deliberately NOT named here, so a
 * future `links` schema column can never auto-leak into an HTTP response —
 * it would have to be added to this shape explicitly:
 * - `searchVector` — a raw Postgres tsvector, meaningless over JSON.
 * - `canonicalUrl` — can carry an internal `#unsafe-<uuid>` dedup suffix.
 * - `deletedAt` — live-scoping plumbing; excluded from LIVE responses. Trash
 *   responses (`GET /api/trash`) need it for the mockup's delete countdown,
 *   so `toTrashLinkJson` below is a separate, explicit variant that adds it
 *   rather than a flag threaded through `toLinkJson`.
 *
 * `addedBy` IS whitelisted: it's provenance (backs the mockup's `◆`
 * added-by-claude mark), not an internal-only field.
 *
 * `source` IS whitelisted (capture-source slice): it's the capture SURFACE
 * (`web`/`mcp`/`cli`/`raycast`/`chrome`/`ingest`/`unknown`) — provenance,
 * orthogonal to `addedBy` (who vs. through-what), not an internal field. Not
 * rendered as a per-row UI badge ("silence means complete" stays binding);
 * it's agent/query-facing, read over this JSON and the MCP read surface.
 *
 * `sourceData` IS NOW whitelisted (source-data/rich-previews slice, plan
 * 012 — this was the prior watch-item noted here and on the MCP side): it's
 * entirely display data (HN points/comments, GitHub repo stats, a YouTube
 * channel+thumbnail — see `@silo/core`'s `source-data.ts`), no internal
 * field, and the web rendering (a later phase) needs it to draw the rich
 * hover previews. `SourceData`'s own `.strict()` discriminated union is
 * still the enforcement point for "no internal leak inside the payload
 * itself" — nothing beyond its declared variants can ever be stored there.
 */
export type LinkJson = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  extractedText: string | null;
  sourceKind: string;
  sourceData: SourceData;
  captureStatus: 'enriching' | 'full' | 'partial' | 'bare';
  addedBy: 'user' | 'agent';
  source: CaptureSource;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Re-validate the DB's loosely-typed `source_data` jsonb (`Record<string,
 * unknown>` on `LinkWithTags` — the column has no DB-level schema, only the
 * Zod gate at every core write boundary) into the strict `SourceData` union
 * before it's ever handed to an HTTP response. `core` only ever WRITES a
 * validated payload (`createLink`/`recordEnrichment` both `.parse()` before
 * any write), so this should always succeed — re-parsing on the READ side
 * too is defense in depth (a hand-edited row, a future migration bug), not
 * an expectation that it will actually reject in practice. Falls back to the
 * universal `{ kind: 'link' }` floor (never throws into the response path)
 * on the unexpected case where it doesn't parse.
 */
function shapeSourceData(raw: unknown): SourceData {
  const parsed = sourceDataSchema.safeParse(raw);
  if (!parsed.success) {
    // Should never happen (core only writes validated payloads) — log rather
    // than silently mask real corruption, then fall back safely.
    console.warn('[silo/api] stored source_data failed validation; using link floor', {
      issues: parsed.error.issues,
    });
    return { kind: 'link' };
  }
  return parsed.data;
}

/** `LinkJson` plus `deletedAt` — the Trash screen's shape (`GET /api/trash`). */
export type TrashLinkJson = LinkJson & { deletedAt: string };

/** A search result — `LinkJson` plus the match's `rank` (`GET /api/links/search`). */
export type SearchResultJson = LinkJson & { rank: number };

/**
 * Builds the whitelisted, JSON-safe fields as an EXPLICIT field-by-field
 * pick — never a spread of `LinkWithTags`. This makes a leak of
 * `searchVector`/`canonicalUrl`/`deletedAt` structurally impossible: adding a
 * field to the HTTP response requires a conscious edit here, not an
 * accidental one from a new DB column landing on `LinkWithTags`. `sourceData`
 * IS included (see the `LinkJson` doc comment above) but always through
 * `shapeSourceData`, never the raw DB value, so an invalid/malformed stored
 * payload can never reach the response unvalidated. Dates are serialized to
 * ISO strings (`Date#toISOString`) since HTTP/JSON has no native date type.
 */
export function toLinkJson(link: LinkWithTags): LinkJson {
  /* jscpd:ignore-start — this field-by-field whitelist necessarily resembles the
     MCP adapter's `link-shape.ts`. The duplication is DELIBERATE and required by
     the architecture boundary: `@silo/api` may not import `@silo/mcp-server` (a
     sibling adapter), and the whitelist is each adapter's own wire-format concern
     (HTTP vs MCP), not a shared core responsibility — hoisting it to core would
     couple two protocols. The shared invariant ("never leak internal columns") is
     enforced by a no-leak test in each adapter, not by sharing the code. */
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
  /* jscpd:ignore-end */
}

/**
 * Same whitelist as `toLinkJson`, plus `deletedAt` — for `GET /api/trash`,
 * where the mockup needs the trashed-at timestamp to render the purge
 * countdown. `link.deletedAt` is non-null for any row `listTrash` returns
 * (it only selects `deleted_at IS NOT NULL` rows — see `core`'s
 * `listTrash`), but the field's static type on `LinkWithTags` is
 * `Date | null` (it's nullable for live links), so the null case is handled
 * explicitly rather than asserted away.
 */
export function toTrashLinkJson(link: LinkWithTags): TrashLinkJson {
  return {
    ...toLinkJson(link),
    deletedAt: link.deletedAt ? link.deletedAt.toISOString() : '',
  };
}

/**
 * The whitelisted, JSON-serialized shape of a `list`/`search` RESULT ROW
 * (agent-navigation slice U5): `LinkJson` minus `extractedText`, plus a short
 * `snippet` — mirrors `@silo/core`'s `ListResultRow`/`SearchResultRow`
 * (`Omit<LinkWithTags, 'extractedText'> & { snippet }`) and
 * `packages/mcp/server/src/tools/link-shape.ts`'s `SnippetLinkContent`. The
 * full-text `extractedText` field is dropped from list/search responses (a
 * page of 20 hits no longer drags every article's full body over HTTP) — a
 * client reads the full text via `GET /api/links/:id` for the one result it
 * actually wants.
 */
export type SnippetLinkJson = Omit<LinkJson, 'extractedText'> & { snippet: string | null };

/**
 * `SnippetLinkJson` plus a search `rank` (`GET /api/links/search`'s /
 * `GET /api/links/:id/related`'s per-result score).
 */
export type SnippetSearchResultJson = SnippetLinkJson & { rank: number };

/**
 * Builds the whitelisted `snippet` shape from a `ListResultRow`/
 * `SearchResultRow` — an EXPLICIT field-by-field pick (via `toLinkJson`, fed
 * a placeholder `extractedText: null` since the row doesn't carry one, then
 * dropped from the result), never a spread of the raw row. Shared by
 * `GET /api/links`/`GET /api/links/search`/`GET /api/links/:id/related` so
 * the three can never drift on which fields a snippet row carries.
 */
export function toSnippetLinkJson(link: ListResultRow | SearchResultRow): SnippetLinkJson {
  const { extractedText: _extractedText, ...base } = toLinkJson({ ...link, extractedText: null });
  return { ...base, snippet: link.snippet };
}

/** `toSnippetLinkJson` plus a search `rank` — used by `GET /api/links/search` and `GET /api/links/:id/related`. */
export function toSnippetSearchResultJson(link: SearchResultRow): SnippetSearchResultJson {
  return { ...toSnippetLinkJson(link), rank: link.rank };
}

/** `toLinkJson` plus a search `rank` (`GET /api/links/search`'s per-result score). */
export function toSearchResultJson(link: LinkWithTags, rank: number): SearchResultJson {
  return { ...toLinkJson(link), rank };
}

/**
 * `toLinkJson` plus `extractedTextLength` — the windowed-detail shape
 * `GET /api/links/:id` returns when `?textOffset=&textLimit=` was requested
 * (agent-navigation slice U5). `extractedText` (via `toLinkJson`) already
 * carries the requested SLICE (core's `getById(id, { textWindow })` replaces
 * the field in place — see its doc comment); `extractedTextLength` is the
 * FULL untruncated length, so a client knows there's more beyond the window
 * it received. Mirrors `packages/mcp/server/src/tools/get-link.ts`'s
 * `GetLinkStructuredContent`'s identical `extractedTextLength` field.
 */
export type LinkWithTextWindowJson = LinkJson & { extractedTextLength: number };

/** Builds the windowed-detail shape — `toLinkJson` plus `extractedTextLength`. */
export function toLinkWithTextWindowJson(link: LinkWithTextWindow): LinkWithTextWindowJson {
  return { ...toLinkJson(link), extractedTextLength: link.extractedTextLength };
}

/**
 * `TrashLinkJson` plus a search `rank` (`GET /api/trash/search`'s per-result
 * shape, Trash search slice) — a DISTINCT variant from `SearchResultJson`
 * (which carries no `deletedAt`): the Trash search UI groups its results by
 * `deletedAt` via the same `bucketTrashByDay` the plain trash feed uses (and
 * shows the same purge countdown), so a trash search result needs the
 * trashed-at timestamp the live search result never does.
 */
export type TrashSearchResultJson = TrashLinkJson & { rank: number };

/** Builds a `TrashSearchResultJson` — `toTrashLinkJson` (whitelist + `deletedAt`) plus the search `rank`. Used by `GET /api/trash/search`. */
export function toTrashSearchResultJson(link: LinkWithTags, rank: number): TrashSearchResultJson {
  return { ...toTrashLinkJson(link), rank };
}

/**
 * `SnippetLinkJson` plus `deletedAt` plus a search `rank` — the
 * `GET /api/trash/search` result shape (agent-navigation slice U5):
 * `core.searchTrash` returns `SearchResultRow[]` (U2's snippet-not-
 * extractedText shape, same as live `search()`), so its HTTP result carries
 * `snippet` like `GET /api/links/search` does, PLUS `deletedAt` (the purge-
 * countdown field every trash response needs — see `TrashLinkJson`'s doc
 * comment). A distinct type from `SnippetSearchResultJson` (no `deletedAt`)
 * for the same reason `TrashSearchResultJson` is distinct from
 * `SearchResultJson`.
 */
export type TrashSnippetSearchResultJson = SnippetLinkJson & { deletedAt: string; rank: number };

/**
 * Builds a `TrashSnippetSearchResultJson` from a `SearchResultRow` —
 * `SearchResultRow` is `Omit<LinkWithTags, 'extractedText'> & {...}`, so it
 * still carries `deletedAt` (only `extractedText` is omitted); `searchTrash`
 * only ever returns trashed rows, so `deletedAt` is always non-null in
 * practice here, but the fallback to `''` mirrors `toTrashLinkJson`'s
 * identical defensive handling of `LinkWithTags`'s nullable static type.
 */
export function toTrashSnippetSearchResultJson(
  link: SearchResultRow,
): TrashSnippetSearchResultJson {
  return {
    ...toSnippetLinkJson(link),
    deletedAt: link.deletedAt ? link.deletedAt.toISOString() : '',
    rank: link.rank,
  };
}
