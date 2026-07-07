/**
 * The capture/search contract this extension speaks — mirrors
 * `packages/api/src/query-schemas.ts` and `packages/api/src/link-json.ts`.
 * Extensions define their own types rather than importing `@silo/core`/
 * `@silo/api` (see `docs/rules/architecture.md` — extensions are plain HTTP
 * clients, enforced by the `extensions/**` biome `noRestrictedImports`
 * override), so this is a deliberate, minimal duplication of only the
 * fields this extension actually uses.
 */

/** `POST /api/links` request body. */
export type CaptureRequest = {
  url: string;
  tags?: string[];
  note?: string;
  sourceKind?: 'link' | 'hacker_news' | 'twitter';
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
