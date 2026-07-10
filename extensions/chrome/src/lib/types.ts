/**
 * The capture contract this extension speaks — mirrors `packages/api/src/
 * query-schemas.ts`'s `captureBodySchema` and `packages/api/src/link-json.ts`'s
 * `LinkJson`. Extensions define their own types rather than importing
 * `@silo/core`/`@silo/api` (see `docs/rules/architecture.md` — extensions are
 * plain HTTP clients, enforced by the `extensions/**` biome
 * `noRestrictedImports` override), so this is a deliberate, minimal
 * duplication of only the fields this extension actually uses.
 */

/**
 * `POST /api/links` request body. `source` is stamped centrally by
 * `captureLink` (`capture-client.ts`) as `'chrome'` for every entry point
 * that funnels through it, not threaded in by callers — see the
 * capture-source design spec.
 */
export type CaptureRequest = {
  url: string;
  tags?: string[];
  note?: string;
  sourceKind?: 'link' | 'hacker_news' | 'twitter';
  source?: 'chrome';
};

/** The subset of `LinkJson` this extension reads (save + edit-card). */
export type CapturedLink = {
  id: string;
  url: string;
  title: string | null;
  notes: string | null;
  tags: string[];
};

/** `POST /api/links` success envelope — `{ link, deduped }` per `mutate-link.ts`. */
export type CaptureResponse = {
  link: CapturedLink;
  deduped: boolean;
};

/** `GET /api/tags` success envelope entry — `{ name, count }`. */
export type TagWithCount = {
  name: string;
  count: number;
};

/** The edit card's editable state (mirrors what the UI holds). */
export type EditState = { note: string; tags: string[] };

/** The minimal set of changes to apply — note (replace) + tag add/remove. */
export type EditDiff = { note?: string; addedTags: string[]; removedTags: string[] };

/** The API's error envelope (`packages/api/src/app.ts`'s `ErrorEnvelope`). */
export type ApiErrorEnvelope = {
  error: string;
  message: string;
  details?: unknown;
};
