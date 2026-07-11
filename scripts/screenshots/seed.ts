/**
 * Seeds a throwaway silo DB with the curated `SEED_LINKS` dataset
 * (`seed-data.ts`) via the REAL `POST /api/ingest` endpoint, so silo's own
 * enrichment worker fetches live metadata + cover images exactly as
 * production does. After ingest + enrichment settle, backfills the fields
 * ingest cannot set (created_at date buckets, added_by='agent', a couple of
 * deliberately-incomplete rows) directly via SQL, keyed by link id.
 *
 * Run: `npx tsx scripts/screenshots/seed.ts` (from the repo root, with a
 * throwaway Postgres + silo API server already running).
 *
 * Env:
 *   DATABASE_URL   — required. Points at the throwaway Postgres.
 *   INGEST_URL     — optional, default `http://127.0.0.1:8788`.
 *   SILO_API_TOKEN — required. Must match the running API's SILO_API_TOKEN.
 *
 * Idempotent: `POST /api/ingest` dedups by canonical URL (re-ingesting
 * merges, never duplicates), and the SQL backfill is an UPDATE keyed by
 * `id` — safe to re-run.
 *
 * NOTE on the ingest response shape: `{ link, deduped }`, where `link` is
 * the API's whitelisted `LinkJson` (`packages/api/src/link-json.ts`). That
 * whitelist deliberately OMITS `canonicalUrl` (it can carry an internal
 * `#unsafe-<uuid>` dedup suffix — see that file's doc comment), so this
 * script keys the backfill on `link.id`, not on a canonical URL match.
 */

import { Pool } from 'pg';
import type { SeedLink } from './seed-data.js';
import { SEED_LINKS } from './seed-data.js';

const DATABASE_URL = requireEnv('DATABASE_URL');
const SILO_API_TOKEN = requireEnv('SILO_API_TOKEN');
const INGEST_URL = process.env.INGEST_URL ?? 'http://127.0.0.1:8788';

const ENRICH_POLL_INTERVAL_MS = 2_000;
const ENRICH_POLL_TIMEOUT_MS = 90_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[seed] missing required env var ${name} — aborting.`);
    process.exit(1);
  }
  return value;
}

/** The subset of the ingest response's `link` shape this script reads. */
interface IngestedLink {
  id: string;
}

interface IngestResponse {
  link: IngestedLink;
  deduped: boolean;
}

interface IngestSuccess {
  ok: true;
  seed: SeedLink;
  id: string;
}

interface IngestFailure {
  ok: false;
  seed: SeedLink;
  status: number;
  body: string;
}

type IngestResult = IngestSuccess | IngestFailure;

/** Builds the `POST /api/ingest` JSON body for one seed entry. */
function toIngestBody(seed: SeedLink): Record<string, unknown> {
  const body: Record<string, unknown> = {
    url: seed.url,
    tags: seed.tags,
  };
  if (seed.note !== undefined) body.note = seed.note;
  if (seed.twitter !== undefined) {
    body.sourceKind = 'twitter';
    // twitterSourceData (packages/core/src/links/source-data.ts) requires
    // reposts/quotes/bookmarks alongside likes/replies — seed-data.ts's
    // TwitterSourceData only curates likes/replies, so default the rest to
    // zero rather than widening the seed dataset's type for values the
    // screenshots don't need to vary.
    body.sourceData = {
      ...seed.twitter,
      reposts: 0,
      quotes: 0,
      bookmarks: 0,
    };
  }
  return body;
}

async function ingestOne(seed: SeedLink): Promise<IngestResult> {
  const response = await fetch(`${INGEST_URL}/api/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SILO_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(toIngestBody(seed)),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return { ok: false, seed, status: response.status, body: bodyText };
  }

  const parsed = (await response.json()) as IngestResponse;
  return { ok: true, seed, id: parsed.link.id };
}

async function ingestAll(): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const seed of SEED_LINKS) {
    const result = await ingestOne(seed);
    if (result.ok) {
      console.log(`[seed] ingested ${seed.url} -> ${result.id}`);
    } else {
      console.error(`[seed] FAILED ${seed.url} -> ${result.status} ${result.body}`);
    }
    results.push(result);
  }
  return results;
}

/** Row shape of the enrichment-status poll query. */
interface CaptureStatusCount {
  capture_status: string;
  count: string;
}

/**
 * Polls `links.capture_status` until no live row is still `'enriching'`, or
 * `ENRICH_POLL_TIMEOUT_MS` elapses. Prints a progress line each poll.
 */
async function waitForEnrichment(pool: Pool): Promise<void> {
  const deadline = Date.now() + ENRICH_POLL_TIMEOUT_MS;
  for (;;) {
    const { rows } = await pool.query<CaptureStatusCount>(
      `select capture_status, count(*) from links where deleted_at is null group by 1`,
    );
    const summary = rows.map((row) => `${row.capture_status}: ${row.count}`).join(', ');
    console.log(`[seed] enrichment poll — ${summary || '(no live rows)'}`);

    const stillEnriching = rows.some((row) => row.capture_status === 'enriching');
    if (!stillEnriching) return;

    if (Date.now() >= deadline) {
      console.warn(
        `[seed] enrichment poll timed out after ${ENRICH_POLL_TIMEOUT_MS}ms — proceeding anyway.`,
      );
      return;
    }
    await sleep(ENRICH_POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The `created_at` SQL interval expression for one seed entry's bucket. */
function createdAtExpr(seed: SeedLink, indexInBucket: number): string {
  switch (seed.bucket) {
    case 'today':
      return `now() - interval '5 hours'`;
    case 'yesterday':
      return `now() - interval '1 day 3 hours'`;
    case 'this_week': {
      // Stagger 2..4 days by index within the bucket so rows don't collapse
      // onto one instant.
      const days = 2 + (indexInBucket % 3);
      return `now() - interval '${days} days'`;
    }
    case 'earlier': {
      // Stagger 8..40 days by index within the bucket.
      const days = 8 + ((indexInBucket * 5) % 33);
      return `now() - interval '${days} days'`;
    }
  }
}

/**
 * Backfills the fields ingest cannot set: created_at date buckets,
 * added_by='agent' for the addedByClaude rows, and capture_status='partial'
 * for the incomplete rows. Runs AFTER enrichment settles, since enrichment
 * would otherwise flip a freshly-set 'partial' back to 'full'. Keyed by
 * `id` (parameterized UPDATEs) — safe to re-run.
 */
async function backfill(pool: Pool, results: IngestResult[]): Promise<void> {
  const bucketCounts = new Map<SeedLink['bucket'], number>();

  for (const result of results) {
    if (!result.ok) continue;
    const { seed, id } = result;

    const indexInBucket = bucketCounts.get(seed.bucket) ?? 0;
    bucketCounts.set(seed.bucket, indexInBucket + 1);

    const createdAt = createdAtExpr(seed, indexInBucket);
    await pool.query(
      `update links set created_at = ${createdAt}, updated_at = ${createdAt} where id = $1`,
      [id],
    );

    if (seed.addedByClaude) {
      await pool.query(`update links set added_by = 'agent' where id = $1`, [id]);
    }

    if (seed.incomplete) {
      await pool.query(`update links set capture_status = 'partial' where id = $1`, [id]);
    }
  }
}

/** One row of the final summary table, queried back from the DB. */
interface SummaryRow {
  title: string | null;
  site_name: string | null;
  url: string;
  capture_status: string;
  has_image: boolean;
  added_by: string;
  created_at: Date;
  notes: string | null;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function bucketLabel(createdAt: Date): string {
  const ageMs = Date.now() - createdAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays < 1) return 'today';
  if (ageDays < 2) return 'yesterday';
  if (ageDays < 7) return 'this_week';
  return 'earlier';
}

async function printSummary(pool: Pool): Promise<void> {
  const { rows } = await pool.query<SummaryRow>(
    `select title, site_name, url, capture_status, (image_url is not null) as has_image,
            added_by, created_at, notes
     from links
     where deleted_at is null
     order by created_at desc`,
  );

  console.log('\n[seed] final summary');
  console.log('title | site/domain | status | image? | added_by | bucket');
  console.log('-'.repeat(100));
  for (const row of rows) {
    const title = row.title ?? '(untitled)';
    const site = row.site_name ?? domainOf(row.url);
    const image = row.has_image ? 'yes' : 'no';
    console.log(
      `${title} | ${site} | ${row.capture_status} | ${image} | ${row.added_by} | ${bucketLabel(row.created_at)}`,
    );
  }

  const total = rows.length;
  const withImage = rows.filter((row) => row.has_image).length;
  const withNotes = rows.filter((row) => row.notes !== null).length;
  const agentOrigin = rows.filter((row) => row.added_by === 'agent').length;
  const incomplete = rows.filter((row) => row.capture_status !== 'full').length;

  console.log('-'.repeat(100));
  console.log(
    `total: ${total} | with-image: ${withImage} | notes: ${withNotes} | agent-origin: ${agentOrigin} | incomplete: ${incomplete}`,
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    console.log(`[seed] ingesting ${SEED_LINKS.length} links via ${INGEST_URL}/api/ingest ...`);
    const results = await ingestAll();

    const failures = results.filter((result): result is IngestFailure => !result.ok);
    if (failures.length > 0) {
      console.warn(`[seed] ${failures.length} link(s) failed to ingest:`);
      for (const failure of failures) {
        console.warn(`  - ${failure.seed.url}: ${failure.status} ${failure.body}`);
      }
    }

    console.log('[seed] waiting for enrichment to settle...');
    await waitForEnrichment(pool);

    console.log('[seed] backfilling date buckets + marks...');
    await backfill(pool, results);

    await printSummary(pool);

    if (failures.length > 0) {
      console.warn(`[seed] done, with ${failures.length} ingest failure(s) — see above.`);
    } else {
      console.log('[seed] done.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] fatal error:', error);
  process.exit(1);
});
