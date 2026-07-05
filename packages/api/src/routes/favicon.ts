import type { Hono } from 'hono';
import { z } from 'zod';

/**
 * `GET /api/favicon?domain=` — the privacy-preserving favicon proxy (plan
 * 011, V3-2 decision #2: "real favicons, self-proxied through silo"). The
 * BROWSER must never call a third-party host directly for a per-row asset
 * (CLAUDE.md "Design fidelity": "no third-party calls per row"); this route
 * is the one place that boundary is allowed to be crossed, and it's crossed
 * server-side, not from the client.
 *
 * SSRF safety — the whole reason this route is safe: the upstream URL this
 * handler fetches is ALWAYS `https://www.google.com/s2/favicons?domain=...` —
 * the fetched HOST is a hardcoded literal, never derived from the request.
 * `domain` only ever becomes a query-string VALUE handed to Google's own s2
 * favicon service, which resolves and fetches the target site on Google's
 * infrastructure, not silo's. There is no code path here that turns
 * user-controlled input into a fetch *host* — no `fetch(`https://${domain}/favicon.ico`)`
 * — so the usual SSRF surface (input steering a request at localhost/an
 * internal IP/a cloud metadata endpoint) does not exist for this handler. The
 * `domain` Zod schema below still rejects obvious junk (empty, absurdly long,
 * containing a scheme/slash/whitespace) so malformed input fails fast with a
 * 400 rather than round-tripping to Google for a value that could never be a
 * real hostname anyway — that's input hygiene, not the SSRF guard itself.
 *
 * Caching: an in-memory `Map<domain, CacheEntry>`, bounded to
 * `MAX_CACHE_ENTRIES` (oldest inserted evicted first — a `Map` preserves
 * insertion order, so `.keys().next().value` is always the oldest) with a
 * `CACHE_TTL_MS` (24h) staleness check. A single-process in-memory cache is
 * sufficient here — `@silo/api`'s v1 deployment shape is one local process
 * (see `api-hono.md`'s "Auth" section: localhost, single-user) — no shared
 * cache store is needed.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 4000;
const FAVICON_SIZE = 32;

type CacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  ts: number;
};

const cache = new Map<string, CacheEntry>();

function cacheGet(domain: string): CacheEntry | undefined {
  const entry = cache.get(domain);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
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

    const cached = cacheGet(domain);
    if (cached) {
      return new Response(new Uint8Array(cached.bytes), {
        status: 200,
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // The fetched HOST is always google.com (see the doc comment above) —
    // `domain` only ever parameterizes the query string.
    const upstreamUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${FAVICON_SIZE}`;

    let upstream: Response;
    try {
      upstream = await fetchWithTimeout(upstreamUrl);
    } catch {
      // Timeout, DNS failure, network error — never leak the cause to the
      // client. The web falls back to the letter chip on a 404.
      return c.json({ error: 'not_found', message: 'Favicon unavailable' }, 404);
    }

    if (!upstream.ok || !upstream.body) {
      return c.json({ error: 'not_found', message: 'Favicon unavailable' }, 404);
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    cacheSet(domain, { bytes, contentType, ts: Date.now() });

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });
}

/** Test-only escape hatch to reset module-level cache state between test cases. */
export function __resetFaviconCacheForTests(): void {
  cache.clear();
}
