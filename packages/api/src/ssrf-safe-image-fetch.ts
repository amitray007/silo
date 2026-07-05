/**
 * A MINIMAL, self-contained SSRF-safe fetch for exactly one narrow use case:
 * `preview-image.ts` re-fetching a link's OWN stored `imageUrl` (never a
 * client-supplied URL — see that route's doc comment for the full SSRF
 * argument). NOT a general-purpose fetcher, and deliberately NOT
 * `@silo/worker`'s `safe-fetch.ts` — `@silo/api` may not import `@silo/worker`
 * (`docs/rules/architecture.md`: adapters may only depend on `@silo/core`),
 * and `@silo/core` (the one place both could share it) has zero HTTP
 * capability today; moving the worker's full ~500-line safe-fetch module
 * (redirect-following, streaming-with-cap, DNS-pinning machinery) into core
 * mid-slice — across its 10+ existing call sites — is a disproportionate,
 * higher-risk refactor for a single narrow read-only image proxy. This
 * module instead re-implements JUST the essential SSRF discipline the plan
 * requires, deliberately narrower than the worker's version:
 *
 *  1. Scheme allowlist (http/https only).
 *  2. DNS resolved here (`dns.lookup(..., { all: true })`), every resolved
 *     address classified via a LOCAL COPY of the worker's `ip-rules.ts`
 *     logic (`classifyIp` below — same ipaddr.js-backed range classification,
 *     same fail-closed policy: private/loopback/link-local incl. the cloud
 *     metadata address/CGNAT/unique-local/reserved/multicast/IPv4-mapped-IPv6
 *     bypass are all blocked).
 *  3. The connection is PINNED to the single validated address via undici's
 *     `connect.lookup`, closing the classic DNS-rebinding TOCTOU window.
 *  4. NO redirects followed (`redirect: 'manual'`, treated as a failure) —
 *     unlike the worker's fetch, this proxy has no need to chase a redirect
 *     chain for a stored image URL; refusing outright is simpler and safer.
 *  5. Response body streamed and byte-capped; a hard timeout via
 *     `AbortController` covers the whole operation.
 *
 * Never throws for an expected failure — returns `{ ok: false }`. Only a
 * genuinely unexpected bug should throw.
 */

import { lookup as dnsLookup } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);
const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB — a preview image is small; generous but finite.
const USER_AGENT = 'silo/0.1 (+https://github.com/amitray007/silo)';

/**
 * Runtime gate for the test-only seams below — mirrors `safe-fetch.ts`'s
 * identical `IS_TEST_ENV` guard: even if a caller sets `resolver`/
 * `allowLoopbackForTests`, they are silently inert outside a real Vitest
 * process, so a copy-pasted flag can never reopen an SSRF hole in
 * production.
 */
const IS_TEST_ENV = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export type ImageFetchResult = { ok: true; bytes: Uint8Array; contentType: string } | { ok: false };

/** A hostname resolver — TEST-ONLY SEAM, mirrors `safe-fetch.ts`'s `Resolver`. Every address it returns still goes through the real `classifyIp` gate below. */
export type ImageFetchResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export interface FetchImageSafelyOptions {
  /** TEST-ONLY SEAM (see {@link ImageFetchResolver}). Defaults to real DNS. */
  resolver?: ImageFetchResolver;
  /**
   * TEST-ONLY SEAM. Permits the `loopback` range through classification so
   * a test can drive the real fetch/pinning machinery against a local HTTP
   * server. Defaults to `false`; gated at runtime by `IS_TEST_ENV` — inert
   * outside a genuine test process. Mirrors `safe-fetch.ts`'s identical
   * seam and rationale.
   */
  allowLoopbackForTests?: boolean;
}

/**
 * Local copy of `@silo/worker`'s `fetch/ip-rules.ts` `classifyIp` — see this
 * file's top doc comment for why it's duplicated rather than imported.
 * Kept intentionally in lockstep with the original: same safe-range set,
 * same IPv4-mapped-IPv6 unwrap-and-reclassify defense. `allowLoopback` is
 * the test-only seam (see `FetchImageSafelyOptions`) — `false` in production.
 */
function classifyIp(ip: string, allowLoopback: boolean): { safe: boolean } {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return { safe: false };
  }
  if (
    addr instanceof ipaddr.IPv6 &&
    (addr.isIPv4MappedAddress() || addr.range() === 'ipv4Mapped')
  ) {
    const range = addr.toIPv4Address().range();
    return { safe: range === 'unicast' || (allowLoopback && range === 'loopback') };
  }
  const range = addr.range();
  return { safe: range === 'unicast' || (allowLoopback && range === 'loopback') };
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function resolveHostname(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses);
    });
  });
}

/**
 * Validate `rawUrl`'s scheme, resolve its host, and classify every resolved
 * address — returning the parsed `URL` + the single pinned `{address,
 * family}` to connect to, or `undefined` for any expected failure (bad
 * scheme, DNS failure, no addresses, any address unsafe — fail closed on a
 * multi-homed host exactly as `safe-fetch.ts` does).
 */
async function validateAndPinHost(
  rawUrl: string,
  resolver: ImageFetchResolver,
  allowLoopback: boolean,
): Promise<
  { url: URL; hostname: string; pinned: { address: string; family: number } } | undefined
> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return undefined;
  }

  const hostname = stripIpv6Brackets(url.hostname);

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    return undefined;
  }
  if (addresses.length === 0) {
    return undefined;
  }
  if (addresses.some(({ address }) => !classifyIp(address, allowLoopback).safe)) {
    return undefined;
  }
  const pinned = addresses[0];
  if (!pinned) {
    return undefined;
  }
  return { url, hostname, pinned };
}

/**
 * Stream the response body, counting bytes and aborting past
 * `MAX_BODY_BYTES` — never trusts `Content-Length`. Mirrors `safe-fetch.ts`'s
 * identical streamed-byte-cap reasoning.
 */
async function readBodyCapped(response: Response): Promise<Uint8Array | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetch `rawUrl` (the link's own stored `imageUrl` — never client-supplied)
 * through the SSRF gate described above. Returns the bytes + content-type,
 * or `{ ok: false }` for ANY expected failure (blocked scheme/IP, DNS
 * failure, timeout, oversized body, non-2xx, a redirect).
 */
export async function fetchImageSafely(
  rawUrl: string,
  options: FetchImageSafelyOptions = {},
): Promise<ImageFetchResult> {
  const resolver = options.resolver ?? resolveHostname;
  // The loopback bypass is honored ONLY inside a real test process — mirrors
  // safe-fetch.ts's identical defense-in-depth reasoning.
  const allowLoopback = IS_TEST_ENV && (options.allowLoopbackForTests ?? false);

  const validated = await validateAndPinHost(rawUrl, resolver, allowLoopback);
  if (!validated) {
    return { ok: false };
  }
  const { url, hostname, pinned } = validated;

  const agent = new Agent({
    connect: {
      lookup(host, _opts, callback) {
        if (host !== hostname) {
          callback(new Error('ssrf-safe-image-fetch: unexpected host'), []);
          return;
        }
        callback(null, [{ address: pinned.address, family: pinned.family === 6 ? 6 : 4 }]);
      },
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await undiciFetch(url, {
      dispatcher: agent,
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });

    // No redirect-chasing (see the top doc comment) — a stored imageUrl that
    // now redirects is treated as unavailable, not followed.
    if (response.status < 200 || response.status >= 300) {
      return { ok: false };
    }

    const bytes = await readBodyCapped(response);
    if (!bytes) {
      return { ok: false };
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    return { ok: true, bytes, contentType };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
    await agent.destroy().catch(() => {
      // best-effort teardown
    });
  }
}
