import { db, links } from '@silo/db';
import { getTableColumns, type SQL, sql } from 'drizzle-orm';

/** Candidate membership is a superset; callers retain their exact match and rank expressions. */
export function librarySearchSource(query: string, tsQuery: SQL, substring?: SQL) {
  // Parsed lexemes are already stemmed; cast directly to avoid stemming them a second time.
  // OR their prefixes because AND terms may live on different tags.
  const tagQuery = sql`coalesce((
    select string_agg(quote_literal(term) || ':*', ' | ')
    from unnest(tsvector_to_array(to_tsvector('english', ${query}))) as term
  ), '')::tsquery`;
  // A negative websearch query can match an empty vector, including links without any tags.
  const matchesEmpty = sql`''::tsvector @@ ${tsQuery}`;
  const branches = [
    sql`select id as candidate_id from links
      where deleted_at is null and feed_id is null and search_vector @@ ${tsQuery}`,
    sql`select lt.link_id from link_tags lt
      join matching_tags mt on mt.id = lt.tag_id`,
    sql`select id from links where deleted_at is null and feed_id is null and ${matchesEmpty}`,
  ];
  if (substring)
    branches.push(sql`select id from links
    where deleted_at is null and feed_id is null and ${substring}`);

  // Materialization plus the lateral OFFSET barrier keeps heap/ranking work on candidates only.
  const candidates = sql`(
    with matching_tags as materialized (
      select id from tags where to_tsvector('english', name) @@ ${tagQuery}
    ), candidate_ids as materialized (${sql.join(branches, sql` union `)})
    select candidate_id from candidate_ids
  ) as candidates`;
  const row = db
    .select()
    .from(links)
    .where(sql`${links.id} = candidates.candidate_id`)
    .offset(0)
    .as('links');
  return db
    .select(getTableColumns(links))
    .from(candidates)
    .innerJoinLateral(row, sql`true`)
    .as('links');
}
