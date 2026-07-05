/**
 * Web's OWN copy of the API's JSON response shapes. Deliberately NOT imported
 * from `@silo/api` (adapters don't share types across the workspace boundary —
 * `docs/rules/architecture.md`) or `@silo/core` (its barrel value-imports
 * `@silo/db` -> `pg` at module top level; a browser bundle can never pull that
 * in — see plan 008 W4/the bundling constraint in `CLAUDE.md`). Mirrors
 * `packages/api/src/link-json.ts`'s `LinkJson`/`TrashLinkJson`/
 * `SearchResultJson` and each route's response envelope field-for-field, with
 * one required divergence: dates are serialized over HTTP as ISO strings, so
 * every date field here is `string`, never `Date`.
 */

/** Mirrors `LinkJson['captureStatus']` in `packages/api/src/link-json.ts`. */
export type CaptureStatus = 'enriching' | 'full' | 'partial' | 'bare';

/** Mirrors `LinkJson['addedBy']` in `packages/api/src/link-json.ts`. */
export type AddedBy = 'user' | 'agent';

/**
 * Mirrors `LinkJson` in `packages/api/src/link-json.ts` — the whitelisted,
 * JSON-serialized shape of a link. `createdAt`/`updatedAt` are ISO date
 * strings (JSON has no native date type), NOT `Date`.
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
  captureStatus: CaptureStatus;
  addedBy: AddedBy;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** `LinkJson` plus `deletedAt` (ISO string) — `GET /api/trash`'s per-row shape. */
export type TrashLinkJson = LinkJson & { deletedAt: string };

/** `LinkJson` plus a search `rank` — `GET /api/links/search`'s per-result shape. */
export type SearchResultJson = LinkJson & { rank: number };

/** A single tag with its live-link count — an entry in `GET /api/tags`'s list. */
export type TagCount = { name: string; count: number };

/** `GET /api/counts` — the sidebar's live/trash counts plus the read-only purge window. */
export type Counts = { live: number; trash: number; purgeWindowDays: number };

/** `GET /api/links` response envelope. */
export type LinksResponse = { links: LinkJson[]; nextCursor?: string };

/** `GET /api/links/search` response envelope. */
export type SearchResponse = { results: SearchResultJson[]; nextCursor?: string };

/** `GET /api/trash` response envelope. */
export type TrashResponse = { links: TrashLinkJson[]; nextCursor?: string };

/** `GET /api/links/:id` response envelope. */
export type LinkResponse = { link: LinkJson };

/**
 * `POST /api/links` (capture) response envelope — mirrors
 * `links-write.ts`'s `c.json({ link, deduped }, 201)`. `deduped` is `true`
 * when the URL had already been captured and the write merged into the
 * existing row rather than creating a new one.
 */
export type CaptureResponse = { link: LinkJson; deduped: boolean };

/** `POST /api/links` (capture) request body — mirrors `captureBodySchema` (`packages/api/src/query-schemas.ts`). */
export type CaptureRequest = { url: string; tags?: string[]; note?: string };

/** `PATCH /api/links/:id` (edit) request body — mirrors `editBodySchema` (`packages/api/src/query-schemas.ts`). Every field optional; an empty body is a valid no-op. */
export type EditLinkRequest = { title?: string; description?: string; note?: string };

/** `GET /api/tags` response envelope. */
export type TagsResponse = { tags: TagCount[] };

/**
 * Mirrors `ErrorEnvelope` in `packages/api/src/app.ts` — every non-2xx JSON
 * body the API returns has this shape. `error` is a short machine-stable
 * code; `message` is human-readable; `details` is optional structured extra
 * context (e.g. a Zod issue list).
 */
export type ApiErrorBody = {
  error: string;
  message: string;
  details?: unknown;
};
