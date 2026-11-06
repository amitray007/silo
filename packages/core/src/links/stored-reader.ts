import { db, links } from '@silo/db';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import { READER_VERSION, type ReaderContent, readerContentSchema } from '../capture.js';
import { FIELD_MAX } from './enrichment.js';

export type ReaderExtraction =
  | {
      status: 'reader';
      reader: ReaderContent;
      readerSource?: 'page' | 'feed' | 'archive' | 'extension';
      readerSourceAt?: Date | null;
      text?: string;
      renderPending?: boolean;
    }
  | { status: 'no_reader'; text?: string; renderPending?: boolean }
  | { status: 'fetch_failed' };
export type ReaderAccess = 'paywalled' | 'blocked';
/** `observation` is set only when the read saw the page or a block; `undefined` leaves access as it is. */
export type ObservedReader = ReaderExtraction & { observation?: ReaderAccess | null | undefined };
type ReaderLink = { id: string; url: string; sourceKind: string };
export type ReaderRefresher = (link: ReaderLink, signal: AbortSignal) => Promise<ObservedReader>;
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
    .where(and(sql`${links.deletedAt} is null`, eq(links.id, id), ne(links.sourceKind, 'twitter')));
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
  explicitRefresh = false,
): Promise<StoredReader | null> {
  if (result.status === 'fetch_failed') return null;
  const parsed = result.status === 'reader' ? readerContentSchema.safeParse(result.reader) : null;
  if (parsed && !parsed.success) {
    console.error('[silo/core] Invalid Reader payload for link', id, parsed.error);
    return null;
  }
  const reader = parsed?.data ?? null;
  const fromBrowser = result.status === 'reader' && result.readerSource === 'extension';
  // A non-subscriber's browser sees only the teaser: it must not replace a longer feed,
  // archive or earlier browser copy. Silo's own page read is always replaceable.
  const uploadLength = fromBrowser ? (result.text?.trim().length ?? 0) : 0;
  const browserMayReplace = sql`(not ${fromBrowser} or ${links.readerSource} is null or ${links.readerSource} = 'page' or length(coalesce(${links.extractedText}, '')) <= ${uploadLength})`;
  const [row] = await db
    .update(links)
    .set(readerUpdate(result, reader, fetchedAt))
    .where(
      and(
        sql`${links.deletedAt} is null`,
        sql`(${links.readerSource} is distinct from 'extension' or ${explicitRefresh} or ${fromBrowser})`,
        browserMayReplace,
        and(
          eq(links.id, id),
          ne(links.sourceKind, 'twitter'),
          sql`((${fromBrowser} and ${links.readerSource} is distinct from 'extension') or ${links.readerCapturedAt} is null or ${links.readerCapturedAt} <= ${fetchedAt})`,
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

function readerUpdate(
  result: Exclude<ReaderExtraction, { status: 'fetch_failed' }>,
  reader: ReaderContent | null,
  fetchedAt: Date,
) {
  const text = result.text?.trim();
  const keepCurrent = sql`${links.readerVersion} = ${READER_VERSION} and ${links.contentHtml} is not null`;
  return {
    ...(reader && result.status === 'reader'
      ? {
          readerSource: result.readerSource ?? 'page',
          readerSourceAt:
            result.readerSource === 'archive' ? (result.readerSourceAt ?? null) : null,
        }
      : {}),
    contentHtml:
      reader?.contentHtml ?? sql`case when ${keepCurrent} then ${links.contentHtml} else null end`,
    contentImages:
      reader?.contentImages ??
      sql`case when ${keepCurrent} then ${links.contentImages} else null end`,
    readerVersion: READER_VERSION,
    readerCapturedAt:
      reader || result.renderPending
        ? fetchedAt
        : sql`case when ${keepCurrent} and ${links.readerRenderPending} is not true then ${links.readerCapturedAt} else ${fetchedAt}::timestamptz end`,
    readerRenderPending: result.renderPending ?? false,
    ...(text
      ? {
          extractedText: reader
            ? text.slice(0, FIELD_MAX.text).replace(/[\uD800-\uDBFF]$/, '')
            : sql`case when ${keepCurrent} then ${links.extractedText} else ${text.slice(0, FIELD_MAX.text).replace(/[\uD800-\uDBFF]$/, '')} end`,
        }
      : {}),
    // Reader maintenance must not change the link's metadata edit timestamp.
    updatedAt: sql`${links.updatedAt}`,
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
  explicitRefresh = false,
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
  let result: ObservedReader;
  try {
    result = await Promise.race([run(link, controller.signal), deadline]);
  } catch {
    result = { status: 'fetch_failed' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
  }
  if (controller.signal.aborted || signal?.aborted) return { status: 'fetch_failed' };
  if (result.observation !== undefined)
    await recordReaderAccess(link.id, result.observation, fetchedAt);
  if (result.status === 'fetch_failed') return result;
  if (result.status === 'reader' && !readerContentSchema.safeParse(result.reader).success) {
    return { status: 'fetch_failed' };
  }
  return recordRefresh(link.id, result, fetchedAt, explicitRefresh);
}

async function recordRefresh(
  id: string,
  result: Exclude<ReaderExtraction, { status: 'fetch_failed' }>,
  fetchedAt: Date,
  explicitRefresh: boolean,
): Promise<RefreshResult> {
  const written = await recordReader(id, result, fetchedAt, explicitRefresh);
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
    .where(and(sql`${links.deletedAt} is null`, eq(links.id, id)));
  return { status: existing ? 'no_reader' : 'not_found' };
}

function coalesce(
  id: string,
  load: () => Promise<ReaderLink | undefined>,
  run = refresher,
  signal?: AbortSignal,
  explicitRefresh = false,
): Promise<RefreshResult> {
  const key = `${id}:${explicitRefresh}`;
  const running = pending.get(key);
  if (running) return running;
  const work = load()
    .then((link) =>
      link
        ? extractAndRecord(link, run, signal, explicitRefresh)
        : ({ status: 'not_found' } as const),
    )
    .finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

export function refreshReader(id: string): Promise<RefreshResult> {
  return coalesce(
    id,
    async () => {
      const [link] = await db
        .select({ id: links.id, url: links.url, sourceKind: links.sourceKind })
        .from(links)
        .where(and(sql`${links.deletedAt} is null`, eq(links.id, id)));
      return link;
    },
    refresher,
    undefined,
    true,
  );
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
      and(
        sql`${links.deletedAt} is null`,
        and(
          or(
            sql`${links.readerVersion} is null`,
            ne(links.readerVersion, READER_VERSION),
            eq(links.readerRenderPending, true),
          ),
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
            and(
              sql`${links.deletedAt} is null`,
              and(
                eq(links.id, link.id),
                or(
                  sql`${links.readerVersion} is distinct from ${READER_VERSION}`,
                  eq(links.readerRenderPending, true),
                ),
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

/** Access observations are ordered independently of stored Reader maintenance. */
export async function recordReaderAccess(
  id: string,
  access: ReaderAccess | null,
  observedAt: Date,
): Promise<void> {
  await db
    .update(links)
    .set({
      readerAccess: access,
      readerAccessAt: observedAt,
      updatedAt: sql`${links.updatedAt}`,
    })
    .where(
      and(
        eq(links.id, id),
        sql`${links.deletedAt} is null`,
        ne(links.sourceKind, 'twitter'),
        sql`(${links.readerAccessAt} is null or ${links.readerAccessAt} <= ${observedAt})`,
      ),
    );
}
