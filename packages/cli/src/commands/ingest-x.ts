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
};

const CONCURRENCY = 8;
const PLUGIN = 'x';

type RunSummary = {
  total: number;
  sent: number;
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
 */
async function scanBookmarks(
  filePath: string,
  seen: Set<string>,
  limit: number | undefined,
): Promise<ScanResult> {
  const toSend: PendingBookmark[] = [];
  let scanned = 0;
  let skippedAlreadySeen = 0;
  let skippedUnmappable = 0;

  for await (const bookmark of readFieldTheoryBookmarks(filePath)) {
    scanned += 1;
    if (seen.has(bookmark.id)) {
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
        summary.sent += 1;
        newlySeen.add(result.item.id);
        if (!json)
          process.stdout.write(`\r${green('ingesting')} ${summary.sent}/${summary.total}…`);
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
 * `silo ingest x [--limit] [--dry-run]` — reads Field Theory's
 * `bookmarks.jsonl`, maps each NEW bookmark (not already in the local
 * seen-set) to the `/api/ingest` payload, and sends it with bounded
 * concurrency. Requires a token (checked by the caller — `main.ts` — before
 * this runs, per the plan's "fail gracefully, don't dump a 401"); this
 * function assumes `options.hasToken` is already `true` unless `--dry-run`
 * (a dry run never calls the API, so it needs no token at all).
 */
export async function runIngestX(client: Client, options: IngestXOptions): Promise<void> {
  const filePath = bookmarksFilePath();
  const statePath = seenSetPath(PLUGIN);
  const seen = await readSeenSet(statePath);

  let scan: ScanResult;
  try {
    scan = await scanBookmarks(filePath, seen, options.limit);
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
    sent: 0,
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
  const parts = [`${green(`${summary.sent} sent`)}`];
  if (summary.failed > 0) parts.push(red(`${summary.failed} failed`));
  if (summary.skippedAlreadySeen > 0) parts.push(dim(`${summary.skippedAlreadySeen} already sent`));
  if (summary.skippedUnmappable > 0) parts.push(yellow(`${summary.skippedUnmappable} unmappable`));
  console.log(parts.join('  ·  '));
}
