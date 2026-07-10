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
 * Web's OWN copy of the closed capture-source value set — mirrors
 * `LinkJson['source']` in `packages/api/src/link-json.ts`, which in turn
 * mirrors `@silo/core`'s `CAPTURE_SOURCES` (`packages/core/src/links/
 * source.ts`), the single source of truth. Not imported from `@silo/core`
 * for the same bundling reason the rest of this file isn't (see the file's
 * top doc comment). The capture SURFACE a link came through (web UI, MCP,
 * CLI, Raycast, Chrome extension, generic ingest), orthogonal to `AddedBy`'s
 * who (human vs agent).
 */
export type CaptureSource = 'web' | 'mcp' | 'cli' | 'raycast' | 'chrome' | 'ingest' | 'unknown';

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
      /** The tweet's own media thumbnail (video poster / photo), set by the
       * live FxEmbed enricher when present — served through
       * `/api/preview-image` (never rendered as a raw `twimg.com` `<img
       * src>`). See `packages/core/src/links/source-data.ts`'s doc comment. */
      thumbnailUrl?: string;
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
  source: CaptureSource;
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

/** A trashed link plus a search `rank` — `GET /api/trash/search`'s per-result shape. */
export type TrashSearchResultJson = TrashLinkJson & { rank: number };

/** `GET /api/trash/search` response envelope (Trash search slice — consumed by the command palette's Trash scope). */
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

/**
 * `POST /api/links` (capture) request body — mirrors `captureBodySchema`
 * (`packages/api/src/query-schemas.ts`). `source` is stamped centrally by
 * `useCaptureLink` (`hooks.ts`) as `'web'` for every capture through this
 * hook, not threaded in by callers — see the capture-source design spec.
 */
export type CaptureRequest = { url: string; tags?: string[]; note?: string; source?: 'web' };

/** `PATCH /api/links/:id` (edit) request body — mirrors `editBodySchema` (`packages/api/src/query-schemas.ts`). Every field optional; an empty body is a valid no-op. */
export type EditLinkRequest = { title?: string; description?: string; note?: string };

/** `GET /api/tags` response envelope. */
export type TagsResponse = { tags: TagCount[] };

/**
 * Web's OWN copy of `@silo/core`'s settings allowlist (plan 016, `plugins`
 * shape updated plan 026) — mirrors `packages/core/src/settings/schema.ts`'s
 * `SettingsMap`/`settingsSchema.plugins` shape field-for-field, same "not
 * imported from core" rule the rest of this file follows (see the file's top
 * doc comment — `@silo/core`'s barrel pulls in `pg` at module scope, which a
 * browser bundle can never load). Both `GET /api/settings` and `PATCH
 * /api/settings` share this exact shape — the PATCH response is the full,
 * freshly-merged map, not just the changed fields (see `settings.ts`'s route
 * doc comment).
 *
 * `plugins` (plan 026): each source is now a per-feature object rather than
 * a bare boolean — a master `enabled` (gates the worker fetch entirely) plus
 * the render-surface flags that source supports. `hacker_news` and `twitter`
 * render both an inline row line and a hover preview (`inline`/`hover`);
 * `github`/`youtube` are hover-only (no `inline`). Mirror core's shape
 * EXACTLY — do not add fields a source doesn't have.
 *
 * `mcpAccess` (Access-tab MCP-toggle unit): a scalar boolean, default `true`
 * — mirrors core's `settingsSchema.mcpAccess` (`packages/core/src/settings/
 * schema.ts`). Gates the HTTP MCP listener per-request server-side
 * (`packages/app/src/mcp-http.ts`: `403` when `false`); the web-side toggle
 * in `AccessTab` reads/writes this exact key.
 */
export type SettingsMap = {
  theme: 'light' | 'dark' | 'system';
  trashPurgeDays: 7 | 30 | 90;
  mcpAccess: boolean;
  // `linkPreviewImages` (Plugins-tab silo section): mirrors core's
  // `settingsSchema.linkPreviewImages`. When false, plain-link hover-preview
  // cards omit the captured og:image. Default true.
  linkPreviewImages: boolean;
  plugins: {
    hacker_news: { enabled: boolean; inline: boolean; hover: boolean };
    github: { enabled: boolean; hover: boolean };
    youtube: { enabled: boolean; hover: boolean };
    // twitter has a live worker enricher (api.fxtwitter.com) AND can arrive
    // pre-extracted via the `silo ingest x` CLI; `enabled` gates the worker
    // fetch, `inline`/`hover` gate its two render surfaces. See
    // `packages/core/src/settings/schema.ts`'s doc comment.
    twitter: { enabled: boolean; inline: boolean; hover: boolean };
  };
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

/**
 * Web's OWN copy of a named access token's public shape — mirrors
 * `packages/api/src/routes/access-tokens.ts`'s `GET /api/access-tokens` list
 * entries and `@silo/core`'s `AccessTokenSummary`
 * (`packages/core/src/auth/tokens.ts`), the source of truth. Same
 * not-imported-from-core rule as the rest of this file (see the file's top
 * doc comment) — never includes `tokenHash`; the raw token is NEVER present
 * on this shape (only on `CreatedAccessTokenJson`, once, at creation).
 * `lastUsedAt` is `null` until the token's first successful use.
 */
export type AccessTokenJson = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * `POST /api/access-tokens`'s response shape — `AccessTokenJson` plus the
 * RAW token, present this ONE time. The caller (`AccessTab`) must show it to
 * the user immediately and never re-fetch/persist it — subsequent
 * `GET /api/access-tokens` calls return plain `AccessTokenJson` rows with no
 * `token` field at all.
 */
export type CreatedAccessTokenJson = AccessTokenJson & { token: string };

/** `GET /api/access-tokens` response envelope. */
export type AccessTokensResponse = { tokens: AccessTokenJson[] };
