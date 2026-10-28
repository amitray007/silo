import {
  addViewScrollScript,
  type FrameHint,
  type PageViewer,
  PageViewerUnavailableError,
  setPageViewer,
} from '@silo/core';
import { HTML_ACCEPT, type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';
import { PageCache } from './cache.js';
import { addDarkPageStyle } from './dark-theme.js';
import { ViewLimit } from './limit.js';
import { allowsFraming } from './policy.js';
import { TransformPool } from './pool.js';
import type { StyledPage } from './stylesheets.js';
import { pageTextLength } from './text.js';

type Page = {
  finalUrl: string;
  contentType?: string;
  xFrameOptions?: string;
  contentSecurityPolicy?: string;
  html?: Buffer;
  reason?: string;
  textLength?: number;
  cssDarkTheme?: boolean;
  scriptDarkTheme?: boolean;
};
type Pending = { controller: AbortController; promise: Promise<Page>; users: number };
type ViewerOptions = {
  fetch?: (url: string, signal: AbortSignal) => Promise<SafeFetchResult>;
  transform?: (html: string, finalUrl: string, signal: AbortSignal) => Promise<StyledPage>;
  cacheBytes?: number;
  ttlMs?: number;
  waitMs?: number;
};

function hintFor(page: Page, origin: string): FrameHint {
  const contentType = page.contentType ? { contentType: page.contentType } : {};
  const mime = page.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  const displayable =
    page.html ||
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/pdf' ||
    mime === 'text/plain' ||
    mime.startsWith('image/');
  if (!displayable)
    return { mode: 'none', reason: page.reason ?? 'unsupported-content', ...contentType };
  const theme = page.cssDarkTheme === undefined ? {} : { darkTheme: page.cssDarkTheme };
  const directTheme =
    page.cssDarkTheme === undefined
      ? {}
      : { darkTheme: page.cssDarkTheme || page.scriptDarkTheme === true };
  if (allowsFraming(page, page.finalUrl, origin))
    return { mode: 'direct', ...contentType, ...directTheme };
  if (page.reason) return { mode: 'none', reason: page.reason, ...contentType };
  if (page.html && (page.textLength ?? 0) < 200)
    return { mode: 'none', reason: 'needs-script', ...contentType };
  return page.html
    ? { mode: 'view', reason: 'framing-blocked', ...contentType, ...theme }
    : { mode: 'none', reason: 'non-html-framing-blocked', ...contentType };
}

function preparePage({
  html,
  cssDarkTheme,
  scriptDarkTheme,
}: StyledPage): Pick<Page, 'html' | 'textLength' | 'cssDarkTheme' | 'scriptDarkTheme'> {
  return {
    cssDarkTheme,
    scriptDarkTheme,
    html: Buffer.from(addViewScrollScript(cssDarkTheme ? html : addDarkPageStyle(html))),
    textLength: pageTextLength(html),
  };
}

/** One cache/fetch shared by /frame and /view. Policy is evaluated per caller origin. */
export function createPageViewer(options: ViewerOptions = {}): {
  view: PageViewer;
  close: () => Promise<void>;
} {
  const pool = new TransformPool();
  const transform = options.transform ?? ((html, url, signal) => pool.run(html, url, signal));
  const fetchPage =
    options.fetch ?? ((url, signal) => safeFetch(url, { accept: HTML_ACCEPT, signal }));
  const cache = new PageCache<Page>(options.cacheBytes, options.ttlMs);
  const limit = new ViewLimit(options.waitMs);
  const refreshed = new Map<string, number>();
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
          const html = await transform(fetched.html, finalUrl, signal);
          Object.assign(page, preparePage(html));
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

  function bypassCache(key: string, fresh = false): boolean {
    const now = Date.now();
    for (const [key, time] of refreshed) if (now - time >= 5_000) refreshed.delete(key);
    if (!fresh || refreshed.has(key)) return false;
    if (refreshed.size >= 1_024) throw new PageViewerUnavailableError();
    refreshed.set(key, now);
    return true;
  }

  const view: PageViewer = async ({ id, url, origin, signal, fresh }) => {
    signal.throwIfAborted();
    const key = `${id}:${url}`;
    const bypass = bypassCache(id, fresh);
    const cached = bypass ? undefined : cache.get(key);
    const existing = pending.get(key);
    const entry = existing && !existing.controller.signal.aborted ? existing : undefined;
    const page = entry
      ? await subscribe(entry, signal)
      : (cached ?? (await subscribe(start(key, url), signal)));
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
