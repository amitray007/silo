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
 * Web's OWN copy of the API's `sourceData` union — mirrors
 * `@silo/core`'s `SourceData` (`packages/core/src/links/source-data.ts`)
 * field-for-field, string-safe (no `Date`s appear in this union, so no
 * divergence needed there). Not imported from `@silo/core` for the same
 * bundling reason the rest of this file isn't (see the file's top doc
 * comment) — `@silo/core`'s barrel value-imports `@silo/db` -> `pg` at
 * module top level, which a browser bundle can never pull in.
 *
 * Source-data/rich-previews slice (plan 012): drives the web's rich hover
 * previews (HN points/comments, GitHub repo stats, a YouTube
 * channel+thumbnail) once that rendering lands (a later phase) — the API
 * whitelist change (this type's server-side counterpart) is what un-blocks
 * it. The universal `{ kind: 'link' }` floor covers both a genuinely plain
 * link AND a detected-but-not-yet-enriched rich source (see `@silo/core`'s
 * `links.ts` `resolveSource` doc comment for why those two cases share one
 * representation) — never assume `kind !== 'link'` implies enriched data
 * is present elsewhere on the link.
 */
export type SourceData =
  | { kind: 'link' }
  | { kind: 'hacker_news'; points: number; comments: number; author: string }
  | {
      kind: 'twitter';
      text: string;
      authorHandle: string;
      authorName: string;
      authorAvatarUrl?: string;
      likes: number;
      reposts: number;
      replies: number;
      quotes: number;
      bookmarks: number;
      postedAt?: string;
      language?: string;
      possiblySensitive?: boolean;
      mediaUrls?: string[];
      externalLinks?: string[];
    }
  | {
      kind: 'github';
      stars: number;
      forks: number;
      issues: number;
      description?: string;
      language?: string;
      languagePct?: number;
    }
  | { kind: 'youtube'; channel: string; thumbnailUrl: string };

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
  sourceData: SourceData;
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

/**
 * `TrashLinkJson` plus a search `rank` — `GET /api/trash/search`'s per-result
 * shape (Trash search slice). Distinct from `SearchResultJson`: it carries
 * `deletedAt` so the Trash search UI can day-group results (`bucketTrashByDay`)
 * and show the same purge countdown the plain trash feed shows.
 */
export type TrashSearchResultJson = TrashLinkJson & { rank: number };

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

/** `GET /api/trash/search` response envelope (Trash search slice). */
export type TrashSearchResponse = { results: TrashSearchResultJson[]; nextCursor?: string };

/** `GET /api/links/:id` response envelope. */
export type LinkResponse = { link: LinkJson };

/**
 * `POST /api/links/:id/restore` response envelope — mirrors
 * `packages/api/src/routes/trash.ts`'s two success shapes. `outcome:
 * 'merged'` means the restored link collided with an already-live URL and
 * was folded into that OTHER link — `link.id` is that other id, not the id
 * originally requested (see the route's doc comment).
 */
export type RestoreResponse =
  | { outcome: 'restored'; link: LinkJson }
  | { outcome: 'merged'; link: LinkJson; message: string };

/** `DELETE /api/trash` (empty all) response envelope — mirrors `trash.ts`'s `c.json({ deleted }, 200)`. */
export type EmptyTrashResponse = { deleted: number };

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
 * Web's OWN copy of `@silo/core`'s settings allowlist (plan 016) — mirrors
 * `packages/core/src/settings/schema.ts`'s `SettingsMap`/`plugins` shape
 * field-for-field, same "not imported from core" rule the rest of this file
 * follows (see the file's top doc comment — `@silo/core`'s barrel pulls in
 * `pg` at module scope, which a browser bundle can never load). Both `GET
 * /api/settings` and `PATCH /api/settings` share this exact shape — the
 * PATCH response is the full, freshly-merged map, not just the changed
 * fields (see `settings.ts`'s route doc comment).
 */
export type SettingsMap = {
  theme: 'light' | 'dark' | 'system';
  trashPurgeDays: 7 | 30 | 90;
  plugins: { hacker_news: boolean; github: boolean; youtube: boolean };
};

/** `PATCH /api/settings` request body — every field optional; an empty body is a valid no-op (mirrors `EditLinkRequest`'s discipline). */
export type UpdateSettingsRequest = Partial<SettingsMap>;

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
