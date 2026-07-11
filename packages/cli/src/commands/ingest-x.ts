import { type Client, ClientError } from '../client.js';
import { dim, green, red, yellow } from '../format.js';
import { runWithConcurrency } from '../ingest/concurrency.js';
import {
  BookmarksFileNotFoundError,
  bookmarksFilePath,
  readFieldTheoryBookmarks,
} from '../ingest/fieldtheory.js';
import { readSeenSet, seenSetPath, writeSeenSet } from '../ingest/state.js';
import { mapBookmarkToIngest } from '../ingest/x.js';

export type IngestXOptions = {
  limit?: number;
  dryRun: boolean;
  json: boolean;
  hasToken: boolean;
  /**
   * Bypass the seen-set skip for this run: every mappable bookmark is
   * (re-)queued regardless of prior "already sent" state. The escape hatch
   * for server-side drift (e.g. a soft-deleted row whose id is still in the
   * local seen-set) — see the "heal the seen-set" method doc. Canonical-url
   * dedup on the server makes already-present rows harmless no-ops
   * (`deduped: true`), so `--resend` never duplicates anything.
   */
  resend: boolean;
};

const CONCURRENCY = 8;
const PLUGIN = 'x';

type RunSummary = {
  total: number;
  /** Count of `deduped: false` responses — rows the server actually created. */
  created: number;
  /** Count of `deduped: true` responses — the server merged into an existing
   * row by canonical-url; nothing new was created. Distinguishing this from
   * `created` is the whole point of Fix A: a 2xx is not the same fact as
   * "a new row now exists". */
  deduped: number;
  skippedAlreadySeen: number;
  skippedUnmappable: number;
  failed: number;
};

type PendingBookmark = { id: string; payload: NonNullable<ReturnType<typeof mapBookmarkToIngest>> };

type ScanResult = {
  toSend: PendingBookmark[];
  scanned: number;
  skippedAlreadySeen: number;
  skippedUnmappable: number;
};

/**
 * Streams `bookmarks.jsonl`, splitting each bookmark into one of: already
 * sent (in `seen`), unmappable (`mapBookmarkToIngest` returned `null`), or
 * pending-send — stopping early once `limit` pending bookmarks are queued.
 * Factored out of `runIngestX` to keep that function's cognitive complexity
 * under the lint's ceiling; this is purely the SCAN phase, no network calls.
 *
 * `resend`, when `true`, skips the seen-set check entirely — every mappable
 * bookmark is queued regardless of prior "already sent" state, and nothing
 * is counted as `skippedAlreadySeen`. This is the escape hatch for
 * server-side drift (e.g. `bookmarks.jsonl` still lists a bookmark whose
 * silo row was soft-deleted server-side): the seen-set has no way to know
 * the row is gone, so the user tells the CLI to ignore it for one run.
 * Canonical-url dedup on the server (`deduped: true`) makes re-sending
 * still-live rows a harmless no-op — see `IngestXOptions.resend`.
 */
async function scanBookmarks(
  filePath: string,
  seen: Set<string>,
  limit: number | undefined,
  resend: boolean,
): Promise<ScanResult> {
  const toSend: PendingBookmark[] = [];
  let scanned = 0;
  let skippedAlreadySeen = 0;
  let skippedUnmappable = 0;

  for await (const bookmark of readFieldTheoryBookmarks(filePath)) {
    scanned += 1;
    if (!resend && seen.has(bookmark.id)) {
      skippedAlreadySeen += 1;
      continue;
    }
    const payload = mapBookmarkToIngest(bookmark);
    if (!payload) {
      skippedUnmappable += 1;
      continue;
    }
    toSend.push({ id: bookmark.id, payload });
    if (limit !== undefined && toSend.length >= limit) break;
  }

  return { toSend, scanned, skippedAlreadySeen, skippedUnmappable };
}

/**
 * Sends every `toSend` bookmark with bounded concurrency, printing live
 * progress (unless `json`), and returns the run summary plus the ids that
 * actually succeeded (for the caller to persist to the seen-set) and the
 * first 401 encountered (if any). Factored out of `runIngestX` to keep that
 * function's cognitive complexity under the lint's ceiling; this is purely
 * the SEND phase, after the scan has already decided what's pending.
 */
async function sendBookmarks(
  client: Client,
  toSend: PendingBookmark[],
  summary: RunSummary,
  json: boolean,
): Promise<{ newlySeen: Set<string>; firstAuthError: ClientError | undefined }> {
  const newlySeen = new Set<string>();
  let firstAuthError: ClientError | undefined;

  await runWithConcurrency(
    toSend,
    CONCURRENCY,
    async ({ payload }) => client.ingest(payload),
    (result) => {
      if (result.ok) {
        // A merge is still a successful, resolved send — the bookmark's
        // content is confirmed present in silo either way — so both
        // outcomes add to `newlySeen` (see `IngestXOptions.resend` for the
        // escape hatch when a previously-seen id needs re-sending). Only
        // `result.value.deduped === true` counts as a merge; anything else
        // (a fresh row, or — defensively — a server that omitted the flag)
        // counts as newly created, so a contract drift over-reports "new"
        // loudly rather than silently swallowing real creations.
        if (result.value.deduped === true) summary.deduped += 1;
        else summary.created += 1;
        newlySeen.add(result.item.id);
        if (!json) {
          const sent = summary.created + summary.deduped;
          process.stdout.write(`\r${green('ingesting')} ${sent}/${summary.total}…`);
        }
        return;
      }
      summary.failed += 1;
      if (result.error instanceof ClientError && result.error.status === 401 && !firstAuthError) {
        firstAuthError = result.error;
      }
    },
  );

  if (!json) process.stdout.write('\n');
  return { newlySeen, firstAuthError };
}

/**
 * `silo ingest x [--limit] [--dry-run] [--resend]` — reads Field Theory's
 * `bookmarks.jsonl`, maps each NEW bookmark (not already in the local
 * seen-set, unless `--resend`) to the `/api/ingest` payload, and sends it
 * with bounded concurrency. Requires a token (checked by the caller —
 * `main.ts` — before this runs, per the plan's "fail gracefully, don't dump
 * a 401"); this function assumes `options.hasToken` is already `true`
 * unless `--dry-run` (a dry run never calls the API, so it needs no token
 * at all).
 */
export async function runIngestX(client: Client, options: IngestXOptions): Promise<void> {
  const filePath = bookmarksFilePath();
  const statePath = seenSetPath(PLUGIN);
  const seen = await readSeenSet(statePath);

  let scan: ScanResult;
  try {
    scan = await scanBookmarks(filePath, seen, options.limit, options.resend);
  } catch (error) {
    if (error instanceof BookmarksFileNotFoundError) {
      console.error(error.message);
      return;
    }
    throw error;
  }
  const { toSend, scanned, skippedAlreadySeen, skippedUnmappable } = scan;

  if (options.dryRun) {
    printDryRun(toSend, scanned, skippedAlreadySeen, skippedUnmappable, options.json);
    return;
  }

  if (toSend.length === 0) {
    console.log(
      dim(`Nothing new to ingest (${scanned} scanned, ${skippedAlreadySeen} already sent).`),
    );
    return;
  }

  const summary: RunSummary = {
    total: toSend.length,
    created: 0,
    deduped: 0,
    skippedAlreadySeen,
    skippedUnmappable,
    failed: 0,
  };
  const { newlySeen, firstAuthError } = await sendBookmarks(client, toSend, summary, options.json);

  // Persist the seen-set incrementally-but-atomically: every bookmark that
  // actually got a successful response is marked seen, EVEN IF the run was
  // interrupted or some bookmarks failed — this is what makes a killed run
  // resumable (per the plan): a re-run only re-attempts what didn't succeed
  // last time, whether that's "never reached" (`toSend` beyond a crash
  // point) or "reached and failed" (never added to `newlySeen`).
  if (newlySeen.size > 0) {
    for (const id of newlySeen) seen.add(id);
    await writeSeenSet(statePath, seen);
  }

  if (firstAuthError) {
    console.error(`\n${red('Ingest stopped')}: ${firstAuthError.hint ?? firstAuthError.message}`);
  }

  printSummary(summary, options.json);
}

function printDryRun(
  toSend: { id: string; payload: NonNullable<ReturnType<typeof mapBookmarkToIngest>> }[],
  scanned: number,
  skippedAlreadySeen: number,
  skippedUnmappable: number,
  json: boolean,
): void {
  if (json) {
    console.log(
      JSON.stringify({
        dryRun: true,
        scanned,
        wouldSend: toSend.length,
        skippedAlreadySeen,
        skippedUnmappable,
        sample: toSend.slice(0, 5).map((s) => s.payload),
      }),
    );
    return;
  }

  console.log(`${yellow('dry run')} — would send ${toSend.length} of ${scanned} scanned bookmarks`);
  console.log(dim(`(${skippedAlreadySeen} already sent, ${skippedUnmappable} unmappable)`));
  for (const { payload } of toSend.slice(0, 5)) {
    const sourceData = payload.sourceData;
    const author = sourceData?.kind === 'twitter' ? sourceData.authorHandle : 'unknown';
    console.log(`  @${author}  ${payload.url}`);
  }
  if (toSend.length > 5) console.log(dim(`  …and ${toSend.length - 5} more`));
}

function printSummary(summary: RunSummary, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(summary));
    return;
  }
  const parts = [green(`${summary.created} new`)];
  // Only mention dedups when there were any — a merge means the URL was
  // already captured, which is worth surfacing but shouldn't clutter the
  // common case (zero dedups) with a "0 already in silo" segment.
  //
  // NOTE: a `deduped` under `--resend` can be either a true no-op (the row was
  // already live) OR a REVIVE (the server's `mergeIntoExisting` cleared a
  // `deleted_at`, resurrecting a soft-deleted row — see core `links.ts`). The
  // ingest response carries the same `deduped: true` for both, so the CLI
  // cannot tell them apart and honestly reports both as "already in silo".
  // Distinguishing a revive would need the API to return a separate flag; that
  // is deliberately out of scope here (a CLI-only fix can't invent the signal).
  if (summary.deduped > 0) parts.push(dim(`${summary.deduped} already in silo`));
  if (summary.failed > 0) parts.push(red(`${summary.failed} failed`));
  if (summary.skippedAlreadySeen > 0) parts.push(dim(`${summary.skippedAlreadySeen} already sent`));
  if (summary.skippedUnmappable > 0) parts.push(yellow(`${summary.skippedUnmappable} unmappable`));
  console.log(parts.join('  ·  '));
}
