import { db, links } from '@silo/db';
import { and, desc, sql } from 'drizzle-orm';
import {
  decodeTrashCursor,
  effectiveLimit,
  encodeTrashCursor,
  hydrateTags,
  type LinkWithTags,
  type PageParams,
} from './pagination.js';

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
