import { canonicalize, type FeedEntry, listFeeds, type ObservedReader } from '@silo/core';
import { parseHTML } from 'linkedom';
import { type ExtractResult, extract } from '../extract/extract.js';
import { FULL_TEXT_THRESHOLD } from '../extract/extract-constants.js';
import { parseFeedBody } from '../feeds/parse.js';
import { findArchiveSnapshot } from '../fetch/archive.js';
import { type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';

type Fetch = (url: string, signal: AbortSignal) => Promise<SafeFetchResult>;
const MAX_CACHED_HOSTS = 500;
type Followed = { siteUrl: string | null; feedUrl: string };
type SourceReader = Extract<ObservedReader, { status: 'reader' }> & { metadata: ExtractResult };

/** One chain per worker; cache discovery, never article content. */
export function createOtherSources(
  deps: { fetch?: Fetch; feeds?: () => Promise<Followed[]>; now?: () => number } = {},
) {
  const cache = new Map<string, { until: number; url: string | null }>();
  const fetch = deps.fetch ?? ((url, signal) => safeFetch(url, { signal, timeoutMs: 15_000 }));
  const now = deps.now ?? Date.now;
  async function feed(
    url: URL,
    signal: AbortSignal,
    accept: (result: SourceReader) => boolean,
  ): Promise<SourceReader | undefined> {
    // Followed feeds are read fresh each time, so a feed followed a minute ago counts.
    // Only the guessed addresses are cached per host.
    const followed = await followedFeeds(url, deps.feeds ?? listFeeds);
    const cached = fresh(cache.get(url.host), now());
    const candidates = feedCandidates(followed, cached, url);
    let working: string | null = cached?.url ?? null;
    for (const candidate of candidates) {
      const parsed = await fetchFeed(candidate, signal, fetch);
      if (!parsed) continue;
      if (!followed.includes(candidate)) working ??= candidate;
      const result = await feedEntry(parsed.entries, url.href);
      if (result && accept(result)) {
        rememberGuess(url.host, working);
        return result;
      }
    }
    rememberGuess(url.host, working);
    return undefined;
  }
  function rememberGuess(host: string, url: string | null) {
    // Re-inserting moves the host to the end, so the first key is the stalest one.
    cache.delete(host);
    cache.set(host, { until: now() + 3_600_000, url });
    if (cache.size > MAX_CACHED_HOSTS) cache.delete(cache.keys().next().value ?? '');
  }
  async function archive(url: string, signal: AbortSignal): Promise<SourceReader | undefined> {
    const snapshot = await findArchiveSnapshot(url, signal, fetch);
    if (!snapshot) return undefined;
    const { stamp, date } = snapshot;
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
      (sourceSignal: AbortSignal) =>
        feed(new URL(url), sourceSignal, (result) => canReplace(page, result)),
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

// These kinds have their own source enrichers; a feed or archive copy is never their Reader.
const OWN_SOURCE_KINDS = new Set(['twitter', 'youtube', 'hacker_news', 'github', 'feed_media']);

export function usesOtherSources(sourceKind: string): boolean {
  return !OWN_SOURCE_KINDS.has(sourceKind);
}

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

async function followedFeeds(url: URL, load: () => Promise<Followed[]>): Promise<string[]> {
  const followed = await load().catch(() => []);
  return followed.filter((f) => sameHost(f.siteUrl, url.host)).map((f) => f.feedUrl);
}
function feedCandidates(
  followed: string[],
  cached: { url: string | null } | undefined,
  url: URL,
): string[] {
  const guesses = cached ? (cached.url ? [cached.url] : []) : guessedFeeds(url);
  return [...new Set([...followed, ...guesses])].slice(0, 3);
}
function guessedFeeds(url: URL): string[] {
  // Big Think answers /feed/ but blocks /feed; Substack answers only /feed.
  return [`${url.origin}/feed/`, `${url.origin}/feed`, `${url.origin}/rss.xml`];
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
