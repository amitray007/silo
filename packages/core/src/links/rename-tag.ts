import { db, linkTags, tags } from '@silo/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeTagKey } from './links.js';

export const tagTitleSchema = z.string().trim().min(1).max(200);
type RenameTagResult =
  | { name: string; merged: boolean }
  | { error: 'not_found' | 'tag_exists'; name: string };

/** Lock both identities in a stable order and move associations before removing the source. */
export async function renameTag(
  name: string,
  nextName: string,
  merge = false,
): Promise<RenameTagResult> {
  const next = tagTitleSchema.parse(nextName);
  const sourceKey = normalizeTagKey(name);
  const targetKey = normalizeTagKey(next);
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(tags)
        .where(inArray(tags.normalizedKey, [sourceKey, targetKey]))
        .orderBy(asc(tags.id))
        .for('update');
      const source = rows.find((row) => row.normalizedKey === sourceKey);
      if (!source) return { error: 'not_found', name };
      const target = rows.find((row) => row.normalizedKey === targetKey && row.id !== source.id);
      if (target && !merge) return { error: 'tag_exists', name: target.name };
      if (!target) {
        await tx
          .update(tags)
          .set({ name: next, normalizedKey: targetKey })
          .where(eq(tags.id, source.id));
        return { name: next, merged: false };
      }
      await tx.execute(
        sql`insert into ${linkTags} (link_id, tag_id) select link_id, ${target.id}::uuid from ${linkTags} where tag_id = ${source.id}::uuid on conflict do nothing`,
      );
      await tx.delete(tags).where(eq(tags.id, source.id));
      return { name: target.name, merged: true };
    });
  } catch (error) {
    // A concurrent create can claim a previously absent target after our read.
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      !(
        cause &&
        typeof cause === 'object' &&
        'constraint' in cause &&
        cause.constraint === 'tags_normalized_key_unique'
      )
    )
      throw error;
    return { error: 'tag_exists', name: next };
  }
}
