import { db, links } from '@silo/db';
import { type SQL, sql } from 'drizzle-orm';

const CANDIDATE_PROBE_LIMIT = 512;

/** Candidate membership is a superset; callers retain their exact match and rank expressions. */
export async function librarySearchSource(query: string, tsQuery: SQL, substring?: SQL) {
  // Short substrings cannot narrow a trigram scan.
  if (substring && query.trim().length < 3) return links;
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

  // Stop probing once candidates are broad enough that a scan is cheaper.
  const candidates = sql`
    with matching_tags as (
      select id from tags where to_tsvector('english', name) @@ ${tagQuery}
    )
    ${sql.join(branches, sql` union all `)}
  `;
  const probe = await db.execute(sql`${candidates} limit ${CANDIDATE_PROBE_LIMIT}`);
  if (probe.rows.length === CANDIDATE_PROBE_LIMIT) return links;
  return db.select().from(links).where(sql`${links.id} in (${candidates})`).as('links');
}
