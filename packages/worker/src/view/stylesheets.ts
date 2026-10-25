import { JSDOM, VirtualConsole } from 'jsdom';
import { type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';
import { resolveCss, sanitizePageDom } from './transform.js';

const MAX_SHEETS = 15;
const MAX_BYTES = 3 * 1024 * 1024;
const IMPORT =
  /@import\s+(?:url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]+))\s*\)|"([^"\n]*)"|'([^'\n]*)')\s*([^;{}]*);/gi;
type FetchCss = (url: string, signal: AbortSignal, maxBytes: number) => Promise<SafeFetchResult>;

function sheetUrl(raw: string, base: string): string | undefined {
  try {
    const url = new URL(raw, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Network and parsing run inside the transform thread's hard three-second deadline. */
export async function inlinePageStyles(
  html: string,
  finalUrl: string,
  fetchCss: FetchCss = (url, signal, maxBodyBytes) => safeFetch(url, { signal, maxBodyBytes }),
  signal = AbortSignal.timeout(1_500),
): Promise<string> {
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole: new VirtualConsole() });
  let sheets = 0;
  let bytes = 0;
  let active = 0;
  const waiters: (() => void)[] = [];

  async function fetchSheet(url: string): Promise<{ css: string; url: string } | undefined> {
    if (sheets >= MAX_SHEETS) return undefined;
    sheets++;
    if (active >= 3) await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
    try {
      if (signal.aborted || bytes >= MAX_BYTES) return undefined;
      const response = await fetchCss(url, signal, MAX_BYTES - bytes);
      if (!response.ok || response.contentType?.split(';')[0]?.trim().toLowerCase() !== 'text/css')
        return undefined;
      const size = Buffer.byteLength(response.html);
      if (bytes + size > MAX_BYTES) return undefined;
      bytes += size;
      return { css: response.html, url: response.finalUrl };
    } catch {
      return undefined;
    } finally {
      active--;
      waiters.shift()?.();
    }
  }

  async function expandImports(css: string, url: string): Promise<string> {
    const matches = Array.from(css.matchAll(IMPORT));
    const expanded = await Promise.all(
      matches.map(async (match) => {
        const target = sheetUrl(
          match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '',
          url,
        );
        const imported = target ? await fetchSheet(target) : undefined;
        if (!imported) return ''; // No unbounded browser-side import chain.
        const clean = resolveCss(imported.css, imported.url).replace(/@import[^;{}]*(?:;|$)/gi, '');
        const media = match[6]?.trim();
        return media ? `@media ${media}{${clean}}` : clean;
      }),
    );
    let index = 0;
    return css
      .replace(IMPORT, () => expanded[index++] ?? '')
      .replace(/@import[^;{}]*(?:;|$)/gi, '');
  }

  try {
    const document = dom.window.document;
    const links = Array.from(document.querySelectorAll('link[rel]')).filter((link) =>
      link.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet'),
    );
    // Reserve top-level fetches before imports; preserve DOM order despite parallel completion.
    const fetched = await Promise.all(
      links.map((link) => {
        const href = link.getAttribute('href');
        const url = href?.trim() ? sheetUrl(href, finalUrl) : undefined;
        return url ? fetchSheet(url) : undefined;
      }),
    );
    await Promise.all(
      links.map(async (link, index) => {
        const sheet = fetched[index];
        if (!sheet) return; // A failed fetch keeps the original link as a best-effort fallback.
        const style = document.createElement('style');
        // Stage as inert text: jsdom otherwise parses megabytes of CSS on each DOM mutation.
        style.setAttribute('type', 'text/silo-css');
        const media = link.getAttribute('media');
        if (media) style.setAttribute('media', media);
        style.textContent = resolveCss(
          await expandImports(resolveCss(sheet.css, sheet.url), sheet.url),
          sheet.url,
        );
        link.replaceWith(style);
      }),
    );
    // Only activate already URL-rewritten, CSS-filtered styles after final DOM sanitization.
    return sanitizePageDom(dom, finalUrl).replaceAll('<style type="text/silo-css"', '<style');
  } finally {
    dom.window.close();
  }
}
