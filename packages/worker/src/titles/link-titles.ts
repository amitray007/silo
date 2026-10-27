import { type LinkTitleFetcher, setLinkTitleFetcher } from '@silo/core';
import metascraper from 'metascraper';
import metascraperTitle from 'metascraper-title';
import { type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';

const scraper = metascraper([metascraperTitle()]);

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const CONCURRENCY = 4;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
/** Titles live in the head; parsing past it only costs time on the API thread. */
const HEAD_BYTES = 256 * 1024;
const MAX_TITLE = 300;

type Fetch = (url: string, options: { signal: AbortSignal }) => Promise<SafeFetchResult>;
type Entry = { title: string | null; expires: number };

async function readTitle(url: string, fetch: Fetch, signal: AbortSignal): Promise<string | null> {
  const page = await fetch(url, { signal });
  if (!page.ok || !/html/i.test(page.contentType ?? 'text/html')) return null;
  const end = page.html.search(/<\/head\s*>/i);
  const head = page.html.slice(0, end === -1 ? HEAD_BYTES : Math.min(end, HEAD_BYTES));
  const { title } = await scraper({ url: page.finalUrl, html: head });
  const clean = title?.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, MAX_TITLE) : null;
}

/**
 * Fetches the pages an article links to through the SSRF-safe fetcher and keeps
 * their titles in memory for a day, so reopening Related links costs nothing.
 * Failures cache as "no title" so a dead link is not refetched on every open.
 */
export function createLinkTitleFetcher(
  options: { fetch?: Fetch; now?: () => number } = {},
): LinkTitleFetcher & { clear: () => void } {
  const fetch: Fetch =
    options.fetch ??
    ((url, { signal }) =>
      safeFetch(url, { signal, maxBodyBytes: MAX_BODY_BYTES, timeoutMs: TIMEOUT_MS }));
  const now = options.now ?? Date.now;
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<string | null>>();

  const remember = (url: string, title: string | null) => {
    cache.delete(url);
    cache.set(url, { title, expires: now() + TTL_MS });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  };

  const lookup = (url: string, signal: AbortSignal): Promise<string | null> => {
    const hit = cache.get(url);
    if (hit && hit.expires > now()) return Promise.resolve(hit.title);
    const running = pending.get(url);
    if (running) return running;
    const work = readTitle(url, fetch, signal)
      .catch(() => null)
      .then((title) => {
        // An aborted request says nothing about the page; leave it uncached.
        if (!signal.aborted) remember(url, title);
        return title;
      })
      .finally(() => pending.delete(url));
    pending.set(url, work);
    return work;
  };

  const fetchTitles = async (urls: readonly string[], signal: AbortSignal) => {
    const titles: Record<string, string> = {};
    const queue = [...new Set(urls)];
    const run = async () => {
      for (let url = queue.shift(); url !== undefined && !signal.aborted; url = queue.shift()) {
        const title = await lookup(url, signal);
        if (title) titles[url] = title;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, run));
    return titles;
  };
  return Object.assign(fetchTitles, { clear: () => cache.clear() });
}

/** Registration must run in the HTTP process, beside the page viewer. */
export function registerLinkTitles(): { close: () => void } {
  const fetcher = createLinkTitleFetcher();
  setLinkTitleFetcher(fetcher);
  return {
    close: () => {
      setLinkTitleFetcher(undefined);
      fetcher.clear();
    },
  };
}
