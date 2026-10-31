import { db, links, readingPositions } from '@silo/db';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './executor.js';
import { assertLibraryWrite } from './library-write.js';
import { whereLibrary } from './live.js';

/**
 * Where the reader stopped in one link's article. `position` is a share of the
 * article's words, from 0 (the start) to 1 (the end). `updatedAt` is when it
 * was saved.
 */
export type ReadingPosition = { position: number; updatedAt: Date };

/** Thrown when a position is not a finite number from 0 to 1. */
export class InvalidReadingPositionError extends Error {
  readonly code = 'invalid_reading_position';
  constructor() {
    super('invalid_reading_position: position must be a finite number from 0 to 1.');
    this.name = 'InvalidReadingPositionError';
  }
}

function assertValidPosition(position: number): void {
  if (!Number.isFinite(position) || position < 0 || position > 1) {
    throw new InvalidReadingPositionError();
  }
}

/** The saved position of a link, or `null` when none is saved (or the link is not live). */
export async function getReadingPosition(linkId: string): Promise<ReadingPosition | null> {
  const [row] = await db
    .select({ position: readingPositions.position, updatedAt: readingPositions.updatedAt })
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
 * Last write wins on purpose. The web client sends one request at a time per link and queues
 * the newest position behind it, so a slow earlier request cannot land after a later one from
 * the same tab. The request carries no timestamp, so there is nothing to guard the upsert with;
 * two tabs reading the same article race, and the later request wins.
 */
export async function setReadingPosition(
  linkId: string,
  position: number,
): Promise<ReadingPosition | null> {
  assertValidPosition(position);
  await assertLibraryWrite(linkId);
  const [saved] = await db
    .insert(readingPositions)
    .select(
      db
        .select({
          linkId: links.id,
          position: sql<number>`${position}::real`.as('position'),
          updatedAt: sql<Date>`now()`.as('updated_at'),
        })
        .from(links)
        .where(whereLibrary(eq(links.id, linkId))),
    )
    .onConflictDoUpdate({
      target: readingPositions.linkId,
      set: { position: sql`excluded.position`, updatedAt: sql`excluded.updated_at` },
    })
    .returning({ position: readingPositions.position, updatedAt: readingPositions.updatedAt });
  return saved ?? null;
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
          updatedAt: readingPositions.updatedAt,
        })
        .from(readingPositions)
        .where(eq(readingPositions.linkId, fromLinkId)),
    )
    .onConflictDoUpdate({
      target: readingPositions.linkId,
      set: { position: sql`excluded.position`, updatedAt: sql`excluded.updated_at` },
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
  await db
    .insert(readingPositions)
    .select(
      db
        .select({
          linkId: links.id,
          position: sql<number>`${saved.position}::real`.as('position'),
          updatedAt: sql<Date>`${saved.updatedAt.toISOString()}::timestamptz`.as('updated_at'),
        })
        .from(links)
        .where(whereLibrary(eq(links.id, linkId))),
    )
    .onConflictDoUpdate({
      target: readingPositions.linkId,
      set: { position: sql`excluded.position`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`excluded.updated_at > ${readingPositions.updatedAt}`,
    });
}
