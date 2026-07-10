/**
 * The CLI's OWN copy of the API's JSON response shapes — mirrors
 * `packages/api/src/link-json.ts`'s `LinkJson`/`SearchResultJson` and each
 * route's response envelope field-for-field. Deliberately NOT imported from
 * `@silo/api` or `@silo/core` (adapters don't share types across the
 * workspace boundary, and `@silo/core`'s barrel value-imports `@silo/db` ->
 * `pg` at module top level — see `docs/rules/architecture.md` and
 * `packages/web/src/api/types.ts`'s identical doc comment, which this file
 * mirrors the reasoning of). Every date field is `string` (ISO), never
 * `Date` — HTTP JSON has no native date type.
 */

/**
 * Mirrors `@silo/core`'s `SourceData` union (`packages/core/src/links/
 * source-data.ts`) field-for-field — same posture as `packages/web/src/api/
 * types.ts`'s `SourceData` copy. The CLI only ever WRITES a `twitter`
 * variant (via `silo ingest x`) and reads/displays whatever variant a link
 * already has; it never constructs the other variants.
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

/** Mirrors `LinkJson` in `packages/api/src/link-json.ts`. */
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
  /** Mirrors `LinkJson['captureStatus']` in `packages/api/src/link-json.ts`. Inlined (not a named export) — nothing outside this field needs the alias. */
  captureStatus: 'enriching' | 'full' | 'partial' | 'bare';
  /** Mirrors `LinkJson['addedBy']` in `packages/api/src/link-json.ts`. Inlined (not a named export) — nothing outside this field needs the alias. */
  addedBy: 'user' | 'agent';
  /** Mirrors `LinkJson['source']` in `packages/api/src/link-json.ts` (capture-source slice) — the capture SURFACE, orthogonal to `addedBy`'s who. Inlined union, same style as the fields above. */
  source: 'web' | 'mcp' | 'cli' | 'raycast' | 'chrome' | 'ingest' | 'unknown';
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** `LinkJson` plus a search `rank` — `GET /api/links/search`'s per-result shape. */
export type SearchResultJson = LinkJson & { rank: number };

/** `GET /api/links` response envelope. */
export type LinksResponse = { links: LinkJson[]; nextCursor?: string };

/** `GET /api/links/search` response envelope. */
export type SearchResponse = { results: SearchResultJson[]; nextCursor?: string };

/** `GET /api/links/:id` response envelope. */
export type LinkResponse = { link: LinkJson };

/**
 * `POST /api/links` (capture) response envelope — mirrors `links-write.ts`'s
 * `c.json({ link, deduped }, 201)`. `deduped` is `true` when the URL had
 * already been captured and the write merged into the existing row rather
 * than creating a new one.
 */
export type CaptureResponse = { link: LinkJson; deduped: boolean };

/**
 * `POST /api/links` (capture) request body — mirrors `captureBodySchema`
 * (`packages/api/src/query-schemas.ts`). `source` is stamped centrally by
 * `Client.capture` as `'cli'` for every capture through this client, not
 * threaded in by callers — see the capture-source design spec.
 */
export type CaptureRequest = {
  url: string;
  tags?: string[];
  note?: string;
  sourceKind?: 'link' | 'hacker_news' | 'twitter';
  source?: 'cli';
};

/**
 * `POST /api/ingest` request body — mirrors `ingestBodySchema`
 * (`packages/api/src/query-schemas.ts`). The only request shape that may
 * carry `sourceData`; requires `Authorization: Bearer <SILO_API_TOKEN>` (see
 * `packages/api/src/ingest-auth.ts`). `source` is stamped centrally by
 * `Client.ingest` as `'cli'` — see the capture-source design spec.
 */
export type IngestRequest = {
  url: string;
  sourceKind?: 'link' | 'hacker_news' | 'twitter';
  note?: string;
  tags?: string[];
  sourceData?: SourceData;
  source?: 'cli';
};

/**
 * Mirrors `ErrorEnvelope` in `packages/api/src/app.ts` — every non-2xx JSON
 * body the API returns has this shape.
 */
export type ApiErrorBody = {
  error: string;
  message: string;
  details?: unknown;
};

/** `GET /health` response shape (see `packages/api/src/app.ts`). */
export type HealthResponse = { status: string };
