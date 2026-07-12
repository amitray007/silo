import { db, links } from '@silo/db';
import { and, desc, sql } from 'drizzle-orm';
import type { SearchPage } from './links.js';
import { buildSnippetHeadline, tagSearchVector } from './links.js';
import {
  decodeTrashCursor,
  effectiveLimit,
  encodeTrashCursor,
  hydrateTags,
  type LinkWithTags,
  type PageParams,
} from './pagination.js';
import { runUnionSearch } from './search-query.js';

/**
 * Reads of TRASHED links (`deleted_at IS NOT NULL`) — quarantined in this
 * module, separate from `links.ts`, on purpose.
 *
 * Every read in `links.ts` is deliberately scoped through `whereLive`
 * (`deleted_at IS NULL`) — see `live.ts`'s doc comment: that helper exists so
 * no query can forget to exclude trashed rows. `listTrash` below is the ONE
 * read in this codebase that intentionally does the opposite: it selects
 * ONLY trashed rows, for the mockup's Trash screen. It must NEVER be
 * confused with (or accidentally merged into) a live read, and it must never
 * weaken/touch `whereLive` itself — hence its own file. `countLive`/
 * `countTrash`/`getCounts` live here too since they read the same live/trash
 * split, but they don't return row data, only counts.
 */

export type TrashPage = {
  links: LinkWithTags[];
  nextCursor?: string;
};

/** Selects `deleted_at` as full-precision text (Postgres renders all 6
 * fractional-second digits) — the value carried in the keyset cursor. Mirrors
 * `links.ts`'s `createdAtText` for the identical reason: see `afterTrashCursor`. */
const deletedAtText = sql<string>`${links.deletedAt}::text`;

/**
 * Keyset predicate for `listTrash`'s `(deleted_at, id)` DESC ordering: rows
 * strictly "after" the cursor row, i.e. `deleted_at < c.deletedAt OR
 * (deleted_at = c.deletedAt AND id < c.id)`.
 *
 * `deletedAt` (a full-microsecond-precision string, via `deletedAtText`) is
 * cast back to `timestamptz` and compared against the RAW `links.deletedAt`
 * column — the same raw column the `ORDER BY deleted_at DESC, id DESC` sorts
 * on, so the WHERE predicate and the ORDER BY agree at identical precision.
 * This mirrors `links.ts`'s `afterListCursor` EXACTLY, and for the identical
 * reason: node-postgres parses `timestamptz` into a JS `Date` (millisecond
 * precision), so a cursor built from the parsed `Date` would be lossy,
 * dropping rows that tie at millisecond resolution but differ at microsecond
 * resolution across a page boundary. Do NOT reintroduce that bug here by
 * truncating either side to millisecond precision.
 */
function afterTrashCursor(deletedAt: string, id: string): ReturnType<typeof sql> {
  const cursorDeletedAt = sql`${deletedAt}::timestamptz`;
  return sql`(${links.deletedAt} < ${cursorDeletedAt} OR (${links.deletedAt} = ${cursorDeletedAt} AND ${links.id} < ${id}))`;
}

/**
 * List TRASHED links (`deleted_at IS NOT NULL`), newest-trashed-first
 * (`ORDER BY deleted_at DESC, id DESC` — the most recently deleted item shows
 * at the top of the Trash screen), tag-hydrated and keyset-paginated on
 * `(deletedAt, id)`. `limit` is clamped to `[1, 100]` (default 20).
 *
 * A cursor from `list`/`search` (or any non-`'trash'`-kind cursor) throws
 * `InvalidCursorError` — see `decodeTrashCursor` — rather than silently
 * misinterpreting a `list` keyset as a trash keyset (both currently happen to
 * share a `{ x, id }` shape, so the `kind` tag is what keeps them from being
 * cross-fed).
 */
export async function listTrash(page: PageParams = {}): Promise<TrashPage> {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor !== undefined ? decodeTrashCursor(page.cursor) : undefined;
  const cursorCondition = cursor ? afterTrashCursor(cursor.deletedAt, cursor.id) : undefined;

  const trashedCondition = sql`${links.deletedAt} is not null`;
  const where = cursorCondition ? and(trashedCondition, cursorCondition) : trashedCondition;

  const rows = await db
    .select({ link: links, deletedAtText })
    .from(links)
    .where(where)
    .orderBy(desc(links.deletedAt), desc(links.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page_ = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page_.at(-1);
  const nextCursor =
    hasMore && lastRow ? encodeTrashCursor(lastRow.deletedAtText, lastRow.link.id) : undefined;

  const hydrated = await hydrateTags(
    db,
    page_.map((row) => row.link),
  );
  return nextCursor === undefined ? { links: hydrated } : { links: hydrated, nextCursor };
}

/**
 * Union search (search-union rework: single query, FTS OR trigram, never
 * gated on the other's row count) over TRASHED links (`deleted_at IS NOT
 * NULL`) — the Trash-scoped mirror of `links.ts`'s `search`. Delegates to
 * the SAME `runUnionSearch` helper `search` uses (see `search-query.ts`),
 * swapping ONLY the live/trash predicate: `whereLive(...)` becomes the
 * trashed condition (`deleted_at IS NOT NULL`), and `search`'s optional
 * `filter.tag` EXISTS scope is never passed (`searchTrash` has no
 * tag-filter parameter). Reuses `search`'s exported
 * `SearchPage`/`tagSearchVector` rather than a hand-duplicated copy — see
 * `tagSearchVector`'s doc comment in `links.ts` for why sharing that
 * subquery matters here specifically (jscpd, drift risk); `runUnionSearch`
 * is the same sharing discipline applied to the query-assembly control flow
 * itself.
 *
 * Deliberately quarantined in THIS file, not `links.ts` — same rationale as
 * `listTrash`: every trash-scoped read lives here, never mixed with the
 * `whereLive`-scoped reads in `links.ts`, so a query can never accidentally
 * cross the live/trash boundary. `limit` clamped to `[1, 100]` (default 20)
 * via `effectiveLimit`; pagination uses the SAME bounded plain offset cursor
 * as live `search` (`encodeSearchCursor`/`decodeSearchCursor` — `kind:
 * 'search'`, so a cursor from `searchTrash` and a cursor from live `search`
 * are interchangeable: an offset is just a position within a result set,
 * not tied to which predicate produced it).
 */
export async function searchTrash(query: string, page: PageParams = {}): Promise<SearchPage> {
  const trashedCondition = sql`${links.deletedAt} is not null`;
  // `snippet` (agent-navigation slice U2): same query-focused `ts_headline`
  // excerpt live `search` returns — see `buildSnippetHeadline`'s doc comment.
  // No `filter`/`sort` params here (main's agent-navigation slice only added
  // those to live `search`, not `searchTrash`) — `runUnionSearch`'s `options`
  // default to relevance-only ordering with no extra conditions when omitted.
  return runUnionSearch(trashedCondition, tagSearchVector, query, undefined, page, {
    snippetFor: (tsQuery) => buildSnippetHeadline(tsQuery),
  });
}

/** Count of LIVE links (`deleted_at IS NULL`) — the sidebar's total count. */
export async function countLive(): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(links)
    .where(sql`${links.deletedAt} is null`);
  return Number(row?.count ?? 0);
}

/** Count of TRASHED links (`deleted_at IS NOT NULL`) — the sidebar's Trash count. */
export async function countTrash(): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(links)
    .where(sql`${links.deletedAt} is not null`);
  return Number(row?.count ?? 0);
}

export type Counts = {
  live: number;
  trash: number;
};

/**
 * Both `countLive` and `countTrash` in ONE round-trip, via `FILTER (WHERE
 * ...)` on a single `count(*)` scan — the sidebar wants both numbers
 * together (live total + trash total) and a single query is cheaper than two
 * separate round-trips for the same read. Prefer this over calling
 * `countLive`/`countTrash` individually when both are needed; they remain
 * exported too for callers that only want one.
 */
export async function getCounts(): Promise<Counts> {
  const [row] = await db
    .select({
      live: sql<string>`count(*) filter (where ${links.deletedAt} is null)`,
      trash: sql<string>`count(*) filter (where ${links.deletedAt} is not null)`,
    })
    .from(links);
  return { live: Number(row?.live ?? 0), trash: Number(row?.trash ?? 0) };
}

/**
 * Permanently delete ONE trashed link (plan 007, C3) — the mockup's per-row
 * "delete now", bypassing `purgeTrash`'s age window entirely. `link_tags`
 * rows cascade via the FK's `ON DELETE CASCADE` (see
 * `packages/db/src/schema/link-tags.ts`) — never touched directly here.
 *
 * DESTRUCTIVE — CRITICAL GUARD: this must NEVER delete a LIVE link. "Delete
 * now" is a trash-only action; a live link can only reach deletion by first
 * being soft-deleted (`softDelete`) and then hard-deleted (or reaped by
 * `purgeTrash`/`emptyTrash`). The guard is `deleted_at IS NOT NULL` INSIDE
 * the `DELETE`'s own `WHERE` clause — not a separate read-then-check — so
 * the check-and-delete is one atomic statement with no TOCTOU window: there
 * is no gap between "confirm it's trashed" and "delete it" for a concurrent
 * `restore()` to land in. If the row doesn't exist, or exists but is live,
 * the `WHERE` matches zero rows and the `DELETE` is a no-op.
 *
 * Returns whether a row was actually deleted (`rowCount > 0`), so a caller
 * can distinguish "deleted" from "already gone / not trashed" without a
 * separate existence check — mirrors `purgeTrash`'s "return the count"
 * discipline at the single-row scale.
 */
export async function hardDelete(id: string): Promise<boolean> {
  const deleted = await db.execute<{ id: string }>(sql`
    delete from ${links}
    where ${links.id} = ${id}
      and ${links.deletedAt} is not null
    returning id
  `);
  return deleted.rows.length > 0;
}

/**
 * Permanently delete ALL trashed links (plan 007, C3) — the mockup's "empty
 * now", regardless of age (distinct from `purgeTrash`, which is age-gated
 * and batched for a large unattended backlog). Returns the count deleted.
 * `link_tags` rows cascade via the FK, same as `hardDelete`/`purgeTrash`.
 *
 * DESTRUCTIVE — same guard discipline as `hardDelete`: the `deleted_at IS NOT
 * NULL` predicate lives in the `DELETE`'s own `WHERE` clause, so a live link
 * can never be matched. Unlike `purgeTrash`, this is not batched — "empty
 * now" is a deliberate, bounded, user-initiated action on a personal store's
 * trash (not an unattended sweep of an unbounded backlog), so one statement
 * is the simpler and sufficient tool here.
 */
export async function emptyTrash(): Promise<number> {
  const deleted = await db.execute<{ id: string }>(sql`
    delete from ${links}
    where ${links.deletedAt} is not null
    returning id
  `);
  return deleted.rows.length;
}
