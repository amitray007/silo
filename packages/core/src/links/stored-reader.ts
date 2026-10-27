import { db, links } from '@silo/db';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import { READER_VERSION, type ReaderContent, readerContentSchema } from '../capture.js';
import { FIELD_MAX } from './enrichment.js';
import { whereLive } from './live.js';

export type ReaderExtraction =
  | { status: 'reader'; reader: ReaderContent; text?: string }
  | { status: 'no_reader'; text?: string }
  | { status: 'fetch_failed' };
type ReaderLink = { id: string; url: string; sourceKind: string };
export type ReaderRefresher = (link: ReaderLink, signal: AbortSignal) => Promise<ReaderExtraction>;
export type StoredReader = ReaderContent & { capturedAt: string | null };
type RefreshResult =
  | { status: 'reader'; reader: StoredReader }
  | { status: 'no_reader' | 'fetch_failed' | 'not_found' | 'refresh_unavailable' };

const readerColumns = {
  contentHtml: links.contentHtml,
  contentImages: links.contentImages,
  readerVersion: links.readerVersion,
  readerCapturedAt: links.readerCapturedAt,
};

/** The hot path reads exactly four columns by primary key, with no tag hydration. */
export async function getStoredReader(id: string): Promise<StoredReader | undefined> {
  const [row] = await db
    .select(readerColumns)
    .from(links)
    .where(whereLive(eq(links.id, id), ne(links.sourceKind, 'twitter')));
  if (row?.readerVersion !== READER_VERSION || !row.contentHtml) return undefined;
  return {
    contentHtml: row.contentHtml,
    contentImages: row.contentImages ?? [],
    capturedAt: row.readerCapturedAt?.toISOString() ?? null,
  };
}

/** Atomic predicates preserve a current Reader even if capture and refresh overlap. */
export async function recordReader(
  id: string,
  result: ReaderExtraction,
  fetchedAt: Date,
): Promise<StoredReader | null> {
  if (result.status === 'fetch_failed') return null;
  const parsed = result.status === 'reader' ? readerContentSchema.safeParse(result.reader) : null;
  if (parsed && !parsed.success) {
    console.error('[silo/core] Invalid Reader payload for link', id, parsed.error);
    return null;
  }
  const reader = parsed?.data ?? null;
  const text = result.text?.trim();
  const [row] = await db
    .update(links)
    .set({
      contentHtml: reader?.contentHtml ?? null,
      contentImages: reader?.contentImages ?? null,
      readerVersion: READER_VERSION,
      readerCapturedAt: fetchedAt,
      ...(text
        ? { extractedText: text.slice(0, FIELD_MAX.text).replace(/[\uD800-\uDBFF]$/, '') }
        : {}),
      // Reader maintenance must not change the link's metadata edit timestamp.
      updatedAt: sql`${links.updatedAt}`,
    })
    .where(
      whereLive(
        and(
          eq(links.id, id),
          ne(links.sourceKind, 'twitter'),
          sql`(${links.readerCapturedAt} is null or ${links.readerCapturedAt} <= ${fetchedAt})`,
          reader
            ? undefined
            : sql`(${links.readerVersion} is distinct from ${READER_VERSION} or ${links.contentHtml} is null)`,
        ),
      ),
    )
    .returning(readerColumns);
  if (!row?.contentHtml) return null;
  return {
    contentHtml: row.contentHtml,
    contentImages: row.contentImages ?? [],
    capturedAt: row.readerCapturedAt?.toISOString() ?? null,
  };
}

let refresher: ReaderRefresher | undefined;
export function setReaderRefresher(next: ReaderRefresher | undefined): void {
  refresher = next;
}
const pending = new Map<string, Promise<RefreshResult>>();

async function extractAndRecord(
  link: ReaderLink,
  run = refresher,
  signal?: AbortSignal,
): Promise<RefreshResult> {
  if (link.sourceKind === 'twitter') return { status: 'no_reader' };
  if (!run) return { status: 'refresh_unavailable' };
  if (signal?.aborted) return { status: 'fetch_failed' };
  const fetchedAt = new Date();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const deadline = new Promise<ReaderExtraction>((resolve) => {
    stop = () => {
      controller.abort();
      resolve({ status: 'fetch_failed' });
    };
    signal?.addEventListener('abort', stop, { once: true });
    timeout = setTimeout(() => {
      controller.abort();
      resolve({ status: 'fetch_failed' });
    }, 45_000);
  });
  let result: ReaderExtraction;
  try {
    result = await Promise.race([run(link, controller.signal), deadline]);
  } catch {
    result = { status: 'fetch_failed' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
  }
  if (controller.signal.aborted || signal?.aborted) return { status: 'fetch_failed' };
  if (result.status === 'fetch_failed') return result;
  if (result.status === 'reader' && !readerContentSchema.safeParse(result.reader).success) {
    return { status: 'fetch_failed' };
  }
  return recordRefresh(link.id, result, fetchedAt);
}

async function recordRefresh(
  id: string,
  result: Exclude<ReaderExtraction, { status: 'fetch_failed' }>,
  fetchedAt: Date,
): Promise<RefreshResult> {
  const written = await recordReader(id, result, fetchedAt);
  const reader = written ?? (await getStoredReader(id));
  if (
    reader &&
    (result.status === 'reader' ||
      (reader.capturedAt !== null && new Date(reader.capturedAt) > fetchedAt))
  ) {
    return { status: 'reader', reader };
  }
  const [existing] = await db
    .select({ id: links.id })
    .from(links)
    .where(whereLive(eq(links.id, id)));
  return { status: existing ? 'no_reader' : 'not_found' };
}

function coalesce(
  id: string,
  load: () => Promise<ReaderLink | undefined>,
  run = refresher,
  signal?: AbortSignal,
): Promise<RefreshResult> {
  const running = pending.get(id);
  if (running) return running;
  const work = load()
    .then((link) =>
      link ? extractAndRecord(link, run, signal) : ({ status: 'not_found' } as const),
    )
    .finally(() => pending.delete(id));
  pending.set(id, work);
  return work;
}

export function refreshReader(id: string): Promise<RefreshResult> {
  return coalesce(id, async () => {
    const [link] = await db
      .select({ id: links.id, url: links.url, sourceKind: links.sourceKind })
      .from(links)
      .where(whereLive(eq(links.id, id)));
    return link;
  });
}

/** One candidate query; no per-link lookup or tag queries in the serial loop. */
export async function runReaderBackfill(
  run = refresher,
  signal?: AbortSignal,
): Promise<{ found: number; refreshed: number }> {
  if (signal?.aborted) return { found: 0, refreshed: 0 };
  const batch = await db
    .select({ id: links.id, url: links.url, sourceKind: links.sourceKind })
    .from(links)
    .where(
      whereLive(
        and(
          or(sql`${links.readerVersion} is null`, ne(links.readerVersion, READER_VERSION)),
          sql`(${links.readerCapturedAt} is null or ${links.readerCapturedAt} < now() - interval '6 hours')`,
          ne(links.captureStatus, 'enriching'),
          ne(links.sourceKind, 'twitter'),
        ),
      ),
    )
    .orderBy(sql`${links.readerCapturedAt} asc nulls first`, links.id)
    .limit(20);
  let refreshed = 0;
  for (const link of batch) {
    if (signal?.aborted) break;
    const fetchedAt = new Date();
    try {
      const result = await coalesce(link.id, async () => link, run, signal);
      if (signal?.aborted) break;
      if (result.status === 'fetch_failed') {
        await db
          .update(links)
          .set({ readerCapturedAt: fetchedAt, updatedAt: sql`${links.updatedAt}` })
          .where(
            whereLive(
              and(
                eq(links.id, link.id),
                sql`${links.readerVersion} is distinct from ${READER_VERSION}`,
                sql`(${links.readerCapturedAt} is null or ${links.readerCapturedAt} <= ${fetchedAt})`,
              ),
            ),
          );
      } else if (result.status === 'reader' || result.status === 'no_reader') refreshed++;
    } catch (error) {
      console.error('[silo/core] Reader backfill failed for link', link.id, error);
    }
  }
  return { found: batch.length, refreshed };
}
