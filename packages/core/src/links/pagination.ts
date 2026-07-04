import { linkTags, tags } from '@silo/db';
import { eq, inArray } from 'drizzle-orm';
import type { Executor, Link } from './executor.js';

/** A `Link` with its tag names attached, sorted for stable output. */
export type LinkWithTags = Link & { tags: string[] };

/** Shared page-request shape for `list`/`search`. */
export type PageParams = {
  limit?: number;
  cursor?: string;
};

/** Default page size when `limit` is omitted. */
const DEFAULT_LIMIT = 20;
/** Hard cap — an agent cannot page 10k rows into its own context. */
const MAX_LIMIT = 100;
/** Floor — a limit of 0 (or negative) still returns at least one row. */
const MIN_LIMIT = 1;

/**
 * Hard cap on a `search` offset cursor (~100 pages of the max page size,
 * `MAX_LIMIT * 100`). `search` pages via `OFFSET`, which on a populated
 * corpus means every page is a full sort-then-discard of every row up to
 * `offset` — an unbounded/forged offset is a self-inflicted perf DoS with no
 * ceiling. Beyond this depth, reject rather than silently clamp: an agent
 * asking for a page this deep almost certainly forged or corrupted the
 * cursor, and should get a typed pagination error, not a slow query.
 */
const MAX_OFFSET = MAX_LIMIT * 100;

/** Matches the standard 8-4-4-4-12 hex UUID form (any RFC 4122 version/variant). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Clamp a requested `limit` into `[1, 100]`, defaulting to 20 when omitted
 * or non-finite (e.g. `NaN` from a malformed caller) — a bad `limit` never
 * reaches the query as an invalid value.
 */
export function effectiveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), MIN_LIMIT), MAX_LIMIT);
}

/**
 * Thrown when a cursor string fails to decode, or decodes to a shape that
 * doesn't match the tool that received it (e.g. a `list` keyset cursor
 * handed to `search`, which expects an offset cursor). Never thrown away
 * silently — an agent-facing pagination bug should be loud, not a silent
 * wrong-page result.
 */
export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

/** The opaque keyset cursor payload for `list` — position on `(createdAt, id)` DESC. */
type ListCursorPayload = {
  kind: 'list';
  createdAt: string;
  id: string;
};

/** The opaque offset cursor payload for `search` — position is a row offset. */
type SearchCursorPayload = {
  kind: 'search';
  offset: number;
};

/**
 * The opaque keyset cursor payload for `listTrash` (plan 007, C2) — position
 * on `(deletedAt, id)` DESC. A DISTINCT `kind` from `ListCursorPayload` (which
 * shares the same `{ createdAt/deletedAt, id }` shape) so a `list` cursor can
 * never be silently accepted by `listTrash` (or vice versa) — see
 * `decodeTrashCursor`.
 */
type TrashCursorPayload = {
  kind: 'trash';
  deletedAt: string;
  id: string;
};

function encode(payload: ListCursorPayload | SearchCursorPayload | TrashCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decode(cursor: string): unknown {
  let json: string;
  try {
    json = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError('cursor is not valid base64url');
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new InvalidCursorError('cursor did not decode to valid JSON');
  }
}

/**
 * Encode a `list` keyset cursor for the last row of the current page.
 *
 * `createdAt` is the FULL-microsecond-precision text rendering of the row's
 * `created_at` (from Postgres via `${links.createdAt}::text`), NOT a JS
 * `Date`: node-postgres parses `timestamptz` into a `Date` at millisecond
 * precision, so a `Date`-derived cursor would silently lose the microseconds
 * the keyset predicate needs to break ties exactly against the raw column
 * (see `afterListCursor`). The raw string is stored opaquely and cast back to
 * `timestamptz` at query time — it is never re-parsed in JS.
 */
export function encodeListCursor(createdAt: string, id: string): string {
  return encode({ kind: 'list', createdAt, id });
}

/** Decode + validate a `list` keyset cursor. Throws `InvalidCursorError` on any mismatch. */
export function decodeListCursor(cursor: string): { createdAt: string; id: string } {
  const parsed = decode(cursor);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { kind?: unknown }).kind !== 'list' ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== 'string' ||
    typeof (parsed as { id?: unknown }).id !== 'string'
  ) {
    throw new InvalidCursorError('cursor is not a valid list cursor');
  }
  const payload = parsed as ListCursorPayload;
  // Validate `createdAt` parses as a real instant (rejects garbage/injection
  // in the string that will be cast to `timestamptz`), WITHOUT round-tripping
  // through the parsed `Date` — the original full-precision string is what's
  // forwarded to the query, so the microseconds survive.
  if (Number.isNaN(new Date(payload.createdAt).getTime())) {
    throw new InvalidCursorError('cursor createdAt is not a valid date');
  }
  if (!UUID_RE.test(payload.id)) {
    throw new InvalidCursorError('cursor id is not a valid uuid');
  }
  return { createdAt: payload.createdAt, id: payload.id };
}

/**
 * Encode a `listTrash` keyset cursor for the last row of the current page.
 *
 * `deletedAt` is the FULL-microsecond-precision text rendering of the row's
 * `deleted_at` (from Postgres via `${links.deletedAt}::text`), NOT a JS
 * `Date` — same rationale as `encodeListCursor`'s `createdAt`: node-postgres
 * parses `timestamptz` into a `Date` at millisecond precision, which would
 * silently lose the microseconds the keyset predicate needs to break ties
 * exactly against the raw column (see `links.ts`'s `afterTrashCursor`). The
 * raw string is stored opaquely and cast back to `timestamptz` at query
 * time — it is never re-parsed in JS.
 */
export function encodeTrashCursor(deletedAt: string, id: string): string {
  return encode({ kind: 'trash', deletedAt, id });
}

/** Decode + validate a `listTrash` keyset cursor. Throws `InvalidCursorError` on any mismatch. */
export function decodeTrashCursor(cursor: string): { deletedAt: string; id: string } {
  const parsed = decode(cursor);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { kind?: unknown }).kind !== 'trash' ||
    typeof (parsed as { deletedAt?: unknown }).deletedAt !== 'string' ||
    typeof (parsed as { id?: unknown }).id !== 'string'
  ) {
    throw new InvalidCursorError('cursor is not a valid trash cursor');
  }
  const payload = parsed as TrashCursorPayload;
  // Validate `deletedAt` parses as a real instant, WITHOUT round-tripping
  // through the parsed `Date` — see `decodeListCursor`'s identical note.
  if (Number.isNaN(new Date(payload.deletedAt).getTime())) {
    throw new InvalidCursorError('cursor deletedAt is not a valid date');
  }
  if (!UUID_RE.test(payload.id)) {
    throw new InvalidCursorError('cursor id is not a valid uuid');
  }
  return { deletedAt: payload.deletedAt, id: payload.id };
}

/** Encode a `search` offset cursor pointing at the next unread row. */
export function encodeSearchCursor(offset: number): string {
  return encode({ kind: 'search', offset });
}

/** Decode + validate a `search` offset cursor. Throws `InvalidCursorError` on any mismatch. */
export function decodeSearchCursor(cursor: string): { offset: number } {
  const parsed = decode(cursor);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { kind?: unknown }).kind !== 'search' ||
    typeof (parsed as { offset?: unknown }).offset !== 'number' ||
    !Number.isSafeInteger((parsed as { offset: number }).offset) ||
    (parsed as { offset: number }).offset < 0
  ) {
    throw new InvalidCursorError('cursor is not a valid search cursor');
  }
  const offset = (parsed as SearchCursorPayload).offset;
  if (offset > MAX_OFFSET) {
    throw new InvalidCursorError('cursor offset exceeds maximum');
  }
  return { offset };
}

/**
 * Batched tag hydration: ONE query over `link_tags ⋈ tags` for every id in
 * `rows`, grouped in memory — never N+1 per row. Each link's `tags` array is
 * sorted for stable, agent-friendly output; a link with no tags gets `[]`.
 * Input order is preserved in the output. Empty input short-circuits without
 * querying.
 */
export async function hydrateTags(exec: Executor, rows: Link[]): Promise<LinkWithTags[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const tagRows = await exec
    .select({ linkId: linkTags.linkId, name: tags.name })
    .from(linkTags)
    .innerJoin(tags, eq(tags.id, linkTags.tagId))
    .where(inArray(linkTags.linkId, ids));

  const tagsByLinkId = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsByLinkId.get(row.linkId);
    if (existing) {
      existing.push(row.name);
    } else {
      tagsByLinkId.set(row.linkId, [row.name]);
    }
  }

  return rows.map((row) => ({
    ...row,
    tags: (tagsByLinkId.get(row.id) ?? []).sort(),
  }));
}
