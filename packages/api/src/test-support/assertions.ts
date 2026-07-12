import type { Hono } from 'hono';
import { expect } from 'vitest';
import type { ErrorEnvelope } from '../app.js';

/**
 * Shared HTTP-level test assertions used across the A2 route test suites
 * (`links.test.ts`/`trash.test.ts`/`tags.test.ts`/`counts.test.ts`) — factored
 * out once the same request-then-assert patterns were duplicated verbatim
 * across those files and tripped jscpd. Lives under `test-support/` (the
 * documented carve-out for test-only code — see `docs/rules/api-hono.md`),
 * never imported by production route/app code.
 */

/** The whitelisted-response field names every `LinkJson`-shaped body must carry. */
const LINK_JSON_FIELDS = [
  'id',
  'url',
  'title',
  'description',
  'imageUrl',
  'siteName',
  'extractedText',
  'sourceKind',
  'sourceData',
  'captureStatus',
  'addedBy',
  'source',
  'notes',
  'tags',
  'createdAt',
  'updatedAt',
] as const;

/** Asserts `json` carries exactly the whitelisted `LinkJson` fields (including `sourceData` — whitelisted since the source-data/rich-previews slice, plan 012 — and `source`, whitelisted since the capture-source slice) and none of the internal-only ones (`searchVector`/`canonicalUrl`/`deletedAt`). */
export function expectWhitelistedLinkShape(json: Record<string, unknown>): void {
  for (const field of LINK_JSON_FIELDS) {
    expect(Object.hasOwn(json, field)).toBe(true);
  }
  expect(Object.hasOwn(json, 'searchVector')).toBe(false);
  expect(Object.hasOwn(json, 'canonicalUrl')).toBe(false);
  expect(Object.hasOwn(json, 'deletedAt')).toBe(false);
}

/**
 * The whitelisted-response field names a `list`/`search` RESULT ROW carries
 * (agent-navigation slice U5): `LINK_JSON_FIELDS` minus `extractedText`,
 * plus `snippet` — mirrors `link-json.ts`'s `SnippetLinkJson`.
 */
const SNIPPET_LINK_JSON_FIELDS = [
  ...LINK_JSON_FIELDS.filter((field) => field !== 'extractedText'),
  'snippet',
] as const;

/**
 * Asserts `json` carries exactly the whitelisted `SnippetLinkJson` fields
 * (agent-navigation slice U5) — the shape `GET /api/links`/
 * `GET /api/links/search`/`GET /api/links/:id/related` results carry:
 * `snippet` present, `extractedText` and the same internal-only fields
 * `expectWhitelistedLinkShape` guards ABSENT.
 */
export function expectWhitelistedSnippetShape(json: Record<string, unknown>): void {
  for (const field of SNIPPET_LINK_JSON_FIELDS) {
    expect(Object.hasOwn(json, field)).toBe(true);
  }
  expect(Object.hasOwn(json, 'extractedText')).toBe(false);
  expect(Object.hasOwn(json, 'searchVector')).toBe(false);
  expect(Object.hasOwn(json, 'canonicalUrl')).toBe(false);
  expect(Object.hasOwn(json, 'deletedAt')).toBe(false);
}

/** Requests `path` on `app` and asserts the response is a 400 with the given `error` code — the shared shape of every "bad input" test across the read routes. */
export async function expect400(
  app: Hono,
  path: string,
  errorCode: string,
): Promise<ErrorEnvelope> {
  const res = await app.request(path);
  expect(res.status).toBe(400);
  const body = (await res.json()) as ErrorEnvelope;
  expect(body.error).toBe(errorCode);
  return body;
}

/** Requests `path` on `app`, asserts 200, and returns the parsed JSON body — the shared shape of every "happy path" read assertion. */
export async function expectOk<T>(app: Hono, path: string): Promise<T> {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

/**
 * Walks every page of a paginated GET route via its `nextCursor`, small
 * `limit` (to force multiple pages), a bounded guard against an infinite
 * loop on a pagination bug — and returns every id seen, in page order.
 * `basePath` may already carry other query params (e.g. `?tag=foo`); this
 * appends `limit`/`cursor` to it. Factored out once `/api/links` and
 * `/api/trash`'s "paginates" tests duplicated this loop verbatim (mirrors
 * `@silo/core`'s own `trash.test.ts`'s identical `walkAllTrashPages` helper,
 * one per adapter/layer since each drives a different transport).
 */
export async function walkAllPages(
  app: Hono,
  basePath: string,
  pageLimit = 2,
  guardLimit = 20,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  let guard = 0;
  const separator = basePath.includes('?') ? '&' : '?';
  do {
    const qs = new URLSearchParams({ limit: String(pageLimit) });
    if (cursor !== undefined) qs.set('cursor', cursor);
    const body = await expectOk<{ links: Array<{ id: string }>; nextCursor?: string }>(
      app,
      `${basePath}${separator}${qs.toString()}`,
    );
    expect(body.links.length).toBeLessThanOrEqual(pageLimit);
    seen.push(...body.links.map((l) => l.id));
    cursor = body.nextCursor;
    guard++;
  } while (cursor !== undefined && guard < guardLimit);
  return seen;
}
