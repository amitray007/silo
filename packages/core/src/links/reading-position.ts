import { db, links, readingPositions } from '@silo/db';
import { desc, eq, sql } from 'drizzle-orm';
import type { Tx } from './executor.js';
import { assertLibraryWrite } from './library-write.js';
import { whereLibrary } from './live.js';
import { decodeReaderCursor, effectiveLimit, encodeReaderCursor } from './pagination.js';

/**
 * Where the reader stopped in one link's article. `position` is a share of the
 * article's words, from 0 (the start) to 1 (the end). `updatedAt` is when it
 * was saved.
 */
export type ReadingPositionSource = 'pencil' | 'listen' | 'mark';
export type ReadingPosition = { position: number; source: ReadingPositionSource; updatedAt: Date };

/** Thrown when a position is not a finite number from 0 to 1. */
export class InvalidReadingPositionError extends Error {
  readonly code = 'invalid_reading_position';
  constructor() {
    super('invalid_reading_position: position must be a finite number from 0 to 1.');
    this.name = 'InvalidReadingPositionError';
  }
}

function assertValidSource(source: ReadingPositionSource): void {
  if (!['pencil', 'listen', 'mark'].includes(source)) throw new InvalidReadingPositionError();
}

function assertValidPosition(position: number): void {
  if (!Number.isFinite(position) || position < 0 || position > 1) {
    throw new InvalidReadingPositionError();
  }
}

/** The saved position of a link, or `null` when none is saved (or the link is not live). */
export async function getReadingPosition(linkId: string): Promise<ReadingPosition | null> {
  const [row] = await db
    .select({
      position: readingPositions.position,
      source: readingPositions.source,
      updatedAt: readingPositions.updatedAt,
    })
    .from(readingPositions)
    .innerJoin(links, eq(links.id, readingPositions.linkId))
    .where(whereLibrary(eq(readingPositions.linkId, linkId)));
  return row ?? null;
}

/**
 * Save (or overwrite) the position of a live library link. Returns the saved
 * position, or `null` when the link is unknown or trashed. Throws
 * `InvalidReadingPositionError` for a value outside 0..1 or not finite, and
 * `FeedPostNotEditableError` for a feed post. The write goes to its own table,
 * so it never bumps `links.updated_at`.
 *
 * Web writes carry a monotonically increasing timestamp, including pagehide writes that must
 * leave immediately. The upsert ignores older timestamps even if those requests arrive late.
 * A timestamp ahead of the server clock is clamped to now, so a fast client clock cannot
 * block later writes.
 * Callers that omit the timestamp retain server-time, last-write-wins behavior.
 */
export async function setReadingPosition(
  linkId: string,
  position: number,
  source: ReadingPositionSource = 'pencil',
  writtenAt?: Date,
): Promise<ReadingPosition | null> {
  assertValidPosition(position);
  assertValidSource(source);
  if (writtenAt && !Number.isFinite(writtenAt.getTime())) throw new InvalidReadingPositionError();
  await assertLibraryWrite(linkId);
  const [saved] = await db
    .insert(readingPositions)
    .select(
      db
        .select({
          linkId: links.id,
          position: sql<number>`${position}::real`.as('position'),
          source: sql<ReadingPositionSource>`${source}::varchar`.as('source'),
          updatedAt: (writtenAt
            ? sql<Date>`least(${writtenAt.toISOString()}::timestamptz, now())`
            : sql<Date>`now()`
          ).as('updated_at'),
        })
        .from(links)
        .where(whereLibrary(eq(links.id, linkId))),
    )
    .onConflictDoUpdate({
      target: readingPositions.linkId,
      set: {
        position: sql`excluded.position`,
        source: sql`excluded.source`,
        updatedAt: sql`excluded.updated_at`,
      },
      ...(writtenAt ? { setWhere: sql`excluded.updated_at > ${readingPositions.updatedAt}` } : {}),
    })
    .returning({
      position: readingPositions.position,
      source: readingPositions.source,
      updatedAt: readingPositions.updatedAt,
    });
  return saved ?? (writtenAt ? getReadingPosition(linkId) : null);
}

/**
 * Clear the saved position of a live library link. Returns `true` when the
 * link exists (clearing an absent position is a no-op), `false` when the link
 * is unknown or trashed.
 */
export async function clearReadingPosition(linkId: string): Promise<boolean> {
  await assertLibraryWrite(linkId);
  const [live] = await db
    .select({ id: links.id })
    .from(links)
    .where(whereLibrary(eq(links.id, linkId)));
  if (!live) return false;
  await db.delete(readingPositions).where(eq(readingPositions.linkId, linkId));
  return true;
}

/**
 * Restore-merge helper: copy `fromLinkId`'s position onto `toLinkId` when it is
 * newer than the one `toLinkId` already has (or `toLinkId` has none).
 */
export async function mergeReadingPosition(
  tx: Tx,
  fromLinkId: string,
  toLinkId: string,
): Promise<void> {
  await tx
    .insert(readingPositions)
    .select(
      tx
        .select({
          linkId: sql<string>`${toLinkId}::uuid`.as('link_id'),
          position: readingPositions.position,
          source: readingPositions.source,
          updatedAt: readingPositions.updatedAt,
        })
        .from(readingPositions)
        .where(eq(readingPositions.linkId, fromLinkId)),
    )
    .onConflictDoUpdate({
      target: readingPositions.linkId,
      set: {
        position: sql`excluded.position`,
        source: sql`excluded.source`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.updated_at > ${readingPositions.updatedAt}`,
    });
}

/**
 * Import helper: write a saved position with its original timestamp, unless the
 * link already holds a newer one. Skips a link that is not a live library link.
 */
export async function restoreReadingPosition(
  linkId: string,
  saved: ReadingPosition,
): Promise<void> {
  assertValidPosition(saved.position);
  assertValidSource(saved.source);
  await db
    .insert(readingPositions)
    .select(
      db
        .select({
          linkId: links.id,
          position: sql<number>`${saved.position}::real`.as('position'),
          source: sql<ReadingPositionSource>`${saved.source}::varchar`.as('source'),
          updatedAt: sql<Date>`${saved.updatedAt.toISOString()}::timestamptz`.as('updated_at'),
        })
        .from(links)
        .where(whereLibrary(eq(links.id, linkId))),
    )
    .onConflictDoUpdate({
      target: readingPositions.linkId,
      set: {
        position: sql`excluded.position`,
        source: sql`excluded.source`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.updated_at > ${readingPositions.updatedAt}`,
    });
}

export type ListReadingPositionsInput = {
  source?: ReadingPositionSource | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

export type LibraryReadingPosition = ReadingPosition & {
  link: { id: string; title: string | null; url: string };
};

/** Saved places on live library links, ordered by newest update then link id. */
export async function listReadingPositions(
  input: ListReadingPositionsInput = {},
): Promise<{ positions: LibraryReadingPosition[]; nextCursor?: string }> {
  const limit = effectiveLimit(input.limit);
  const cursor =
    input.cursor === undefined ? undefined : decodeReaderCursor(input.cursor, 'reading_positions');
  const rows = await db
    .select({
      link: { id: links.id, title: links.title, url: links.url },
      position: readingPositions.position,
      source: readingPositions.source,
      updatedAt: readingPositions.updatedAt,
      timestamp: sql<string>`${readingPositions.updatedAt}::text`,
    })
    .from(readingPositions)
    .innerJoin(links, eq(links.id, readingPositions.linkId))
    .where(
      whereLibrary(
        input.source === undefined ? undefined : eq(readingPositions.source, input.source),
        cursor
          ? sql`(${readingPositions.updatedAt}, ${readingPositions.linkId}) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(readingPositions.updatedAt), desc(readingPositions.linkId))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    positions: page.map(({ timestamp: _timestamp, ...row }) => row),
    ...(rows.length > limit && last
      ? { nextCursor: encodeReaderCursor('reading_positions', last.timestamp, last.link.id) }
      : {}),
  };
}
