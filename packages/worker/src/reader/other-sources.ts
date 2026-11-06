import { canonicalize, type FeedEntry, listFeeds, type ObservedReader } from '@silo/core';
import { parseHTML } from 'linkedom';
import { type ExtractResult, extract } from '../extract/extract.js';
import { FULL_TEXT_THRESHOLD } from '../extract/extract-constants.js';
import { parseFeedBody } from '../feeds/parse.js';
import { type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';

type Fetch = (url: string, signal: AbortSignal) => Promise<SafeFetchResult>;
type Followed = { siteUrl: string | null; feedUrl: string };
type SourceReader = Extract<ObservedReader, { status: 'reader' }> & { metadata: ExtractResult };

/** One chain per worker; cache discovery, never article content. */
export function createOtherSources(
  deps: { fetch?: Fetch; feeds?: () => Promise<Followed[]>; now?: () => number } = {},
) {
  const cache = new Map<string, { until: number; url: string | null }>();
  const fetch = deps.fetch ?? ((url, signal) => safeFetch(url, { signal, timeoutMs: 15_000 }));
  const now = deps.now ?? Date.now;
  async function feed(url: URL, signal: AbortSignal): Promise<SourceReader | undefined> {
    const cached = cache.get(url.host);
    const known = fresh(cached, now());
    if (known?.url === null) return undefined;
    const candidates = known?.url
      ? [known.url]
      : await feedCandidates(url, deps.feeds ?? listFeeds);
    let working: string | null = null;
    for (const candidate of candidates) {
      const parsed = await fetchFeed(candidate, signal, fetch);
      if (!parsed) continue;
      working ??= candidate;
      cache.set(url.host, { until: now() + 3_600_000, url: working });
      const result = await feedEntry(parsed.entries, url.href);
      if (result) {
        cache.set(url.host, { until: now() + 3_600_000, url: candidate });
        return result;
      }
    }
    cache.set(url.host, { until: now() + 3_600_000, url: working });
    return undefined;
  }
  async function archive(url: string, signal: AbortSignal): Promise<SourceReader | undefined> {
    const available = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      signal,
    );
    if (!available.ok) return undefined;
    const data = JSON.parse(available.html) as {
      archived_snapshots?: { closest?: { available?: boolean; timestamp?: string } };
    };
    const snapshot = data.archived_snapshots?.closest;
    const stamp = snapshot?.timestamp;
    if (!snapshot?.available || !stamp || !/^\d{14}$/.test(stamp)) return undefined;
    const date = new Date(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`,
    );
    if (!Number.isFinite(date.getTime())) return undefined;
    const page = await fetch(`https://web.archive.org/web/${stamp}id_/${url}`, signal);
    if (!page.ok) return undefined;
    const result = await extract({ url, html: page.html, contentType: page.contentType });
    if (!result.reader || result.access === 'blocked') return undefined;
    return {
      status: 'reader',
      reader: result.reader,
      text: result.text ?? '',
      readerSource: 'archive',
      readerSourceAt: date,
      metadata: result,
    };
  }
  return async (
    url: string,
    page: ObservedReader,
    signal?: AbortSignal,
  ): Promise<ObservedReader & { metadata?: ExtractResult }> => {
    if (!needsSource(page)) return page;
    for (const run of [
      (sourceSignal: AbortSignal) => feed(new URL(url), sourceSignal),
      (sourceSignal: AbortSignal) => archive(url, sourceSignal),
    ]) {
      if (signal?.aborted) return page;
      try {
        const deadline = sourceSignal(signal);
        const result = await boundedSource(run, deadline);
        if (result && canReplace(page, result)) return { ...result, observation: page.observation };
        console.debug('[reader] other source unavailable', url);
      } catch (error) {
        console.debug('[reader] other source failed', url, error);
      }
    }
    return page;
  };
}
function sourceSignal(signal?: AbortSignal): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
}
export const otherSources = createOtherSources();

function needsSource(page: ObservedReader): boolean {
  return (
    page.status !== 'reader' || page.observation === 'paywalled' || page.observation === 'blocked'
  );
}
function canReplace(page: ObservedReader, result: SourceReader): boolean {
  const length = page.status === 'reader' ? (page.text?.length ?? 0) : 0;
  return page.observation !== 'paywalled' || (result.text?.length ?? 0) >= length * 1.5;
}
async function feedEntry(entries: FeedEntry[], url: string): Promise<SourceReader | undefined> {
  const entry = entries.find((e) => canonicalize(e.url).canonical === canonicalize(url).canonical);
  if (!entry) return undefined;
  const html = [entry.content, entry.description]
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => b.length - a.length)[0];
  if (!html) return undefined;
  const { document } = parseHTML('<html><head></head><body></body></html>');
  const title = document.createElement('title');
  title.textContent = entry.title ?? '';
  document.head.append(title);
  document.body.innerHTML = `<article>${html}</article>`;
  const result = await extract({ url, html: document.toString(), contentType: 'text/html' });
  if (
    !result.reader ||
    result.access === 'blocked' ||
    (result.text?.trim().length ?? 0) < FULL_TEXT_THRESHOLD
  )
    return undefined;
  return {
    status: 'reader',
    reader: result.reader,
    text: result.text ?? '',
    readerSource: 'feed',
    metadata: result,
  };
}

async function feedCandidates(url: URL, load: () => Promise<Followed[]>): Promise<string[]> {
  const followed = await load().catch(() => []);
  return [
    ...new Set([
      ...followed.filter((f) => sameHost(f.siteUrl, url.host)).map((f) => f.feedUrl),
      `${url.origin}/feed`,
      `${url.origin}/rss.xml`,
    ]),
  ].slice(0, 3);
}
function sameHost(siteUrl: string | null, host: string): boolean {
  try {
    return siteUrl !== null && new URL(siteUrl).host === host;
  } catch {
    return false;
  }
}

function fresh(cached: { until: number; url: string | null } | undefined, now: number) {
  return cached && cached.until > now ? cached : undefined;
}
async function fetchFeed(url: string, signal: AbortSignal, fetch: Fetch) {
  const response = await fetch(url, signal);
  if (!response.ok) return null;
  return parseFeedBody(response.html, response.finalUrl);
}

async function boundedSource(
  run: (signal: AbortSignal) => Promise<SourceReader | undefined>,
  signal: AbortSignal,
) {
  if (signal.aborted) return undefined;
  let abort = () => {};
  const stopped = new Promise<undefined>((resolve) => {
    abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([run(signal), stopped]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
