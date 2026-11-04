import { db, links } from '@silo/db';
import { type SQL, sql } from 'drizzle-orm';

const CANDIDATE_PROBE_FLOOR = 512;
// Share of the planner's `links` row estimate at which candidate membership stops beating a scan.
const CANDIDATE_SCAN_FRACTION = 0.5;

/** Candidate membership is a superset; callers retain their exact match and rank expressions. */
export async function librarySearchSource(
  query: string,
  tsQuery: SQL,
  substring?: SQL,
  options: { broadProbe?: boolean } = {},
) {
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
  // First: when true it reaches the probe limit through a cheap index scan; when false it is a
  // one-time filter. A negated query cannot use the GIN branch, which would walk the table.
  const branches = [
    sql`select id as candidate_id from links
      where deleted_at is null and feed_id is null and ${matchesEmpty}`,
    sql`select id from links
      where deleted_at is null and feed_id is null and search_vector @@ ${tsQuery}`,
    sql`select lt.link_id from link_tags lt
      join matching_tags mt on mt.id = lt.tag_id`,
  ];
  if (substring)
    branches.push(sql`select id from links
    where deleted_at is null and feed_id is null and ${substring}`);

  // Stop probing once candidates are broad enough that a scan is cheaper. The count is not
  // distinct (union all), which only biases toward scanning.
  const candidates = sql`
    with matching_tags as (
      select id from tags where to_tsvector('english', name) @@ ${tagQuery}
    )
    ${sql.join(branches, sql` union all `)}
  `;
  const candidateLink = () =>
    db.select().from(links).where(sql`${links.id} in (${candidates})`).as('links');
  // Stage 1: one cheap round trip. Most terms are rare and stop here.
  const cheap = await db.execute<{ n: string }>(
    sql`select count(*) as n from (${candidates} limit ${CANDIDATE_PROBE_FLOOR}) as probe`,
  );
  if (Number(cheap.rows[0]?.n) < CANDIDATE_PROBE_FLOOR) return candidateLink();
  // A selective tag scope makes the scan start from the tag, which beats any candidate list.
  if (options.broadProbe === false) return links;
  // Stage 2: broad terms are scanned only past half the library. reltuples is -1 on a
  // never-analyzed table, which leaves the floor.
  const probeSql = sql`
    with probe_limit as (
      select greatest(${CANDIDATE_PROBE_FLOOR}, (reltuples * ${CANDIDATE_SCAN_FRACTION})::bigint) as n
      from pg_class where oid = 'links'::regclass
    )
    select count(*) >= (select n from probe_limit) as broad
    from (${candidates} limit (select n from probe_limit)) as probe
  `;
  // The planner prices `@@` as cheap and seq-scans (detoasting every search_vector) for a broad
  // term under a large LIMIT; the GIN bitmap answers membership without touching TOAST.
  const probe = await db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    return tx.execute<{ broad: boolean }>(probeSql);
  });
  if (probe.rows[0]?.broad) return links;
  return candidateLink();
}
