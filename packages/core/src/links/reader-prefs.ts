import { db, linkReaderPrefs, links } from '@silo/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  mergeReader,
  parseStoredReaderPrefs,
  type ReaderPrefs,
  readerPatchSchema,
} from '../settings/reader.js';
import type { Tx } from './executor.js';
import { assertLibraryWrite } from './library-write.js';
import { whereLibrary } from './live.js';

/** Lock the parent even before an overrides row exists. Concurrent patches keep both edits. */
async function lockLink(tx: Tx, linkId: string): Promise<boolean> {
  const [link] = await tx
    .select({ id: links.id })
    .from(links)
    .where(whereLibrary(eq(links.id, linkId)))
    .for('update');
  return Boolean(link);
}

/**
 * Deep-merge legacy deltas or a timestamped full override snapshot. Older snapshots are ignored.
 * Callers with writtenAt must include all their overrides so rejection cannot lose earlier fields.
 * Future timestamps are clamped to the server clock. Omitting writtenAt keeps last-write-wins.
 * Unknown and trashed links return null; feeds refuse writes.
 */
export async function patchReaderPrefs(
  linkId: string,
  patch: unknown,
  writtenAt?: Date,
): Promise<ReaderPrefs | null> {
  const parsed = readerPatchSchema.parse(patch);
  if (writtenAt) z.date().parse(writtenAt);
  await assertLibraryWrite(linkId);
  return db.transaction(async (tx) => {
    if (!(await lockLink(tx, linkId))) return null;
    const [row] = await tx.select().from(linkReaderPrefs).where(eq(linkReaderPrefs.linkId, linkId));
    const prefs = readerPatchSchema.parse(mergeReader(parseStoredReaderPrefs(row?.prefs), parsed));
    await tx
      .insert(linkReaderPrefs)
      .values({
        linkId,
        prefs,
        updatedAt: writtenAt
          ? sql`least(${writtenAt.toISOString()}::timestamptz, now())`
          : sql`now()`,
      })
      .onConflictDoUpdate({
        target: linkReaderPrefs.linkId,
        set: { prefs, updatedAt: sql`excluded.updated_at` },
        ...(writtenAt ? { setWhere: sql`excluded.updated_at > ${linkReaderPrefs.updatedAt}` } : {}),
      });
    const [saved] = await tx
      .select()
      .from(linkReaderPrefs)
      .where(eq(linkReaderPrefs.linkId, linkId));
    return parseStoredReaderPrefs(saved?.prefs);
  });
}

/** Clearing an absent override is a successful no-op for a live library link. */
export async function clearReaderPrefs(linkId: string): Promise<boolean> {
  await assertLibraryWrite(linkId);
  return db.transaction(async (tx) => {
    if (!(await lockLink(tx, linkId))) return false;
    await tx.delete(linkReaderPrefs).where(eq(linkReaderPrefs.linkId, linkId));
    return true;
  });
}

/** Restore merge moves choices off the trashed link. Newer leaves win on conflicts. */
export async function moveReaderPrefs(tx: Tx, fromLinkId: string, toLinkId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(linkReaderPrefs)
    .where(eq(linkReaderPrefs.linkId, fromLinkId));
  const source = rows[0];
  if (!source) return;
  const [target] = await tx
    .select()
    .from(linkReaderPrefs)
    .where(eq(linkReaderPrefs.linkId, toLinkId));
  const from = parseStoredReaderPrefs(source.prefs);
  const to = parseStoredReaderPrefs(target?.prefs);
  const prefs = readerPatchSchema.parse(
    target && target.updatedAt > source.updatedAt ? mergeReader(from, to) : mergeReader(to, from),
  );
  await tx
    .insert(linkReaderPrefs)
    .values({
      linkId: toLinkId,
      prefs,
      updatedAt:
        target && target.updatedAt > source.updatedAt ? target.updatedAt : source.updatedAt,
    })
    .onConflictDoUpdate({ target: linkReaderPrefs.linkId, set: { prefs, updatedAt: new Date() } });
  await tx.delete(linkReaderPrefs).where(eq(linkReaderPrefs.linkId, fromLinkId));
}
