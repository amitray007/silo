import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { BrowserContextOptions } from 'playwright-core';
import { prepareBoxSpacing } from '../extract/box-spacing.js';
import { isChallengePage } from '../extract/challenge-page.js';
import { prepareCodeEditors, restoreCodeEditors } from '../extract/code-editors.js';
import type { PageContent } from '../extract/reader-page.js';
import { sanitizeRenderedPage } from '../extract/reader-worker.js';
import { prepareCodeLanguages, prepareGists } from '../extract/rich-blocks.js';
import { FETCH_ACCEPT_LANGUAGE } from '../fetch/safe-fetch.js';
import { closeWithin } from './cleanup.js';
import { BROWSER_USER_AGENT } from './profile.js';
import { type BrowserFetch, BrowserRoutes, type RoutePort } from './route.js';

export interface PagePort {
  on(event: 'pageerror', listener: (error: Error) => void): unknown;
  on(event: 'console', listener: (message: { type(): string; text(): string }) => void): unknown;
  goto(url: string, options: { waitUntil: 'domcontentloaded' }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
}
export interface ContextPort {
  route(pattern: string, handler: (route: RoutePort) => Promise<void>): Promise<unknown>;
  routeWebSocket(pattern: string, handler: (socket: { close(): void }) => void): Promise<unknown>;
  newPage(): Promise<PagePort>;
  on(event: 'page', listener: (page: { close(): Promise<void> }) => void): unknown;
  close(): Promise<void>;
}
export interface BrowserPort {
  newContext(options: BrowserContextOptions): Promise<ContextPort>;
  isConnected(): boolean;
  on(event: 'disconnected', listener: () => void): unknown;
  close(): Promise<void>;
}

const require = createRequire(import.meta.url);
// Read once per worker process, never once per page. The full bundle converts TeX to
// MathML (temml), as the Node build does; the core bundle leaves raw TeX as text.
const DEFUDDLE = readFileSync(join(dirname(require.resolve('defuddle')), 'index.full.js'), 'utf8');
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
const CONTEXT_OPTIONS: BrowserContextOptions = {
  javaScriptEnabled: true,
  serviceWorkers: 'block',
  acceptDownloads: false,
  bypassCSP: false,
  locale: 'en-US',
  extraHTTPHeaders: { 'accept-language': FETCH_ACCEPT_LANGUAGE },
  viewport: { width: 1280, height: 900 },
  userAgent: BROWSER_USER_AGENT,
};

/**
 * Functions sent into the page as source keep whatever helpers the TypeScript loader
 * added. tsx (production) wraps named inner functions in `__name(fn, "name")`, which
 * does not exist in the page, so every page script defines it first.
 */
export const PAGE_PRELUDE = 'var __name = (target) => target;';

// A string keeps this code independent of transpiler helpers in Node's TypeScript loader.
const EXTRACT = String.raw`(() => {
  ${PAGE_PRELUDE}
  const codeEditors = (${prepareCodeEditors.toString()})(document, true);
  (${prepareGists.toString()})(document);
  (${prepareCodeLanguages.toString()})(document);
  // Match Defuddle 0.19.6's small-image rule without broken-image layout sizes.
  // Unloaded images have only the same declared dimensions as the static path.
  for (const element of document.querySelectorAll('img, svg')) {
    const isImage = element.tagName.toLowerCase() === 'img';
    if (isImage && (/\\[a-zA-Z]{2,}/.test(element.getAttribute('alt') || '') ||
        element.classList.contains('latex') || element.classList.contains('tex') ||
        element.getAttribute('data-latex') || element.getAttribute('data-math'))) continue;
    const style = element.getAttribute('style') || '';
    const widths = [parseInt(element.getAttribute('width') || '0'),
      parseInt(style.match(/width\s*:\s*(\d+)/)?.[1] || '0')];
    const heights = [parseInt(element.getAttribute('height') || '0'),
      parseInt(style.match(/height\s*:\s*(\d+)/)?.[1] || '0')];
    if (!isImage) {
      const parts = (element.getAttribute('viewBox') || '').split(/[\s,]+/);
      if (parts.length === 4) {
        widths.push(parseFloat(parts[2]) || 0);
        heights.push(parseFloat(parts[3]) || 0);
      }
    }
    if (!isImage || element.naturalWidth > 0) {
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      widths.push(element.naturalWidth || 0, parseInt(computed.width) || box.width);
      heights.push(element.naturalHeight || 0, parseInt(computed.height) || box.height);
    }
    const positiveWidths = widths.filter(value => value > 0);
    const positiveHeights = heights.filter(value => value > 0);
    if (!positiveWidths.length && !positiveHeights.length && isImage) {
      const oneX = (element.getAttribute('srcset') || '').match(/(\S+)\s+1x/);
      const hint = oneX?.[1].match(/(?:width[=:/]|[/,?&]w[_:=])(\d+)/);
      const width = parseInt(hint?.[1] || '0');
      if (width > 0) positiveWidths.push(width);
    }
    if (Math.min(...positiveWidths) < 33 || Math.min(...positiveHeights) < 33)
      element.remove();
  }
  const images = [...document.querySelectorAll('img')];
  const unloaded = images.filter(image => image.naturalWidth === 0);
  const alts = unloaded.map(image => image.getAttribute('alt'));
  for (const image of unloaded) image.setAttribute('alt', '');
  // Read every box before writing dimensions, to avoid one layout per image.
  const sizes = images.map(image => {
    const box = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    const visible = style.visibility !== 'hidden' && style.display !== 'none' &&
      Number(style.opacity) !== 0;
    return { box, visible };
  });
  images.forEach((image, index) => {
    const { box, visible } = sizes[index];
    const unloaded = image.naturalWidth === 0;
    if (unloaded && (image.hasAttribute('width') || (box.width === 16 && box.height === 16)))
      return;
    if (visible && box.width > 0 && (unloaded || (box.height > 0 &&
        (box.width < image.naturalWidth || box.height < image.naturalHeight)))) {
      image.setAttribute('width', String(Math.max(1, Math.round(box.width))));
      if (box.height > 0 && (!unloaded || !image.hasAttribute('height')))
        image.setAttribute('height', String(Math.max(1, Math.round(box.height))));
    }
  });
  unloaded.forEach((image, index) => {
    if (alts[index] === null) image.removeAttribute('alt');
    else image.setAttribute('alt', alts[index]);
  });
  (${prepareBoxSpacing.toString()})(document, true);
  const { content, wordCount } = new Defuddle(document, {
    useAsync: false, removeSmallImages: false,
  }).parse();
  if (typeof content !== 'string' || content.length > ${MAX_CONTENT_BYTES} ||
      new TextEncoder().encode(content).byteLength > ${MAX_CONTENT_BYTES}) return null;
  const restored = document.createElement('div');
  restored.innerHTML = content;
  (${restoreCodeEditors.toString()})(restored, codeEditors);
  return { content: restored.innerHTML, wordCount: typeof wordCount === 'number' ? wordCount : 0 };
})()`;

function sanitizeResult(value: unknown, url: string, signal: AbortSignal): Promise<PageContent> {
  if (!value || typeof value !== 'object' || !('content' in value))
    throw new Error('browser-content-limit');
  const content = value.content;
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_CONTENT_BYTES)
    throw new Error('browser-content-limit');
  return sanitizeRenderedPage(content, url, signal);
}

export interface RenderDiagnostics {
  routes?: ReturnType<BrowserRoutes['stats']>;
  timings: { gotoMs: number; settleMs: number; extractMs: number };
  errors: string[];
  bodyTextLength: number;
  contentLength: number;
}

export function diagnosticMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
      try {
        const url = new URL(value);
        return url.host + url.pathname.slice(0, 80);
      } catch {
        return '[url]';
      }
    })
    .slice(0, 200);
}

/** Every context, including one that resolves after cancellation, is closed here. */
export async function renderPage(
  browser: BrowserPort,
  url: string,
  signal: AbortSignal,
  fetch?: BrowserFetch,
  diagnostics: RenderDiagnostics = {
    timings: { gotoMs: 0, settleMs: 0, extractMs: 0 },
    errors: [],
    bodyTextLength: 0,
    contentLength: 0,
  },
): Promise<PageContent & { diagnostics: RenderDiagnostics }> {
  const context = await browser.newContext(CONTEXT_OPTIONS);
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= closeWithin(() => context.close()));
  signal.addEventListener('abort', close, { once: true });
  const routes = new BrowserRoutes(signal, fetch);
  try {
    signal.throwIfAborted();
    await context.route('**/*', routes.handle);
    // HTTP routes do not intercept WebSocket handshakes.
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    const record = (message: string) => {
      if (diagnostics.errors.length < 3) diagnostics.errors.push(diagnosticMessage(message));
    };
    page.on('pageerror', (error) => record(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') record(message.text());
    });
    // A publisher must not create extra rendering slots through popups.
    context.on('page', (popup) => {
      void popup.close().catch(() => {});
    });
    let started = Date.now();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } finally {
      diagnostics.timings.gotoMs = Date.now() - started;
    }
    started = Date.now();
    await routes.settle();
    diagnostics.timings.settleMs = Date.now() - started;
    signal.throwIfAborted();
    const challenge = await page.evaluate(
      `${PAGE_PRELUDE}(${isChallengePage.toString()})(document)`,
    );
    if (challenge) throw new Error('browser-challenge');
    // UMD must publish its browser global even on sites with AMD/CommonJS globals.
    await page.evaluate(`(function(module, exports, define) { ${DEFUDDLE}\n}).call(window);`);
    diagnostics.bodyTextLength = Number(
      await page.evaluate('document.body?.innerText.length ?? 0'),
    );
    started = Date.now();
    let result: unknown;
    try {
      result = await page.evaluate(EXTRACT);
    } finally {
      diagnostics.timings.extractMs = Date.now() - started;
    }
    diagnostics.contentLength =
      result &&
      typeof result === 'object' &&
      'content' in result &&
      typeof result.content === 'string'
        ? result.content.length
        : 0;
    signal.throwIfAborted();
    return { ...(await sanitizeResult(result, url, signal)), diagnostics };
  } finally {
    diagnostics.routes = routes.stats();
    signal.removeEventListener('abort', close);
    await close();
  }
}
