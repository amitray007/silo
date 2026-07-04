import { db, links, linkTags, tags } from '@silo/db';
import { asc, desc, eq, sql } from 'drizzle-orm';

/**
 * A tag's display name plus how many LIVE links carry it (plan 007, C3) —
 * the sidebar's "ai 23" list.
 */
export type TagCount = {
  name: string;
  count: number;
};

/**
 * Every tag with its count of LIVE links (`links.deleted_at IS NULL`),
 * ordered by count descending then name ascending (most-used first, matching
 * the mockup sidebar's "ai 23, design 17" ordering; alphabetical as the
 * tiebreak for equal counts).
 *
 * Zero-count decision (plan 007, C3): a tag whose only link(s) are ALL
 * trashed is DELIBERATELY OMITTED, not returned with `count: 0`. The inner
 * joins below (`tags -> link_tags -> links`, the last filtered to live rows)
 * naturally produce this — a tag with no live link has no row surviving the
 * join, so it's absent from the result rather than present at zero. This
 * matches the sidebar's purpose (a navigable list of tags you can currently
 * filter live links by); a tag every one of whose links is in trash would
 * otherwise clutter the list with a dead "tagname 0" entry that filters to
 * nothing.
 *
 * `count(distinct link_tags.link_id)` (not a bare `count(*)`) is the correct
 * aggregate even though `link_tags` has a `(link_id, tag_id)` composite
 * primary key that already forbids duplicate rows per pair — `distinct`
 * documents that the count is "distinct live links carrying this tag" and is
 * immune if the join ever fans out for an unrelated reason.
 *
 * W1 (case-insensitive tags): two links tagged `'AI'`/`'ai'` share ONE `tags`
 * row (`normalized_key` is the unique constraint — see `tags.ts` schema doc
 * comment and `links.ts`'s `normalizeTagKey`), so grouping by `tags.id` here
 * naturally counts them as a single tag's live-link count, not two.
 */
export async function listTagsWithCounts(): Promise<TagCount[]> {
  const rows = await db
    .select({
      name: tags.name,
      count: sql<string>`count(distinct ${linkTags.linkId})`,
    })
    .from(tags)
    .innerJoin(linkTags, eq(linkTags.tagId, tags.id))
    .innerJoin(links, eq(links.id, linkTags.linkId))
    .where(sql`${links.deletedAt} is null`)
    .groupBy(tags.id, tags.name)
    .orderBy(desc(sql`count(distinct ${linkTags.linkId})`), asc(tags.name));

  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}
