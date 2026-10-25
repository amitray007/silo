import {
  type FrameHint,
  type PageViewer,
  PageViewerUnavailableError,
  setPageViewer,
} from '@silo/core';
import { type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';
import { PageCache } from './cache.js';
import { ViewLimit } from './limit.js';
import { allowsFraming } from './policy.js';
import { TransformPool } from './pool.js';

type Page = {
  finalUrl: string;
  contentType?: string;
  xFrameOptions?: string;
  contentSecurityPolicy?: string;
  html?: Buffer;
  reason?: string;
};
type Pending = { controller: AbortController; promise: Promise<Page>; users: number };
type ViewerOptions = {
  fetch?: (url: string, signal: AbortSignal) => Promise<SafeFetchResult>;
  transform?: (html: string, finalUrl: string, signal: AbortSignal) => Promise<string>;
  cacheBytes?: number;
  ttlMs?: number;
  waitMs?: number;
};

function hintFor(page: Page, origin: string): FrameHint {
  const contentType = page.contentType ? { contentType: page.contentType } : {};
  if (page.reason) return { mode: 'none', reason: page.reason, ...contentType };
  const mime = page.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  const displayable =
    page.html || mime === 'application/pdf' || mime === 'text/plain' || mime.startsWith('image/');
  if (!displayable) return { mode: 'none', reason: 'unsupported-content', ...contentType };
  if (allowsFraming(page, page.finalUrl, origin)) return { mode: 'direct', ...contentType };
  return page.html
    ? { mode: 'view', reason: 'framing-blocked', ...contentType }
    : { mode: 'none', reason: 'non-html-framing-blocked', ...contentType };
}

/** One cache/fetch shared by /frame and /view. Policy is evaluated per caller origin. */
export function createPageViewer(options: ViewerOptions = {}): {
  view: PageViewer;
  close: () => Promise<void>;
} {
  const pool = new TransformPool();
  const transform = options.transform ?? ((html, url, signal) => pool.run(html, url, signal));
  const fetchPage = options.fetch ?? ((url, signal) => safeFetch(url, { signal }));
  const cache = new PageCache<Page>(options.cacheBytes, options.ttlMs);
  const limit = new ViewLimit(options.waitMs);
  const pending = new Map<string, Pending>();

  async function load(url: string, signal: AbortSignal): Promise<Page> {
    const release = await limit.acquire(signal);
    try {
      signal.throwIfAborted();
      const fetched = await fetchPage(url, signal);
      signal.throwIfAborted();
      if (!fetched.ok) return { finalUrl: url, reason: fetched.reason };
      const { finalUrl, contentType, xFrameOptions, contentSecurityPolicy } = fetched;
      const page: Page = {
        finalUrl,
        ...(contentType ? { contentType } : {}),
        ...(xFrameOptions !== undefined ? { xFrameOptions } : {}),
        ...(contentSecurityPolicy !== undefined ? { contentSecurityPolicy } : {}),
      };
      const mime = contentType?.split(';')[0]?.trim().toLowerCase();
      if (mime === 'text/html' || mime === 'application/xhtml+xml') {
        try {
          page.html = Buffer.from(await transform(fetched.html, finalUrl, signal));
        } catch {
          signal.throwIfAborted();
          page.reason = 'transform-unavailable';
        }
      }
      return page;
    } finally {
      release();
    }
  }

  function start(key: string, url: string): Pending {
    const controller = new AbortController();
    const entry: Pending = { controller, users: 0, promise: Promise.resolve({ finalUrl: url }) };
    entry.promise = load(url, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          const { html, ...metadata } = page;
          cache.set(
            key,
            page,
            (html?.byteLength ?? 0) + Buffer.byteLength(JSON.stringify(metadata)),
          );
        }
        return page;
      })
      .finally(() => {
        if (pending.get(key) === entry) pending.delete(key);
      });
    pending.set(key, entry);
    return entry;
  }

  function subscribe(entry: Pending, signal: AbortSignal): Promise<Page> {
    entry.users++;
    return new Promise<Page>((resolve, reject) => {
      let done = false;
      const finish = (page?: Page, error?: unknown) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', abort);
        entry.users--;
        if (!entry.users) entry.controller.abort();
        if (page) resolve(page);
        else reject(error);
      };
      const abort = () => finish(undefined, new PageViewerUnavailableError());
      signal.addEventListener('abort', abort, { once: true });
      entry.promise.then(
        (page) => finish(page),
        (error: unknown) => finish(undefined, error),
      );
      if (signal.aborted) abort();
    });
  }

  const view: PageViewer = async ({ id, url, origin, signal }) => {
    signal.throwIfAborted();
    const key = `${id}:${url}`;
    const cached = cache.get(key);
    const existing = pending.get(key);
    const entry = existing && !existing.controller.signal.aborted ? existing : undefined;
    const page = cached ?? (await subscribe(entry ?? start(key, url), signal));
    return { frame: hintFor(page, origin), ...(page.html ? { html: page.html.toString() } : {}) };
  };
  return {
    view,
    close: async () => {
      for (const entry of pending.values()) entry.controller.abort();
      await Promise.allSettled(Array.from(pending.values(), (entry) => entry.promise));
      await pool.close();
      cache.clear();
    },
  };
}

/** Registration must run in the HTTP process, including when enrichment cannot start. */
export function registerPageViewer(): { close: () => Promise<void> } {
  const viewer = createPageViewer();
  setPageViewer(viewer.view);
  return {
    close: async () => {
      setPageViewer(undefined);
      await viewer.close();
    },
  };
}
