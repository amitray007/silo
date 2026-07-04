import type { LinkWithTags } from '@silo/core';

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
 * - `sourceData` — an internal per-source blob; no UI renders it yet (mirrors
 *   the MCP shape's same watch-item — add it here too if that changes).
 * - `deletedAt` — live-scoping plumbing; excluded from LIVE responses. Trash
 *   responses (`GET /api/trash`) need it for the mockup's delete countdown,
 *   so `toTrashLinkJson` below is a separate, explicit variant that adds it
 *   rather than a flag threaded through `toLinkJson`.
 *
 * `addedBy` IS whitelisted (unlike `sourceData`): it's provenance (backs the
 * mockup's `◆` added-by-claude mark), not an internal-only field.
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
  captureStatus: 'enriching' | 'full' | 'partial' | 'bare';
  addedBy: 'user' | 'agent';
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** `LinkJson` plus `deletedAt` — the Trash screen's shape (`GET /api/trash`). */
export type TrashLinkJson = LinkJson & { deletedAt: string };

/** A search result — `LinkJson` plus the match's `rank` (`GET /api/links/search`). */
export type SearchResultJson = LinkJson & { rank: number };

/**
 * Builds the whitelisted, JSON-safe fields as an EXPLICIT field-by-field
 * pick — never a spread of `LinkWithTags`. This makes a leak of
 * `searchVector`/`canonicalUrl`/`sourceData`/`deletedAt` structurally
 * impossible: adding a field to the HTTP response requires a conscious edit
 * here, not an accidental one from a new DB column landing on `LinkWithTags`.
 * Dates are serialized to ISO strings (`Date#toISOString`) since HTTP/JSON
 * has no native date type.
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
    captureStatus: link.captureStatus,
    addedBy: link.addedBy,
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

/** `toLinkJson` plus a search `rank` (`GET /api/links/search`'s per-result score). */
export function toSearchResultJson(link: LinkWithTags, rank: number): SearchResultJson {
  return { ...toLinkJson(link), rank };
}
