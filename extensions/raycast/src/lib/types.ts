/**
 * The capture/search contract this extension speaks — mirrors
 * `packages/api/src/query-schemas.ts` and `packages/api/src/link-json.ts`.
 * Extensions define their own types rather than importing `@silo/core`/
 * `@silo/api` (see `docs/rules/architecture.md` — extensions are plain HTTP
 * clients, enforced by the `extensions/**` biome `noRestrictedImports`
 * override), so this is a deliberate, minimal duplication of only the
 * fields this extension actually uses.
 */

/**
 * `POST /api/links` request body. `source` is stamped centrally by
 * `captureLink` (`capture-client.ts`) as `'raycast'` for both commands that
 * funnel through it, not threaded in by callers — see the capture-source
 * design spec.
 */
export type CaptureRequest = {
  url: string;
  tags?: string[];
  note?: string;
  sourceKind?: 'link' | 'hacker_news' | 'twitter';
  source?: 'raycast';
};

/** Source-specific display data — the subset of `SourceData`'s variants this extension renders in the detail pane. Mirrors `packages/core/src/links/source-data.ts`. Not exported on its own — only used here as `CapturedLink['sourceData']`'s type. */
type SourceData =
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

/** The subset of `LinkJson` this extension reads. */
export type CapturedLink = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  /** The captured og:image (or equivalent) for a plain `link` source — the detail pane's image gate for non-YouTube/Twitter sources (Task 6). */
  imageUrl?: string | null;
  siteName: string | null;
  sourceKind: string;
  sourceData: SourceData;
  captureStatus: 'enriching' | 'full' | 'partial' | 'bare';
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** `POST /api/links` success envelope — `{ link, deduped }` per `mutate-link.ts`. */
export type CaptureResponse = {
  link: CapturedLink;
  deduped: boolean;
};

/** `GET /api/links/search` success envelope. */
export type SearchResponse = {
  results: (CapturedLink & { rank: number })[];
};

/** The API's error envelope (`packages/api/src/app.ts`'s `ErrorEnvelope`). */
export type ApiErrorEnvelope = {
  error: string;
  message: string;
  details?: unknown;
};

/** A trashed link — `GET /api/trash`'s rows carry `deletedAt` alongside the normal `CapturedLink` fields. */
export type TrashLink = CapturedLink & { deletedAt: string };

/** `GET /api/tags`'s per-tag entry. */
export type TagWithCount = { name: string; count: number };

/** `GET /api/counts`'s envelope — only the fields this extension reads. */
export type Counts = { total?: number; trashed?: number; purgeWindowDays: number };

/** `GET /api/links` success envelope (Browse). */
export type BrowseResponse = { links: CapturedLink[]; nextCursor?: string };

/** `GET /api/trash` success envelope. */
export type TrashResponse = { links: TrashLink[]; nextCursor?: string };

/** `GET /api/tags` success envelope. */
export type TagsResponse = { tags: TagWithCount[] };

/** The single-link envelope shared by edit/tag/trash/restore/retry endpoints. */
export type LinkResponse = { link: CapturedLink };
