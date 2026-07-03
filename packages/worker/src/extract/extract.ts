/**
 * Static-first extraction — given already-fetched, already-decoded HTML,
 * produce structured metadata + readable text + a capture-status
 * classification, WITHOUT a browser (see
 * docs/plans/2026-07-04-002-feat-enrichment-worker-plan.md, U3 + R7/R8/R9/R10
 * + the "Capture status mapping" diagram).
 *
 * Three static tiers, tried in preference order (metascraper and Readability
 * actually run concurrently — see `extract()` — since neither depends on the
 * other's output; embedded-json is a conditional third pass, only run when
 * Readability's text comes back thin):
 *  1. metascraper — reads the OG/Twitter-card/JSON-LD/meta tags publishers
 *     already ship for link unfurls (title/description/image/siteName).
 *  2. Readability (over a script-disabled jsdom DOM) — the readable article
 *     text, for pages with real server-rendered prose.
 *  3. embedded-json — when Readability text is thin/absent, a best-effort
 *     recovery from `__NEXT_DATA__` / `__NUXT__` blobs (see
 *     embedded-json.ts), squeezing more from SPAs without rendering.
 *
 * SECURITY: the jsdom document is constructed with scripts and remote
 * resources DISABLED (the default — `runScripts` / `resources` are never
 * set). Untrusted, attacker-influenced HTML must never execute in this
 * process; see the "inert scripts" test in extract.test.ts.
 *
 * Charset: the `html` string passed in is already decoded by U2's
 * `safeFetch` (per `Content-Type` charset, else UTF-8) — this module does
 * NOT re-decode. Non-UTF-8 `<meta charset>`-only bodies are a documented,
 * deferred limitation (see the plan's Scope Boundaries).
 */

import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import metascraper from 'metascraper';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';
import metascraperLogo from 'metascraper-logo';
import metascraperPublisher from 'metascraper-publisher';
import metascraperTitle from 'metascraper-title';
import metascraperUrl from 'metascraper-url';
import { recoverEmbeddedJson } from './embedded-json.js';
import { FULL_TEXT_THRESHOLD } from './extract-constants.js';

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
const SPA_ROOT_MARKER = /<div[^>]*\bid=["'](root|app)["'][^>]*>\s*<\/div>/i;
const NOSCRIPT_ENABLE_JS_MARKER = /<noscript>[\s\S]*?enable\s+javascript[\s\S]*?<\/noscript>/i;

export type CaptureStatus = 'full' | 'partial' | 'bare';

export interface ExtractResult {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  text?: string;
  status: CaptureStatus;
}

export interface ExtractInput {
  url: string;
  html: string;
  contentType: string | undefined;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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

type MetascraperFields = Omit<ExtractResult, 'status' | 'text'>;

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

/**
 * Run Readability over a script-and-remote-resource-disabled jsdom DOM.
 * Returns the trimmed/normalized text (or undefined if Readability found
 * nothing / the DOM is not "readerable"), plus the DOM itself (reused by the
 * embedded-JSON tier so the HTML is only parsed once).
 */
function extractReadableText(url: string, html: string): { dom: JSDOM; text: string | undefined } {
  // No `runScripts` / `resources` option set — this is jsdom's default and
  // means embedded <script> tags are parsed into the DOM but NEVER
  // executed, and no remote resource (image, stylesheet, subresource
  // script) is fetched. This is load-bearing: `html` is untrusted,
  // attacker-influenced content.
  const dom = new JSDOM(html, { url });

  if (!isProbablyReaderable(dom.window.document)) {
    return { dom, text: undefined };
  }

  const article = new Readability(dom.window.document).parse();
  const rawText = article?.textContent;
  const text = rawText ? normalizeWhitespace(rawText) : undefined;
  return { dom, text: text && text.length > 0 ? text : undefined };
}

/** SPA/JS-wall heuristic over the raw HTML string (cheap, no DOM needed). */
function hasSpaWallMarkers(html: string): boolean {
  return SPA_ROOT_MARKER.test(html) || NOSCRIPT_ENABLE_JS_MARKER.test(html);
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
 * Tier 3: when Readability text is thin/absent, try to recover more from an
 * embedded `__NEXT_DATA__`/`__NUXT__` blob, and fold any recovered fields
 * into `fields`/`text` without clobbering what metascraper/Readability
 * already found (first-good-source-wins).
 */
function applyEmbeddedJsonRecovery(
  dom: JSDOM,
  fields: MetascraperFields,
  text: string | undefined,
): string | undefined {
  const recovered = recoverEmbeddedJson(dom);
  if (!recovered) {
    return text;
  }
  if ((recovered.text?.length ?? 0) > (text?.length ?? 0)) {
    text = recovered.text;
  }
  if (fields.title === undefined && recovered.title !== undefined) {
    fields.title = recovered.title;
  }
  if (fields.description === undefined && recovered.description !== undefined) {
    fields.description = recovered.description;
  }
  return text;
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

/**
 * Extract structured metadata + readable text from already-fetched HTML, and
 * classify the result's capture status. Never throws for malformed/hostile
 * HTML — jsdom and Readability are both defensive parsers, and metascraper's
 * rules degrade to `undefined` fields rather than throwing; any genuinely
 * unexpected error here is a real defect, not an "expected" degraded case.
 */
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

  // `extractReadableText` is synchronous CPU work (jsdom parse + Readability),
  // not I/O — running it before awaiting `runMetascraper` (rather than
  // wrapping it in `Promise.all`) is the honest shape: there is no real
  // concurrency to buy here, since JS is single-threaded and the parse must
  // complete before this function can do anything else regardless.
  const { dom, text: readableText } = extractReadableText(url, html);
  const fields = await runMetascraper(url, html);

  let text = readableText;
  if ((text?.length ?? 0) < FULL_TEXT_THRESHOLD) {
    text = applyEmbeddedJsonRecovery(dom, fields, text);
  }

  const result = buildResult(fields, text);
  // A JS-walled shell with no usable metadata would otherwise classify as
  // `bare`; the SPA markers are evidence there IS content (just client-rendered
  // and unreachable statically), so force `partial` — but keep every field that
  // WAS extracted (e.g. an og:image / og:site_name present on the shell) rather
  // than dropping them.
  if (result.status === 'bare' && isJsWalled(fields, text, html)) {
    result.status = 'partial';
  }
  return result;
}
