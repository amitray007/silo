import { getById } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
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
 *    EXCLUSIVELY as a lookup key into `core.getById` — never interpolated
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
 * shape is one local process).
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

/**
 * The image MIME types this proxy will forward. A link's `imageUrl` names an
 * ARBITRARY host (a captured page's `og:image` could point anywhere), so the
 * upstream `Content-Type` is untrusted: without this allowlist a malicious
 * `og:image` could respond `text/html` with a script body that a browser
 * NAVIGATING to `/api/preview-image?linkId=...` (not just loading it via
 * `<img>`) would render as same-origin content from silo (security review,
 * plan 012). We forward the response ONLY when its type is a real image
 * MIME; anything else is treated as "no preview image" (404). Paired with
 * `X-Content-Type-Options: nosniff` on the response so a browser can't
 * MIME-sniff the bytes into something executable regardless.
 */
const ALLOWED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/bmp',
  'image/tiff',
]);

/**
 * Normalize an upstream `Content-Type` (`image/png; charset=binary` ->
 * `image/png`) and return it only if it's an allowed image MIME — else
 * `undefined`, which the caller treats as "not an image, don't serve it".
 */
function allowedImageContentType(rawContentType: string): string | undefined {
  const mime = rawContentType.split(';')[0]?.trim().toLowerCase();
  return mime && ALLOWED_IMAGE_MIME_TYPES.has(mime) ? mime : undefined;
}

type CacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  ts: number;
};

const cache = new Map<string, CacheEntry>();

function cacheGet(linkId: string): CacheEntry | undefined {
  const entry = cache.get(linkId);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(linkId);
    return undefined;
  }
  return entry;
}

function cacheSet(linkId: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(linkId)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(linkId, entry);
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
      return imageResponse(cached.bytes, cached.contentType);
    }

    // linkId is used ONLY as a lookup key — see the SSRF-safety doc comment
    // above. A trashed/nonexistent link never serves an image (live-scoped
    // via getById, same as every other read).
    const link = await getById(linkId);
    if (!link?.imageUrl) {
      return c.json({ error: 'not_found', message: 'No preview image for this link' }, 404);
    }

    const result = await fetchImageSafely(link.imageUrl);
    if (!result.ok) {
      return c.json({ error: 'not_found', message: 'Preview image unavailable' }, 404);
    }

    // Only serve genuine image types (see ALLOWED_IMAGE_MIME_TYPES) — a
    // non-image response from an arbitrary imageUrl host is treated as no
    // preview image, never forwarded from silo's origin.
    const contentType = allowedImageContentType(result.contentType);
    if (!contentType) {
      return c.json({ error: 'not_found', message: 'Preview image unavailable' }, 404);
    }

    cacheSet(linkId, { bytes: result.bytes, contentType, ts: Date.now() });

    return imageResponse(result.bytes, contentType);
  });
}

/**
 * Build the 200 image response with the security/cache headers every served
 * image (cached or fresh) must carry: `X-Content-Type-Options: nosniff` so a
 * browser can't MIME-sniff the proxied bytes into something executable, plus
 * the 24h `Cache-Control`. `contentType` is always an already-allowlisted
 * image MIME by the time it reaches here.
 */
function imageResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Test-only escape hatch to reset module-level cache state between test cases. */
export function __resetPreviewImageCacheForTests(): void {
  cache.clear();
}
