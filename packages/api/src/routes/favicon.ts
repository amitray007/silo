import { findSiteIcons } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { allowedImageContentType, imageResponse } from '../image-response.js';
import { fetchImageSafely } from '../ssrf-safe-image-fetch.js';

/**
 * `GET /api/favicon?domain=` — the privacy-preserving favicon proxy (plan
 * 011, V3-2 decision #2: "real favicons, self-proxied through silo"). The
 * BROWSER must never call a third-party host directly for a per-row asset
 * (CLAUDE.md "Design fidelity": "no third-party calls per row"); this route
 * is the one place that boundary is allowed to be crossed, and it's crossed
 * server-side, not from the client.
 *
 * Sources, in order: Google's s2 service, then the site's own icon. Google
 * answers 404 with a placeholder for domains it does not know, so the fallback
 * asks the worker's `findSiteIcon` port for the icon URL a site's home page
 * declares, then fetches the image itself.
 *
 * SSRF safety: the Google fetch targets a hardcoded host; `domain` only becomes
 * a query-string VALUE there. The site fallback does turn the domain into a
 * fetch host, but never directly. The worker reads the home page with its
 * SSRF-safe fetcher (scheme allowlist, DNS classification, pinned connection,
 * re-validated redirects), and the icon image goes through `fetchImageSafely`
 * (same gate, no redirects, byte cap). Only an allowlisted raster image type is
 * served, with `nosniff`. The `domain` Zod schema below still rejects obvious
 * junk (empty, absurdly long, containing a scheme/slash/whitespace) with a 400.
 *
 * Caching: an in-memory `Map<domain, CacheEntry>`, bounded to
 * `MAX_CACHE_ENTRIES` (oldest inserted evicted first — a `Map` preserves
 * insertion order, so `.keys().next().value` is always the oldest) with a
 * `CACHE_TTL_MS` (24h) staleness check. A domain with no icon is cached too,
 * for a shorter `MISS_TTL_MS` (1h), so it does not hit Google or the site on
 * every request. A single-process in-memory cache is
 * sufficient here — `@silo/api`'s v1 deployment shape is one local process
 * (see `api-hono.md`'s "Auth" section: localhost, single-user) — no shared
 * cache store is needed.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A domain with no icon is retried sooner than a found one, in case the site adds one. */
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 4000;
const SITE_LOOKUP_TIMEOUT_MS = 8000;
const FAVICON_SIZE = 32;

type Icon = { bytes: Uint8Array; contentType: string };
/** `icon` is undefined when neither Google nor the site has one. */
type CacheEntry = { icon: Icon | undefined; ts: number };

const cache = new Map<string, CacheEntry>();

function cacheGet(domain: string): CacheEntry | undefined {
  const entry = cache.get(domain);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > (entry.icon ? CACHE_TTL_MS : MISS_TTL_MS)) {
    cache.delete(domain);
    return undefined;
  }
  return entry;
}

function cacheSet(domain: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(domain)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(domain, entry);
}

/**
 * A plausible-hostname check — NOT a full RFC 1035 validator. Just enough to
 * reject obvious junk (empty, whitespace, a URL instead of a bare host, wildly
 * oversized input) before it's handed to Google's s2 endpoint as a query
 * value. Deliberately permissive on the charset (real-world hostnames include
 * punycode `xn--` labels, and being over-strict here only produces a letter-
 * chip fallback for a real domain, never a security issue — the SSRF guard
 * above is what actually matters).
 */
const domainQuerySchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i, {
      message: 'domain must be a bare hostname (e.g. "example.com"), not a URL',
    }),
});

/** Fetches `input` but aborts after `UPSTREAM_TIMEOUT_MS` — an unreachable/slow upstream must never hang the request. */
async function fetchWithTimeout(input: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Google's s2 service. The fetched HOST is always google.com; `domain` only parameterizes the query. */
async function iconFromGoogle(domain: string): Promise<Icon | undefined> {
  const upstreamUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${FAVICON_SIZE}`;
  try {
    const upstream = await fetchWithTimeout(upstreamUrl);
    if (!upstream.ok || !upstream.body) return undefined;
    const contentType = allowedImageContentType(
      upstream.headers.get('content-type') ?? 'image/png',
    );
    if (!contentType) return undefined;
    return { bytes: new Uint8Array(await upstream.arrayBuffer()), contentType };
  } catch {
    // Timeout, DNS failure, network error: the caller moves on to the next source.
    return undefined;
  }
}

const SVG = 'image/svg+xml';
/** A site icon is small; an SVG past this is not an icon worth serving. */
const MAX_SVG_BYTES = 64 * 1024;
/** Candidates tried per domain, so a site listing many broken icons stays cheap. */
const MAX_SITE_CANDIDATES = 4;

/** An allowlisted raster type, or SVG for a small body that really is an `<svg>` document. */
function siteIconType(rawContentType: string, bytes: Uint8Array): string | undefined {
  const raster = allowedImageContentType(rawContentType);
  if (raster) return raster;
  const mime = rawContentType.split(';')[0]?.trim().toLowerCase();
  if (mime !== SVG || bytes.byteLength > MAX_SVG_BYTES) return undefined;
  const start = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return start.startsWith('<svg') || start.startsWith('<?xml') ? SVG : undefined;
}

/**
 * The site's own icon, for domains Google does not know. The icon URLs come from
 * the worker's SSRF-safe page reader, best first, and each image is fetched
 * through the SSRF-safe image fetcher, so no request host is ever taken straight
 * from input. The first candidate that loads as an allowed image wins.
 */
async function iconFromSite(domain: string): Promise<Icon | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITE_LOOKUP_TIMEOUT_MS);
  try {
    const candidates = await findSiteIcons(domain, controller.signal);
    for (const url of candidates.slice(0, MAX_SITE_CANDIDATES)) {
      if (controller.signal.aborted) return undefined;
      const image = await fetchImageSafely(url);
      if (!image.ok) continue;
      const contentType = siteIconType(image.contentType, image.bytes);
      if (contentType) return { bytes: image.bytes, contentType };
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SVG can carry script. An `<img>` never runs it, but opening the URL directly
 * would render it on silo's origin, so the response is sandboxed with no script
 * or network access and downloads instead of rendering when opened.
 */
function svgResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': SVG,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Content-Disposition': 'attachment; filename="favicon.svg"',
    },
  });
}

export function registerFaviconRoutes(app: Hono): void {
  app.get('/favicon', async (c) => {
    const parsed = domainQuerySchema.safeParse({ domain: c.req.query('domain') });
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
    const { domain } = parsed.data;

    let entry = cacheGet(domain);
    if (!entry) {
      // Never leak the upstream cause to the client. The web falls back to the
      // letter chip on a 404.
      const icon = (await iconFromGoogle(domain)) ?? (await iconFromSite(domain));
      entry = { icon, ts: Date.now() };
      cacheSet(domain, entry);
    }
    if (!entry.icon) {
      return c.json({ error: 'not_found', message: 'Favicon unavailable' }, 404);
    }
    return entry.icon.contentType === SVG
      ? svgResponse(entry.icon.bytes)
      : imageResponse(entry.icon.bytes, entry.icon.contentType);
  });
}

/** Test-only escape hatch to reset module-level cache state between test cases. */
export function __resetFaviconCacheForTests(): void {
  cache.clear();
}
