/** Static metadata stays available when isolated Reader extraction fails or times out. */
import type { ReaderContent } from '@silo/core';
import metascraper from 'metascraper';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';
import metascraperLogo from 'metascraper-logo';
import metascraperPublisher from 'metascraper-publisher';
import metascraperTitle from 'metascraper-title';
import metascraperUrl from 'metascraper-url';
import { FULL_TEXT_THRESHOLD } from './extract-constants.js';
import { extractPage } from './reader-worker.js';

// PRIVACY: deliberately does NOT include `metascraper-logo-favicon` — it
// performs a third-party favicon fetch per row, which violates silo's
// no-third-party-calls-per-row rule (CLAUDE.md "Design fidelity"). Only
// metadata derivable from the HTML we already have is used.
const scraper = metascraper([
  metascraperTitle(),
  metascraperDescription(),
  metascraperImage(),
  metascraperLogo(),
  metascraperPublisher(),
  metascraperUrl(),
]);

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

/**
 * SPA/JS-wall markers checked against the raw HTML: an empty root/app mount
 * point, or a `<noscript>` telling the user to enable JavaScript. Either is
 * strong evidence the server sent a shell and the real content only exists
 * after client-side rendering — exactly the case static extraction cannot
 * recover text for (short of embedded-JSON, tier 3).
 */
// Linear-time by construction (CodeQL js/polynomial-redos): the prefix before
// `id=` matches either one non-quote/non-`>` char OR a fully-quoted "..."/'...'
// string as a single alternative, so any given stretch of input can only be
// consumed one way — no ambiguity for the backtracker to explore, unlike the
// original `[^>]*...[^>]*` (which let both sides claim the same characters).
const SPA_ROOT_MARKER =
  /<div\b(?:[^>"']|"[^"]*"|'[^']*')*?\bid=["'](?:root|app)["'][^>]*>\s*<\/div>/i;
// `<noscript>` blocks are short and never nested, so instead of one regex
// spanning the whole tag with two lazy `[\s\S]*?` gaps (the ReDoS-prone
// shape), split the check: enumerate every `<noscript ...>...</noscript>`
// block with a bounded, single-purpose regex, then test each block's
// (typically tiny) contents separately for the "enable javascript" phrase.
// The `g` flag + matchAll is load-bearing: a page can carry multiple
// noscript blocks (the standard Google-Tag-Manager install puts a GTM
// `<noscript><iframe .../></noscript>` BEFORE the app-shell's enable-JS one),
// and the original `[\s\S]*?` regex scanned across block boundaries, so it
// matched the phrase in ANY block. Inspecting only the first block would
// miss the GTM-first ordering (a real SPA wall) — so we scan them all.
const NOSCRIPT_BLOCK = /<noscript\b[^>]*>([^<]*(?:<(?!\/noscript>)[^<]*)*)<\/noscript>/gi;
const ENABLE_JS_PHRASE = /enable\s+javascript/i;

export type CaptureStatus = 'full' | 'partial' | 'bare';

export interface ExtractResult {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  text?: string;
  status: CaptureStatus;
  reader?: ReaderContent;
}

export interface ExtractInput {
  url: string;
  html: string;
  contentType: string | undefined;
}

/** `text/html; charset=utf-8` -> `text/html`. Compares case-insensitively. */
function isHtmlContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    // No Content-Type header at all — proceed and let extraction try; a
    // missing header is common enough (some servers omit it) that treating
    // it as an instant `bare` would under-capture real HTML pages.
    return true;
  }
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase();
  return mimeType !== undefined && HTML_CONTENT_TYPES.includes(mimeType);
}

type MetascraperFields = Omit<ExtractResult, 'status' | 'text' | 'reader'>;

/**
 * Run metascraper and map its fields onto ExtractResult's naming
 * (image -> imageUrl). siteName fallback: prefer `publisher`; when absent,
 * fall back to `logo`'s hostname-bearing form is not reliable (logo is an
 * image URL, not a name), so instead fall back to the URL's own hostname
 * (stripping a leading `www.`) — always available, always a reasonable
 * human-readable site label even when the page ships no publisher/og:
 * site_name meta at all.
 */
async function runMetascraper(url: string, html: string): Promise<MetascraperFields> {
  const metadata = await scraper({ url, html });
  const fields: MetascraperFields = {};
  if (metadata.title) fields.title = metadata.title;
  if (metadata.description) fields.description = metadata.description;
  if (metadata.image) fields.imageUrl = metadata.image;

  if (metadata.publisher) {
    fields.siteName = metadata.publisher;
  } else {
    const hostnameFallback = hostnameOf(url);
    if (hostnameFallback) fields.siteName = hostnameFallback;
  }

  return fields;
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** SPA/JS-wall heuristic over the raw HTML string (cheap, no DOM needed). */
function hasSpaWallMarkers(html: string): boolean {
  if (SPA_ROOT_MARKER.test(html)) return true;
  // Test every `<noscript>` block, not just the first — see NOSCRIPT_BLOCK.
  for (const match of html.matchAll(NOSCRIPT_BLOCK)) {
    if (ENABLE_JS_PHRASE.test(match[1] ?? '')) return true;
  }
  return false;
}

function hasUsableMetadata(fields: MetascraperFields): boolean {
  return fields.title !== undefined || fields.description !== undefined;
}

/**
 * Classify capture status (R10):
 *  - `full`  — readable text clears FULL_TEXT_THRESHOLD (a genuine article
 *              capture), regardless of metadata completeness.
 *  - `partial` — some signal exists (metadata and/or thin text) but not
 *              enough to call it a full capture; also the explicit route for
 *              JS-walled pages (SPA markers) that only yielded metadata.
 *  - `bare`  — neither usable metadata nor any text at all.
 */
function classify(fields: MetascraperFields, text: string | undefined): CaptureStatus {
  const textLength = text?.length ?? 0;
  if (textLength >= FULL_TEXT_THRESHOLD) {
    return 'full';
  }
  if (hasUsableMetadata(fields) || textLength > 0) {
    return 'partial';
  }
  return 'bare';
}

function buildResult(fields: MetascraperFields, text: string | undefined): ExtractResult {
  const status = classify(fields, text);
  const result: ExtractResult = { status };
  if (fields.title !== undefined) result.title = fields.title;
  if (fields.description !== undefined) result.description = fields.description;
  if (fields.imageUrl !== undefined) result.imageUrl = fields.imageUrl;
  if (fields.siteName !== undefined) result.siteName = fields.siteName;
  if (text !== undefined) result.text = text;
  return result;
}

/**
 * JS-wall heuristic: when text is still thin AND no usable metadata was
 * found AND the raw HTML shows SPA-shell markers, that's a strong signal of
 * a JS-walled page — classify explicitly as `partial` even though
 * `classify()` alone would otherwise call an all-empty result `bare`. This
 * only affects the metadata-absent case: `classify()` already treats any
 * usable metadata as partial-or-better on its own.
 */
function isJsWalled(fields: MetascraperFields, text: string | undefined, html: string): boolean {
  return (
    (text?.length ?? 0) < FULL_TEXT_THRESHOLD &&
    !hasUsableMetadata(fields) &&
    hasSpaWallMarkers(html)
  );
}

export async function extract(input: ExtractInput): Promise<ExtractResult> {
  const { url, html, contentType } = input;

  // Guard the "never throws" contract: `new JSDOM(html, { url })` and
  // metascraper both throw on an unparseable `url`. The real caller (U5) feeds
  // safeFetch's already-validated finalUrl, so this is defense in depth — an
  // invalid URL degrades to `bare` rather than throwing.
  if (hostnameOf(url) === undefined) {
    return { status: 'bare' };
  }

  if (!isHtmlContentType(contentType)) {
    // Non-HTML content-type (PDF, JSON, image, ...) — do not attempt to
    // parse it as HTML at all (R10).
    return { status: 'bare' };
  }

  // Metadata survives a parser error or hard timeout. No publisher URLs are fetched.
  const fields = await runMetascraper(url, html);
  try {
    const page = await extractPage(
      html,
      url,
      fields.description ? { description: fields.description } : {},
    );
    if (fields.title === undefined && page.title) fields.title = page.title;
    if (fields.description === undefined && page.description) fields.description = page.description;
    const result = buildResult(fields, page.text);
    if (page.videoDescription) result.status = 'partial';
    if (page.reader) result.reader = page.reader;
    if (result.status === 'bare' && isJsWalled(fields, page.text, html)) result.status = 'partial';
    return result;
  } catch (error) {
    console.warn(
      '[reader] extraction unavailable',
      error instanceof Error ? error.message : 'reader-failed',
    );
    return buildResult(fields, undefined);
  }
}
