/**
 * Embedded-JSON recovery — a SECOND static tier, tried only when Readability
 * comes back thin/empty (see extract.ts). Many SPAs (Next.js, Nuxt) ship
 * their full page data as a JSON blob embedded in the HTML even though the
 * rendered DOM is an empty shell (the framework hydrates client-side).
 * Pulling obvious title/description/body-text-shaped strings out of that
 * blob recovers real content without a browser.
 *
 * This is HEURISTIC and BEST-EFFORT by design:
 *  - `__NEXT_DATA__` and `__NUXT__` have no fixed schema — every app nests
 *    its page props differently, so there is no "correct" JSON path to read.
 *  - The recovery walk is a shallow, generic scan for string-valued fields
 *    whose KEY NAME looks like title/description/content/body (case
 *    -insensitive, common aliases), preferring the first non-trivial match
 *    at each shallower depth over a technically-deeper "more specific" one.
 *  - It will sometimes recover the wrong string (e.g. a nav label named
 *    `title`) or miss real content nested under an unrecognized key. That
 *    is an accepted tradeoff for a zero-network, zero-render fallback —
 *    silo classifies the result as `partial` unless it clears the same
 *    `full` bar as Readability text, so a bad recovery cannot masquerade
 *    as a complete capture.
 */

import type { JSDOM } from 'jsdom';
import { FULL_TEXT_THRESHOLD } from './extract-constants.js';

export interface EmbeddedJsonResult {
  title?: string;
  description?: string;
  text?: string;
  /** Which embedded blob supplied the recovery, for debugging/observability. */
  source: 'next-data' | 'nuxt';
}

const TITLE_KEYS = new Set(['title', 'headline', 'pagetitle', 'name']);
const DESCRIPTION_KEYS = new Set(['description', 'summary', 'excerpt', 'metadescription']);
// Deliberately does NOT include `html` — a field literally named `html` (a
// common Next.js/Nuxt page-props key for a rendered HTML fragment, e.g.
// `pageProps.post.html`) would be accepted verbatim with no tag-stripping or
// entity-decoding, letting raw markup leak into `ExtractResult.text` (which
// every other source — Readability's `normalizeWhitespace`d output — treats
// as plain prose). Only genuinely plain-text-shaped keys are accepted here.
const BODY_KEYS = new Set(['body', 'content', 'bodytext', 'articlebody', 'text']);

const MAX_WALK_DEPTH = 6;
/**
 * Guards against pathological/huge blobs turning the walk into unbounded
 * work. Counts EVERY entry inspected (each key/value pair at any depth, not
 * just each object/array node entered) — a single wide flat array/object
 * with millions of primitive-valued entries at one depth is just as
 * expensive to scan as many small nested objects, so the cap must bound
 * total entries visited, not merely recursive calls made.
 */
const MAX_NODES_VISITED = 20_000;

interface WalkAccumulator {
  title?: string;
  description?: string;
  text?: string;
  visited: number;
}

function isNonTrivialString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFullyPopulated(acc: WalkAccumulator): boolean {
  return acc.title !== undefined && acc.description !== undefined && acc.text !== undefined;
}

/**
 * Try to accept a single string-valued field into the accumulator based on
 * its (lowercased) key name. First-shallow-match-wins per field (never
 * overwrites an already-populated slot) — see `walk`'s doc comment.
 */
function tryAcceptStringField(normalizedKey: string, value: string, acc: WalkAccumulator): void {
  const trimmed = value.trim();
  if (acc.title === undefined && TITLE_KEYS.has(normalizedKey)) {
    acc.title = trimmed;
    return;
  }
  if (acc.description === undefined && DESCRIPTION_KEYS.has(normalizedKey)) {
    acc.description = trimmed;
    return;
  }
  // Only accept a body-shaped field once it looks like real prose (short
  // strings named "content" are usually UI labels, not text) — reuses the
  // same bar extract.ts uses to call text "full", since a recovered string
  // that wouldn't clear that bar isn't worth accepting as body text either.
  if (
    acc.text === undefined &&
    BODY_KEYS.has(normalizedKey) &&
    trimmed.length >= FULL_TEXT_THRESHOLD
  ) {
    acc.text = trimmed;
  }
}

/**
 * Shallow-first walk: a match found at a shallower depth is kept over one
 * found deeper, since top-level page-props are more likely to be the "real"
 * title/description than a coincidentally-named field nested in, say, a
 * related-articles list.
 */
function walk(node: unknown, depth: number, acc: WalkAccumulator): void {
  if (depth > MAX_WALK_DEPTH) {
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }

  const entries = Array.isArray(node) ? node.entries() : Object.entries(node);
  for (const [key, value] of entries) {
    // Counted per ENTRY examined (not once per `walk()` call) — a single
    // wide flat array/object at one depth is just as expensive to scan as
    // many small nested objects, so the cap must bound total entries
    // visited across the whole traversal, not merely recursive calls made.
    acc.visited += 1;
    if (acc.visited > MAX_NODES_VISITED) {
      return;
    }

    if (isNonTrivialString(value)) {
      tryAcceptStringField(String(key).toLowerCase(), value, acc);
    } else if (value !== null && typeof value === 'object') {
      walk(value, depth + 1, acc);
    }

    if (isFullyPopulated(acc)) {
      return;
    }
  }
}

function recoverFromJson(
  json: unknown,
  source: EmbeddedJsonResult['source'],
): EmbeddedJsonResult | undefined {
  const acc: WalkAccumulator = { visited: 0 };
  walk(json, 0, acc);
  if (acc.title === undefined && acc.description === undefined && acc.text === undefined) {
    return undefined;
  }
  const result: EmbeddedJsonResult = { source };
  if (acc.title !== undefined) result.title = acc.title;
  if (acc.description !== undefined) result.description = acc.description;
  if (acc.text !== undefined) result.text = acc.text;
  return result;
}

/**
 * `<script id="__NEXT_DATA__" type="application/json">{...}</script>` —
 * Next.js embeds the full serialized page props here. Standard, well-formed
 * JSON; parse directly.
 */
function extractNextData(document: Document): EmbeddedJsonResult | undefined {
  const script = document.getElementById('__NEXT_DATA__');
  const raw = script?.textContent;
  if (!raw) return undefined;

  try {
    const json: unknown = JSON.parse(raw);
    return recoverFromJson(json, 'next-data');
  } catch {
    // Malformed/truncated blob — best-effort, so silently give up.
    return undefined;
  }
}

/**
 * `window.__NUXT__={...}` — Nuxt embeds state as a JS assignment (not
 * necessarily strict JSON: it may contain bare identifiers like
 * `undefined`), typically inside an inline `<script>` with no `id`. Find a
 * script whose text contains the assignment and try to isolate + parse the
 * object literal. Best-effort: many real Nuxt payloads use function-call
 * forms (`window.__NUXT__=(function(...){...})(...)`) that are not valid
 * JSON at all — those are left unrecovered rather than eval'd (this module
 * never executes untrusted script content).
 */
function extractNuxtData(document: Document): EmbeddedJsonResult | undefined {
  const scripts = Array.from(document.querySelectorAll('script'));
  for (const script of scripts) {
    const raw = script.textContent;
    if (!raw?.includes('__NUXT__')) continue;

    const match = raw.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match?.[1]) continue;

    try {
      const json: unknown = JSON.parse(match[1]);
      const result = recoverFromJson(json, 'nuxt');
      if (result) return result;
    } catch {
      // Not strict JSON (e.g. an IIFE or bare identifiers) — skip, best-effort.
    }
  }
  return undefined;
}

/**
 * Try `__NEXT_DATA__` first, then `__NUXT__`. Returns `undefined` if neither
 * framework's blob is present or nothing string-shaped was recoverable.
 */
export function recoverEmbeddedJson(dom: JSDOM): EmbeddedJsonResult | undefined {
  const { document } = dom.window;
  return extractNextData(document) ?? extractNuxtData(document);
}
