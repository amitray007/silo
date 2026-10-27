import { type LiveReader, type ReaderContent, setLiveReader } from '@silo/core';
import { readerContentSchema } from '@silo/core/capture';
import { type ExtractInput, type ExtractResult, extract } from '../extract/extract.js';
import { extractYouTubeWatch } from '../extract/youtube-watch.js';
import { HTML_ACCEPT, type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';

const HIT_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

type Fetch = (url: string) => Promise<SafeFetchResult>;
type Extract = (input: ExtractInput) => Promise<ExtractResult>;
type Entry = { url: string; content: ReaderContent | undefined; expires: number };

/**
 * Runs the capture extraction path on the live page and keeps only the Reader
 * half. YouTube takes the watch-page reader first, as capture does. Anything
 * unexpected (blocked fetch, parser timeout, schema mismatch) means "no Reader".
 */
async function buildReader(
  link: { url: string; sourceKind: string },
  fetch: Fetch,
  run: Extract,
): Promise<ReaderContent | undefined> {
  const page = await fetch(link.url);
  if (!page.ok) return undefined;
  const youtube =
    link.sourceKind === 'youtube' ? extractYouTubeWatch(page.html, page.finalUrl) : undefined;
  const extracted = await run({
    url: page.finalUrl,
    html: page.html,
    contentType: page.contentType,
  });
  const parsed = readerContentSchema.safeParse(youtube?.reader ?? extracted.reader);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Builds the Reader HTML when a link opens instead of storing it. Results stay
 * in memory by link id: a Reader for ten minutes, "no Reader" for two, so a
 * transient failure is retried soon. Overlapping requests for one link share a
 * single fetch. That fetch ignores every caller's signal (safeFetch and the
 * parser thread bound it), so one caller leaving never cancels another.
 */
export function createLiveReader(
  options: { fetch?: Fetch; extract?: Extract; now?: () => number } = {},
): LiveReader & { clear: () => void } {
  const fetch = options.fetch ?? ((url) => safeFetch(url, { accept: HTML_ACCEPT }));
  const run = options.extract ?? extract;
  const now = options.now ?? Date.now;
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<ReaderContent | undefined>>();

  const remember = (id: string, url: string, content: ReaderContent | undefined) => {
    cache.delete(id);
    cache.set(id, { url, content, expires: now() + (content ? HIT_TTL_MS : MISS_TTL_MS) });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  };

  const lookup = (link: { id: string; url: string; sourceKind: string }) => {
    const hit = cache.get(link.id);
    if (hit && hit.url === link.url && hit.expires > now()) return Promise.resolve(hit.content);
    const running = pending.get(link.id);
    if (running) return running;
    const work = buildReader(link, fetch, run)
      .catch(() => undefined)
      .then((content) => {
        remember(link.id, link.url, content);
        return content;
      })
      .finally(() => pending.delete(link.id));
    pending.set(link.id, work);
    return work;
  };

  const read: LiveReader = (link, signal) => {
    if (link.sourceKind === 'twitter' || signal.aborted) return Promise.resolve(undefined);
    // Resolves as soon as this caller aborts, leaving the shared lookup running.
    return new Promise((resolve) => {
      const stop = () => resolve(undefined);
      signal.addEventListener('abort', stop, { once: true });
      lookup(link)
        .then(resolve)
        .finally(() => signal.removeEventListener('abort', stop));
    });
  };
  return Object.assign(read, { clear: () => cache.clear() });
}

/** Registration must run in the HTTP process, beside the page viewer. */
export function registerLiveReader(): { close: () => void } {
  const reader = createLiveReader();
  setLiveReader(reader);
  return {
    close: () => {
      setLiveReader(undefined);
      reader.clear();
    },
  };
}
