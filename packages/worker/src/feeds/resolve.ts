import { type FeedPollResult, type FeedRow, type ResolvedFeed, setFeedResolver } from '@silo/core';
import { parseHTML } from 'linkedom';
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_TIMEOUT_MS,
  type SafeFetchOptions,
  type SafeFetchResult,
  safeFetch,
} from '../fetch/safe-fetch.js';
import {
  cleanTitle,
  FEED_MAX_BODY_BYTES,
  httpUrl,
  type ParsedFeed,
  parseFeedBody,
  pollInterval,
} from './parse.js';

/** Unknown initial URLs may be feeds or discovery pages; HTML keeps its ordinary cap. */
function feedBodyCap(contentType: string | undefined): number {
  return /text\/html|application\/xhtml/i.test(contentType ?? '')
    ? DEFAULT_MAX_BODY_BYTES
    : FEED_MAX_BODY_BYTES;
}

const FEED_ACCEPT =
  'application/feed+json, application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5';
const RESPONSE_HEADERS = ['etag', 'last-modified', 'cache-control', 'retry-after'];
export type FeedFetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;

function prepare(
  parsed: ParsedFeed,
  response: Extract<SafeFetchResult, { ok: true }>,
  page?: { url: string; title: string },
): ResolvedFeed {
  const siteUrl = parsed.siteUrl ?? page?.url ?? new URL(response.finalUrl).origin;
  const headers = response.responseHeaders ?? {};
  return {
    ...parsed,
    feedUrl: response.finalUrl,
    siteUrl,
    title: parsed.title || page?.title || new URL(siteUrl).hostname,
    intervalSeconds: pollInterval(headers, parsed.ttlMinutes),
    ...(headers.etag ? { etag: headers.etag } : {}),
    ...(headers['last-modified'] ? { lastModified: headers['last-modified'] } : {}),
  };
}

function pageMetadata(body: string, url: string) {
  const { document } = parseHTML(body);
  const title =
    cleanTitle(
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? '',
    ) || cleanTitle(document.querySelector('title')?.textContent ?? '');
  const types = new Set([
    'application/rss+xml',
    'application/atom+xml',
    'application/feed+json',
    'application/json',
  ]);
  const alternate = Array.from(document.querySelectorAll('link')).find(
    (link) =>
      (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('alternate') &&
      types.has((link.getAttribute('type') ?? '').toLowerCase()),
  );
  return { url, title, alternate: httpUrl(alternate?.getAttribute('href') ?? undefined, url) };
}

/** All discovery requests share safeFetch's SSRF boundary; eight total fetches, including metadata. */
export async function resolveFeed(
  url: string,
  fetcher: FeedFetcher = safeFetch,
): Promise<ResolvedFeed | null> {
  const initial = httpUrl(url, url);
  if (!initial) return null;
  const fetchOne = discoveryFetcher(fetcher);
  return discover(initial, fetchOne);
}

function discoveryFetcher(fetcher: FeedFetcher) {
  let remaining = 8;
  const deadline = Date.now() + 15_000;
  const visited = new Set<string>();
  return async (candidate: string, pageOnly = false) => {
    const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, deadline - Date.now());
    if (!remaining || timeoutMs <= 0 || visited.has(candidate)) return null;
    remaining--;
    visited.add(candidate);
    return fetcher(candidate, {
      accept: FEED_ACCEPT,
      responseHeaderNames: RESPONSE_HEADERS,
      timeoutMs,
      maxBodyBytes: pageOnly ? DEFAULT_MAX_BODY_BYTES : feedBodyCap,
    });
  };
}

async function discover(
  initial: string,
  fetchOne: ReturnType<typeof discoveryFetcher>,
): Promise<ResolvedFeed | null> {
  const first = await fetchOne(initial);
  if (!first?.ok || first.notModified) return null;
  const parsed = parseFeedBody(first.html, first.finalUrl);
  if (parsed) return prepareDirect(parsed, first, fetchOne);
  if (
    !/text\/html|application\/xhtml/i.test(first.contentType ?? '') &&
    !/<(?:html|head|link|!doctype)\b/i.test(first.html)
  )
    return null;
  const page = pageMetadata(first.html, first.finalUrl);
  const base = new URL(first.finalUrl);
  const suffixes = ['feed', 'rss', 'rss.xml', 'atom.xml', 'feed.xml', 'index.xml'];
  const pageBase = new URL(`${base.pathname.replace(/\/$/, '')}/`, base.origin);
  const candidates = page.alternate
    ? [page.alternate]
    : [
        ...suffixes.map((suffix) => new URL(suffix, pageBase).href),
        ...suffixes.map((suffix) => new URL(suffix, base.origin).href),
      ];
  for (const candidate of candidates) {
    const response = await fetchOne(candidate);
    if (!response?.ok || response.notModified) continue;
    const feed = parseFeedBody(response.html, response.finalUrl);
    if (feed) return prepare(feed, response, page);
  }
  return null;
}

export async function fetchFeedPoll(
  feed: FeedRow,
  fetcher: FeedFetcher = safeFetch,
): Promise<FeedPollResult> {
  const response = await fetcher(feed.feedUrl, {
    maxBodyBytes: feedBodyCap,
    accept: FEED_ACCEPT,
    responseHeaderNames: RESPONSE_HEADERS,
    headers: {
      ...(feed.etag ? { 'if-none-match': feed.etag } : {}),
      ...(feed.lastModified ? { 'if-modified-since': feed.lastModified } : {}),
    },
  });
  if (!response.ok) return pollFailure(response, feed.pollIntervalSeconds);
  const headers = response.responseHeaders ?? {};
  if (response.notModified)
    return {
      kind: 'not-modified',
      intervalSeconds: pollInterval(headers, feed.pollIntervalSeconds / 60),
      ...(headers.etag ? { etag: headers.etag } : {}),
      ...(headers['last-modified'] ? { lastModified: headers['last-modified'] } : {}),
    };
  const parsed = parseFeedBody(response.html, response.finalUrl);
  if (!parsed || response.status !== 200)
    return { kind: 'failure', message: 'The response is not a valid feed.' };
  const prepared = parsed.title
    ? prepare(parsed, response, { url: feed.siteUrl ?? new URL(feed.feedUrl).origin, title: '' })
    : await prepareDirect(parsed, response, (url) =>
        fetcher(url, {
          accept: FEED_ACCEPT,
          responseHeaderNames: RESPONSE_HEADERS,
          maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
        }),
      );
  if (!response.permanentRedirect) prepared.feedUrl = feed.feedUrl;
  return { kind: 'modified', feed: prepared };
}

export function registerFeedResolver(): { close: () => void } {
  setFeedResolver((url) => resolveFeed(url));
  return { close: () => setFeedResolver(undefined) };
}

async function prepareDirect(
  parsed: ParsedFeed,
  first: Extract<SafeFetchResult, { ok: true }>,
  fetchOne: ReturnType<typeof discoveryFetcher>,
) {
  if (!parsed.title && parsed.siteUrl) {
    const site = await fetchOne(parsed.siteUrl, true);
    if (site?.ok) return prepare(parsed, first, pageMetadata(site.html, site.finalUrl));
  }
  return prepare(parsed, first);
}
function pollFailure(
  response: Extract<SafeFetchResult, { ok: false }>,
  interval: number,
): FeedPollResult {
  console.error('[silo/worker] poll-feed: fetch failed:', response);
  return {
    kind: 'failure',
    message: failureMessage(response),
    ...(response.status === 410 ? { gone: true } : {}),
    ...(response.responseHeaders?.['retry-after']
      ? { retryAfterSeconds: pollInterval(response.responseHeaders, undefined, interval) }
      : {}),
  };
}

function failureMessage(response: Extract<SafeFetchResult, { ok: false }>): string {
  switch (response.reason) {
    case 'blocked-ip':
    case 'blocked-scheme':
      return 'This feed resolves to a blocked address.';
    case 'timeout':
      return 'The feed request timed out.';
    case 'body-too-large':
      return 'The feed is too large.';
    case 'http-error':
    case 'not-found':
      return response.status
        ? `The feed returned HTTP ${response.status}.`
        : 'The feed was not found.';
    default:
      return 'Could not fetch this feed.';
  }
}
