import { getPreviewImageFields } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { withETag } from '../conditional-response.js';
import { allowedImageContentType, imageResponse } from '../image-response.js';
import { fetchImageSafely } from '../ssrf-safe-image-fetch.js';

/**
 * `GET /api/preview-image?linkId=` — the privacy-preserving preview-image
 * proxy (source-data/rich-previews slice, plan 012, item 6: "only on
 * deliberate hover — privacy-OK"). Serves a link's own captured `imageUrl`
 * (an og:image metascraper found, or a YouTube deterministic thumbnail URL
 * stored as `sourceData.thumbnailUrl`) so the BROWSER never calls a
 * third-party image host directly (CLAUDE.md "Design fidelity": "no
 * third-party calls per row") — mirrors `favicon.ts`'s identical
 * self-proxy rationale, generalized from a fixed Google host to an
 * arbitrary-but-link-owned host.
 *
 * SSRF safety — why this is safe despite the fetched host being arbitrary
 * (unlike `favicon.ts`, where the host is a hardcoded Google literal):
 *
 * 1. The ONLY input this route accepts is `linkId`, a UUID. It is used
 *    EXCLUSIVELY as a lookup key into `core.getPreviewImageFields` — never interpolated
 *    into a URL, never itself fetched. A client cannot make this route
 *    fetch an arbitrary URL of their choosing; they can only ask "show me
 *    THIS link's own image", and only for a link that already exists.
 * 2. The actual fetch target (`link.imageUrl`) is the SAME url the WORKER
 *    already captured for this link during enrichment (metascraper's
 *    `og:image` extraction, or the deterministic YouTube thumbnail URL
 *    derived from a validated video id) — not client-supplied, and not
 *    re-derivable by a client into a different host.
 * 3. Because `imageUrl` still names an ARBITRARY host (a malicious page's
 *    `og:image` could point anywhere, including an internal address, even
 *    though the page itself was fetched through the worker's SSRF gate),
 *    this route does NOT plain-`fetch()` it — it goes through
 *    `fetchImageSafely` (`../ssrf-safe-image-fetch.ts`), a dedicated,
 *    from-scratch SSRF gate for exactly this narrow case (DNS-resolve +
 *    classify every address + pin the connection to the classified address
 *    + no redirect-following + a byte cap + a timeout). See that module's
 *    doc comment for why it's a small local implementation rather than
 *    importing `@silo/worker`'s `safeFetch` (an architecture-boundary
 *    violation — adapters may not import the worker) or moving that whole
 *    module into `@silo/core` (a disproportionate refactor for this slice).
 *
 * Caching: mirrors `favicon.ts`'s bounded `Map<linkId, CacheEntry>` + TTL +
 * `Cache-Control` — same single-process-is-enough rationale (v1's deployment
 * shape is one local process). Failed fetches are remembered for an hour (a
 * second bounded map), and concurrent requests for one link are coalesced
 * into a single lookup + upstream fetch.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A failed upstream fetch is remembered this long (the same hour favicon.ts uses for a miss). */
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_MISS_ENTRIES = 1000;

type CacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  ts: number;
};

/**
 * What a lookup came to. `none`: the link has no preview image (or is unknown/trashed), a
 * single cheap query, never cached because enrichment can add an image any moment. `miss`: an
 * image URL exists but the upstream fetch failed or returned a non-image.
 */
type Outcome =
  | { kind: 'image'; bytes: Uint8Array; contentType: string }
  | { kind: 'none' }
  | { kind: 'miss' };

const cache = new Map<string, CacheEntry>();
/**
 * Failed fetches, by linkId. The upstream call can burn its whole 5 s timeout, and a card list
 * re-requests the same broken image on every mount. The entry stores the URL that failed, so a
 * link whose imageUrl changes (a re-capture) is retried at once.
 */
const misses = new Map<string, { target: string; ts: number }>();
/** Lookups already running, so N concurrent requests for one link share one query and one fetch. */
const inFlight = new Map<string, Promise<Outcome>>();

function cacheGet(linkId: string): CacheEntry | undefined {
  const entry = cache.get(linkId);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(linkId);
    return undefined;
  }
  return entry;
}

function evictOldestWhenFull<T>(map: Map<string, T>, limit: number, key: string): void {
  if (map.size >= limit && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
}

function cacheSet(linkId: string, entry: CacheEntry): void {
  evictOldestWhenFull(cache, MAX_CACHE_ENTRIES, linkId);
  cache.set(linkId, entry);
}

function recentlyMissed(linkId: string, target: string): boolean {
  const miss = misses.get(linkId);
  if (!miss) return false;
  if (Date.now() - miss.ts > MISS_TTL_MS) {
    misses.delete(linkId);
    return false;
  }
  return miss.target === target;
}

function rememberMiss(linkId: string, target: string): void {
  evictOldestWhenFull(misses, MAX_MISS_ENTRIES, linkId);
  misses.set(linkId, { target, ts: Date.now() });
}

/**
 * Looks the link up and fetches its image, filling the caches. `linkId` is used ONLY as a lookup
 * key (see the SSRF-safety doc comment above): a trashed or nonexistent link never serves an
 * image (live-scoped, same as every other read). The target is the SAME server-derived url the
 * WORKER already validated: a captured `imageUrl` (og:image) or the YouTube enricher's
 * `sourceData.thumbnailUrl`; neither is client input.
 */
async function resolveImage(linkId: string): Promise<Outcome> {
  const link = await getPreviewImageFields(linkId);
  // Prefer the captured `imageUrl` (an og:image); fall back to the YouTube enricher's
  // `sourceData.thumbnailUrl`. Only a non-empty string counts as a target.
  const target = link?.imageUrl ?? link?.thumbnailUrl;
  if (typeof target !== 'string' || target.length === 0) return { kind: 'none' };
  if (recentlyMissed(linkId, target)) return { kind: 'miss' };

  const result = await fetchImageSafely(target);
  // Only serve genuine image types (see ALLOWED_IMAGE_MIME_TYPES) — a non-image response from
  // an arbitrary imageUrl host is treated as no preview image, never forwarded from silo's origin.
  const contentType = result.ok ? allowedImageContentType(result.contentType) : undefined;
  if (!result.ok || !contentType) {
    rememberMiss(linkId, target);
    return { kind: 'miss' };
  }
  misses.delete(linkId);
  cacheSet(linkId, { bytes: result.bytes, contentType, ts: Date.now() });
  return { kind: 'image', bytes: result.bytes, contentType };
}

/** One lookup per link at a time: later callers await the running one. */
function resolveImageOnce(linkId: string): Promise<Outcome> {
  const running = inFlight.get(linkId);
  if (running) return running;
  const started = resolveImage(linkId).finally(() => {
    inFlight.delete(linkId);
  });
  inFlight.set(linkId, started);
  return started;
}

const linkIdQuerySchema = z.object({ linkId: z.uuid() });

export function registerPreviewImageRoutes(app: Hono): void {
  app.get('/preview-image', async (c) => {
    const parsed = linkIdQuerySchema.safeParse({ linkId: c.req.query('linkId') });
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          message: 'Request validation failed',
          details: parsed.error.issues,
        },
        400,
      );
    }
    const { linkId } = parsed.data;

    const cached = cacheGet(linkId);
    if (cached) {
      return withETag(
        imageResponse(cached.bytes, cached.contentType),
        cached.bytes,
        c.req.header('If-None-Match'),
      );
    }

    const outcome = await resolveImageOnce(linkId);
    if (outcome.kind === 'image') {
      return withETag(
        imageResponse(outcome.bytes, outcome.contentType),
        outcome.bytes,
        c.req.header('If-None-Match'),
      );
    }
    if (outcome.kind === 'none') {
      return c.json({ error: 'not_found', message: 'No preview image for this link' }, 404);
    }
    return c.json({ error: 'not_found', message: 'Preview image unavailable' }, 404);
  });
}

/** Test-only escape hatch to reset module-level cache state between test cases. */
export function __resetPreviewImageCacheForTests(): void {
  cache.clear();
  misses.clear();
  inFlight.clear();
}
