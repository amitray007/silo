import { type SiteIconFinder, setSiteIconFinder } from '@silo/core';
import { parseHTML } from 'linkedom';
import { type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;
/** Icons are declared in the head; parsing past it only costs time. */
const HEAD_BYTES = 256 * 1024;
/** The size the favicon route serves. */
const WANTED_SIZE = 32;
/** Distance used when a link declares no size: between a good fit and a poor one. */
const UNKNOWN_SIZE_DISTANCE = 8;

type Fetch = (url: string, options: { signal: AbortSignal }) => Promise<SafeFetchResult>;
type Entry = { icon: string | null; expires: number };
type Candidate = { url: string; format: number; distance: number; order: number };

/** 0 for a raster format a browser tab can show, 1 when the format is unknown, undefined for SVG. */
function formatRank(href: string, type: string): number | undefined {
  const declared = type.trim().toLowerCase();
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(href)?.[1]?.toLowerCase();
  if (declared.includes('svg') || extension === 'svg') return undefined;
  if (/(png|icon|gif|webp)/.test(declared)) return 0;
  if (extension && ['png', 'ico', 'gif', 'webp'].includes(extension)) return 0;
  return 1;
}

function sizeDistance(sizes: string): number {
  const distances = [...sizes.toLowerCase().matchAll(/(\d+)x(\d+)/g)].map((match) =>
    Math.abs(Number(match[1]) - WANTED_SIZE),
  );
  return distances.length > 0 ? Math.min(...distances) : UNKNOWN_SIZE_DISTANCE;
}

function absoluteHttpUrl(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The best link whose rel contains `token`, or undefined when none is usable. */
function bestLink(links: Iterable<Element>, token: string, base: string): string | undefined {
  const candidates: Candidate[] = [];
  let order = 0;
  for (const link of links) {
    const rels = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const href = link.getAttribute('href')?.trim();
    if (!href || !rels.includes(token)) continue;
    const url = absoluteHttpUrl(href, base);
    const format = formatRank(href, link.getAttribute('type') ?? '');
    if (url && format !== undefined) {
      candidates.push({
        url,
        format,
        distance: sizeDistance(link.getAttribute('sizes') ?? ''),
        order: order++,
      });
    }
  }
  candidates.sort((a, b) => a.format - b.format || a.distance - b.distance || a.order - b.order);
  return candidates[0]?.url;
}

function pickIcon(html: string, finalUrl: string): string {
  const end = html.search(/<\/head\s*>/i);
  const head = html.slice(0, end === -1 ? HEAD_BYTES : Math.min(end, HEAD_BYTES));
  const { document } = parseHTML(head);
  const links = [...document.querySelectorAll('link[rel]')];
  return (
    bestLink(links, 'icon', finalUrl) ??
    bestLink(links, 'apple-touch-icon', finalUrl) ??
    bestLink(links, 'apple-touch-icon-precomposed', finalUrl) ??
    new URL('/favicon.ico', finalUrl).href
  );
}

async function readIcon(domain: string, fetch: Fetch, signal: AbortSignal): Promise<string | null> {
  const page = await fetch(`https://${domain}/`, { signal });
  if (!page.ok) {
    // A site that refuses its home page may still serve the conventional icon path.
    const refused = page.reason === 'http-error' || page.reason === 'not-found';
    return refused ? `https://${domain}/favicon.ico` : null;
  }
  if (!/html/i.test(page.contentType ?? 'text/html')) {
    return new URL('/favicon.ico', page.finalUrl).href;
  }
  return pickIcon(page.html, page.finalUrl);
}

/**
 * Finds a site's own icon URL for domains the favicon proxy's first source does
 * not know. Reads the home page through the SSRF-safe fetcher, prefers a
 * declared icon link, then an apple-touch-icon, then `/favicon.ico` on the
 * final origin. Results (including misses) stay in memory for a day, and
 * overlapping lookups for one domain share a single fetch.
 */
export function createSiteIconFinder(
  options: { fetch?: Fetch; now?: () => number } = {},
): SiteIconFinder & { clear: () => void } {
  const fetch: Fetch =
    options.fetch ??
    ((url, { signal }) =>
      safeFetch(url, { signal, maxBodyBytes: MAX_BODY_BYTES, timeoutMs: TIMEOUT_MS }));
  const now = options.now ?? Date.now;
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<string | null>>();

  const remember = (domain: string, icon: string | null) => {
    cache.delete(domain);
    cache.set(domain, { icon, expires: now() + TTL_MS });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  };

  /** The shared fetch ignores every caller's signal: safeFetch bounds it with TIMEOUT_MS. */
  const lookup = (domain: string): Promise<string | null> => {
    const hit = cache.get(domain);
    if (hit && hit.expires > now()) return Promise.resolve(hit.icon);
    const running = pending.get(domain);
    if (running) return running;
    const work = readIcon(domain, fetch, new AbortController().signal)
      .catch(() => null)
      .then((icon) => {
        remember(domain, icon);
        return icon;
      })
      .finally(() => pending.delete(domain));
    pending.set(domain, work);
    return work;
  };

  const find: SiteIconFinder = (domain, signal) => {
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const stop = () => resolve(undefined);
      signal.addEventListener('abort', stop, { once: true });
      lookup(domain.toLowerCase())
        .then((icon) => resolve(icon ?? undefined))
        .finally(() => signal.removeEventListener('abort', stop));
    });
  };
  return Object.assign(find, { clear: () => cache.clear() });
}

/** Registration must run in the HTTP process, beside the favicon route. */
export function registerSiteIcons(): { close: () => void } {
  const finder = createSiteIconFinder();
  setSiteIconFinder(finder);
  return {
    close: () => {
      setSiteIconFinder(undefined);
      finder.clear();
    },
  };
}
