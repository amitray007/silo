/**
 * SSRF-safe fetch — the security boundary for fetching an untrusted,
 * user-supplied URL server-side.
 *
 * Defense layers (see docs/plans/2026-07-04-002-feat-enrichment-worker-plan.md,
 * U2 + the "safeFetch validation gate" diagram):
 *
 *  1. Scheme allowlist (http/https only) — re-checked here even though
 *     `canonicalize` already gates schemes at write time; this module must
 *     stand on its own.
 *  2. DNS resolved ourselves (`dns.lookup(..., { all: true })`), and EVERY
 *     returned address is classified via `ip-rules.ts`. If any address is
 *     blocked, the whole hostname is rejected — fail closed.
 *  3. The connection is PINNED to the single validated address: undici's
 *     `connect.lookup` hands back exactly the IP that was classified, so
 *     the checked IP and the connected IP are identical. This closes the
 *     classic DNS-rebinding TOCTOU window (resolve-and-check, then a
 *     second resolve-and-connect returns a different, internal address).
 *  4. Redirects are followed manually (`redirect: 'manual'`) and the ENTIRE
 *     validation (scheme + resolve + classify + pin) re-runs on every
 *     `Location`, capped at a small number of hops.
 *  5. The response body is streamed and byte-counted as it arrives, and
 *     aborted past a cap — `Content-Length` is never trusted (a server can
 *     lie about it, or omit it and stream forever).
 *  6. A single `AbortController` deadline covers the whole operation
 *     (connect + all redirects + body), not just the initial connect.
 *
 * This module never throws for an *expected* failure (blocked URL, dead
 * host, timeout, oversized body, non-2xx, ...) — it returns a typed
 * `{ ok: false, reason }`. Only a genuinely unexpected bug should throw.
 * Fail closed: any classification uncertainty results in a block.
 */

import { lookup as dnsLookup } from 'node:dns';
import { Agent, type Response as UndiciResponse, fetch as undiciFetch } from 'undici';
import type { BodyByteBudget } from './body-budget.js';
import { classifyIp } from './ip-rules.js';

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * `URL.hostname` returns an IPv6 literal wrapped in brackets (`[::1]`);
 * `dns.lookup` needs the bare address (`::1`). Strip a single leading `[`
 * and trailing `]` when both are present; leave hostnames and IPv4
 * literals untouched.
 */
function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB
export const DEFAULT_TIMEOUT_MS = 10_000;

export const FETCH_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

const USER_AGENT = 'silo/0.1 (+https://github.com/amitray007/silo)';

/** `accept` for callers that fetch a web page; other callers default to any type. */
export const HTML_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8';

/**
 * Runtime gate for the `allowLoopbackForTests` seam. The loopback bypass is
 * ONLY honored when the process is genuinely a test runner (Vitest sets
 * `VITEST`; `NODE_ENV==='test'` is the conventional signal). In any other
 * process — production, a script, a mis-wired caller that copy-pasted the
 * flag — the flag is silently inert and the full SSRF classification
 * (including loopback) applies. This makes the seam impossible to weaponize
 * outside a test process: convention (the doc comment) is backed by a
 * runtime guard, not trusted alone.
 */
const IS_TEST_ENV = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export type SafeFetchFailureReason =
  | 'blocked-scheme'
  | 'blocked-ip'
  | 'dns-error'
  | 'too-many-redirects'
  | 'body-too-large'
  | 'timeout'
  | 'http-error'
  | 'not-found'
  | 'fetch-error';

export type SafeFetchBytesResult =
  | {
      ok: true;
      notModified?: true;
      permanentRedirect?: true;
      bytes: Uint8Array;
      contentType: string | undefined;
      finalUrl: string;
      status: number;
      responseHeaders?: Record<string, string>;
      xFrameOptions?: string;
      contentSecurityPolicy?: string;
    }
  | {
      ok: false;
      reason: SafeFetchFailureReason;
      status?: number;
      responseHeaders?: Record<string, string>;
      /** Extra detail for logging/debugging; never user-facing. */
      detail?: string;
    };

/** Raw bodies and HTTP statuses use the same DNS, redirect and streaming boundary. */
export type SafeFetchResult =
  | (Omit<Extract<SafeFetchBytesResult, { ok: true }>, 'bytes'> & { html: string })
  | Extract<SafeFetchBytesResult, { ok: false }>;

/**
 * A hostname resolver: given a hostname, returns every address it resolves
 * to. Defaults to Node's real `dns.lookup(..., { all: true })`.
 *
 * TEST-ONLY SEAM: production code should never override this — overriding
 * it only changes *which addresses a hostname resolves to*; every address
 * returned is still run through the full `classifyIp` gate and pinning
 * logic below, so an override cannot itself open an SSRF hole. It exists
 * so tests can point a public-looking hostname at a local loopback test
 * server without touching the security logic under test.
 */
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses);
    });
  });

export interface SafeFetchOptions {
  /** Trusted caller profile only; never copy publisher request headers. */
  userAgent?: string;
  headers?: Record<string, string>;
  accept?: string;
  /** Public application metadata selected by trusted callers, never request credentials. */
  responseHeaderNames?: readonly string[];
  signal?: AbortSignal;
  maxRedirects?: number;
  maxBodyBytes?: number;
  /** Shared streaming cap for a group of related responses. */
  bodyBudget?: BodyByteBudget;
  timeoutMs?: number;
  /** TEST-ONLY SEAM — see {@link Resolver}. Defaults to real DNS. */
  resolver?: Resolver;
  /**
   * TEST-ONLY SEAM. When `true`, additionally permits the `loopback`
   * IP range (127.0.0.0/8, ::1) through classification, so a test can
   * exercise the real fetch/redirect/size-cap/timeout/pinning machinery
   * against a local HTTP server without a real public host.
   *
   * This is narrow and explicit by design: it does NOT relax any other
   * range (private, link-local/metadata, CGNAT, ULA, mapped, reserved,
   * multicast, ... all remain blocked), it defaults to `false`, and
   * production call sites (the worker's `enrich.ts`) must never set it —
   * it exists solely so tests can prove the non-loopback defenses still
   * hold even when loopback itself is allowed (see the
   * redirect-to-private test in safe-fetch.test.ts).
   *
   * Defense in depth: the flag is ALSO gated at runtime by `IS_TEST_ENV`
   * (Vitest / `NODE_ENV==='test'`) — outside a real test process it is
   * silently inert and loopback is blocked like every other internal
   * range, so a copy-pasted or misconfigured flag in production cannot
   * reopen loopback SSRF. The convention is backed by a runtime guard.
   */
  allowLoopbackForTests?: boolean;
}

/**
 * Validate a URL string, resolve its host, and classify every resolved
 * address. Returns the parsed URL + the single pinned IP to connect to, or
 * a typed failure.
 */
/**
 * Reject as soon as `signal` aborts, otherwise settle with `promise`. Used to
 * bound the DNS-resolution step by the overall timeout — a hung/slow resolver
 * would otherwise stall `safeFetch` past `timeoutMs`, since the resolver call
 * is not itself covered by the fetch's AbortController.
 */
function raceAgainstAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function validateUrl(
  rawUrl: string,
  resolver: Resolver,
  allowLoopbackForTests: boolean,
  signal: AbortSignal,
): Promise<
  | { ok: true; url: URL; pinnedIp: string; family: number }
  | { ok: false; reason: SafeFetchFailureReason; detail?: string }
> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'blocked-scheme', detail: 'unparseable-url' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: 'blocked-scheme', detail: url.protocol };
  }

  // `url.hostname` wraps an IPv6 literal in brackets (`[::1]`), but
  // `dns.lookup` needs the bare address (`::1`) — passing the bracketed
  // form makes every IPv6-literal URL fail with ENOTFOUND. Strip the
  // brackets so IPv6 literals resolve to themselves like IPv4 literals do.
  // A plain hostname or IPv4 literal is unaffected (no brackets to strip).
  const hostname = stripIpv6Brackets(url.hostname);

  let addresses: Array<{ address: string; family: number }>;
  try {
    // Bound the resolver by the overall timeout: a hung DNS lookup must not
    // outlive the AbortController deadline.
    addresses = await raceAgainstAbort(resolver(hostname), signal);
  } catch (err) {
    return {
      ok: false,
      reason: signal.aborted ? 'timeout' : 'dns-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: 'dns-error', detail: 'no-addresses' };
  }

  // Fail closed: if ANY resolved address is blocked, reject the whole
  // hostname. A multi-homed host that resolves to one public and one
  // internal address must not be trusted just because one answer looked
  // safe — and we only ever connect to a single pinned address anyway, so
  // there is no way to know in advance which one the caller "meant".
  for (const { address } of addresses) {
    const classification = classifyIp(address);
    const isAllowedLoopbackForTests =
      allowLoopbackForTests &&
      classification.safe === false &&
      classification.reason === 'blocked-range:loopback';
    if (!classification.safe && !isAllowedLoopbackForTests) {
      return { ok: false, reason: 'blocked-ip', detail: `${address}:${classification.reason}` };
    }
  }

  const first = addresses[0];
  if (!first) {
    return { ok: false, reason: 'dns-error', detail: 'no-addresses' };
  }

  return { ok: true, url, pinnedIp: first.address, family: first.family };
}

/**
 * Build an undici Agent whose connector is pinned to `pinnedIp` for
 * `hostname`. The custom `connect.lookup` ignores whatever the OS resolver
 * would return and hands back exactly the address we already classified —
 * this is what makes the classified IP and the connected IP identical.
 */
function buildPinnedAgent(hostname: string, pinnedIp: string, family: number): Agent {
  return new Agent({
    connect: {
      lookup(host, _opts, callback) {
        if (host !== hostname) {
          // Defense in depth: this connector must only ever be asked to
          // resolve the exact hostname it was pinned for.
          callback(
            new Error(`safeFetch: pinned connector asked to resolve unexpected host ${host}`),
            [],
          );
          return;
        }
        callback(null, [{ address: pinnedIp, family: family === 6 ? 6 : 4 }]);
      },
    },
  });
}

/** Outcome of a single hop: either a terminal result, or a redirect to follow. */
type HopOutcome =
  | { kind: 'redirect'; nextUrl: string; permanent: boolean }
  | { kind: 'done'; result: SafeFetchBytesResult };

interface HopContext {
  headers: Record<string, string>;
  userAgent: string;
  accept: string;
  responseHeaderNames: readonly string[];
  includeHttpErrors: boolean;
  resolver: Resolver;
  maxBodyBytes: number;
  bodyBudget: BodyByteBudget | undefined;
  controller: AbortController;
  isLastHop: boolean;
  allowLoopbackForTests: boolean;
}

/**
 * Validate, connect (pinned), and interpret the response for a single hop:
 * a redirect (to be re-validated from scratch on the next hop), or a
 * terminal result (success, or a typed failure).
 */
async function performHop(currentUrl: string, ctx: HopContext): Promise<HopOutcome> {
  const validated = await validateUrl(
    currentUrl,
    ctx.resolver,
    ctx.allowLoopbackForTests,
    ctx.controller.signal,
  );
  if (!validated.ok) {
    return { kind: 'done', result: validated };
  }

  const agent = buildPinnedAgent(validated.url.hostname, validated.pinnedIp, validated.family);
  try {
    return await requestAndInterpret(validated.url, agent, ctx);
  } catch (err) {
    const failure: SafeFetchBytesResult = ctx.controller.signal.aborted
      ? { ok: false, reason: 'timeout' }
      : {
          ok: false,
          reason: 'fetch-error',
          detail: err instanceof Error ? err.message : String(err),
        };
    return { kind: 'done', result: failure };
  } finally {
    // `destroy()` (not the graceful `close()`) tears the connection down
    // IMMEDIATELY, aborting any body still in flight. This is critical:
    // graceful `close()` blocks until the response body has fully drained,
    // which — if called before/around `readBodyWithCap` — both defeats the
    // streamed byte-cap (undici buffers the whole body first) and hangs a
    // slow/oversized body until the outer timeout fires. The body we
    // actually want has already been read inside `requestAndInterpret`
    // before we reach here; anything left is a body we are discarding
    // (redirect / http-error / over-cap), so aborting it is exactly right.
    //
    // Swallow any teardown rejection: a `destroy()` failure (e.g. a
    // socket-level error during forced close) must NOT override the
    // already-computed HopOutcome or reject safeFetch's promise — the
    // module's contract is "never throws for an expected failure". This is
    // best-effort cleanup.
    await agent.destroy().catch(() => {
      // intentionally ignored — teardown is best-effort
    });
  }
}

/**
 * Issue the request on the pinned agent and fully interpret the response
 * — INCLUDING reading the (capped) body — before returning. All body
 * consumption happens here, inside `performHop`'s try, so the agent is only
 * torn down (in `performHop`'s finally) after we are done with the body.
 */
async function requestAndInterpret(url: URL, agent: Agent, ctx: HopContext): Promise<HopOutcome> {
  const response = await requestOnce(
    url,
    agent,
    ctx.controller,
    ctx.accept,
    ctx.userAgent,
    ctx.headers,
  );

  if (
    response.status !== 304 &&
    response.status >= 300 &&
    response.status < 400 &&
    (!ctx.includeHttpErrors || [301, 302, 303, 307, 308].includes(response.status))
  ) {
    return interpretRedirect(response, url, ctx.isLastHop);
  }
  if (response.status >= 400 && !ctx.includeHttpErrors) {
    // A true 404/410 means the resource genuinely no longer exists — the
    // worker branches on this to silently trash the link (plan 025). Every
    // other 4xx/5xx (403/429/500/503/...) is "couldn't fetch right now", not
    // "gone", and stays `http-error` so the link is kept + retried.
    if (response.status === 404 || response.status === 410) {
      return {
        kind: 'done',
        result: {
          ok: false,
          reason: 'not-found',
          detail: String(response.status),
          status: response.status,
          responseHeaders: selectedHeaders(response, ctx.responseHeaderNames),
        },
      };
    }
    return {
      kind: 'done',
      result: {
        ok: false,
        reason: 'http-error',
        detail: String(response.status),
        status: response.status,
        responseHeaders: selectedHeaders(response, ctx.responseHeaderNames),
      },
    };
  }

  const contentType = response.headers.get('content-type') ?? undefined;
  const body = await readBodyWithCap(response, ctx.maxBodyBytes, ctx.controller, ctx.bodyBudget);
  if (!body.ok) {
    return { kind: 'done', result: body };
  }

  return {
    kind: 'done',
    result: {
      ok: true,
      bytes: body.bytes,
      ...notModifiedFlag(response.status),
      contentType,
      finalUrl: url.toString(),
      status: response.status,
      ...(ctx.responseHeaderNames.length
        ? {
            responseHeaders: Object.fromEntries(
              ctx.responseHeaderNames
                .filter((name) => response.headers.has(name))
                .map((name) => [name, response.headers.get(name) ?? '']),
            ),
          }
        : {}),
      ...(response.headers.has('x-frame-options')
        ? { xFrameOptions: response.headers.get('x-frame-options') ?? '' }
        : {}),
      ...(response.headers.has('content-security-policy')
        ? { contentSecurityPolicy: response.headers.get('content-security-policy') ?? '' }
        : {}),
    },
  };
}

function interpretRedirect(
  response: UndiciResponse,
  currentUrl: URL,
  isLastHop: boolean,
): HopOutcome {
  const location = response.headers.get('location');
  if (!location) {
    return {
      kind: 'done',
      result: {
        ok: false,
        reason: 'http-error',
        detail: `redirect-without-location:${response.status}`,
      },
    };
  }
  if (isLastHop) {
    return { kind: 'done', result: { ok: false, reason: 'too-many-redirects' } };
  }
  // Resolve a relative Location against the current URL. The caller loops
  // back to the top on the next hop, which fully re-validates (scheme +
  // DNS + IP classification + pinning) before connecting — a redirect can
  // never skip the gate.
  return {
    kind: 'redirect',
    nextUrl: new URL(location, currentUrl).toString(),
    permanent: response.status === 301 || response.status === 308,
  };
}

async function requestOnce(
  url: URL,
  agent: Agent,
  controller: AbortController,
  accept: string,
  userAgent: string,
  headers: Record<string, string>,
): Promise<UndiciResponse> {
  // Deliberately `undici`'s own `fetch`, NOT Node's global `fetch`. Node's
  // native fetch is built on its own internally-bundled undici, which is a
  // different major version from the `undici` package in this workspace —
  // passing our `Agent` as `dispatcher` to the global `fetch` throws
  // `InvalidArgumentError: invalid onRequestStart method` at runtime (the
  // two undici copies' internal handler shapes don't match). Using
  // `undici`'s `fetch` keeps the dispatcher and the fetch implementation
  // from the same package, which is also what makes the `connect.lookup`
  // pinning actually take effect.
  return undiciFetch(url, {
    dispatcher: agent,
    redirect: 'manual',
    signal: controller.signal,
    headers: {
      ...headers,
      'user-agent': userAgent,
      accept,
      'accept-language': FETCH_ACCEPT_LANGUAGE,
    },
  });
}

/**
 * Fetch an untrusted URL through the full SSRF-safe validation gate,
 * following redirects manually and re-validating each hop, capping
 * response size and total time.
 *
 * Never throws for an expected failure — returns `{ ok: false, reason }`.
 */
async function fetchBody(
  rawUrl: string,
  options: SafeFetchOptions,
  includeHttpErrors: boolean,
  userAgent = USER_AGENT,
): Promise<SafeFetchBytesResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolver = options.resolver ?? defaultResolver;
  // The loopback bypass is honored ONLY inside a real test process — even
  // if a caller sets the flag, it is inert outside tests (defense in depth
  // behind the doc-comment convention).
  const allowLoopbackForTests = IS_TEST_ENV && (options.allowLoopbackForTests ?? false);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  options.bodyBudget?.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted || options.bodyBudget?.signal.aborted) controller.abort();

  try {
    let currentUrl = rawUrl;
    let permanentRedirect = false;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const outcome = await performHop(currentUrl, {
        resolver,
        headers: conditionalHeaders(options.headers),
        includeHttpErrors,
        responseHeaderNames: options.responseHeaderNames ?? [],
        accept: options.accept ?? '*/*',
        userAgent,
        maxBodyBytes,
        bodyBudget: options.bodyBudget,
        controller,
        isLastHop: hop === maxRedirects,
        allowLoopbackForTests,
      });
      if (outcome.kind === 'done') {
        return withPermanentRedirect(outcome.result, permanentRedirect);
      }
      permanentRedirect = permanentRedirect || outcome.permanent;
      currentUrl = outcome.nextUrl;
    }

    return { ok: false, reason: 'too-many-redirects' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    options.bodyBudget?.signal.removeEventListener('abort', onAbort);
  }
}

/** Existing page-fetch contract, including its 404/410 and error handling. */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const result = await fetchBody(rawUrl, options, false);
  if (!result.ok) return result;
  const { bytes, ...response } = result;
  return { ...response, html: decodeBody(bytes, result.contentType) };
}

/** Browser proxy: preserve bytes and terminal statuses without forwarding credentials. */
export function safeFetchBytes(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchBytesResult> {
  return fetchBody(rawUrl, options, true, options.userAgent ?? USER_AGENT);
}

/**
 * Stream the response body, counting bytes as they arrive and aborting
 * past `maxBodyBytes`. Never trusts `Content-Length` (a server can lie
 * about it, omit it, or stream indefinitely).
 */
async function readBodyWithCap(
  response: UndiciResponse,
  maxBodyBytes: number,
  controller: AbortController,
  budget?: BodyByteBudget,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: SafeFetchFailureReason }> {
  if (!response.body) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const reader = budget ? response.body.getReader({ mode: 'byob' }) : response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const result = budget
        ? await readReserved(reader as ReadableStreamBYOBReader, budget)
        : await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
      if (!result) {
        await reader.cancel();
        return { ok: false, reason: 'body-too-large' };
      }
      const { done, value } = result;
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        return { ok: false, reason: 'body-too-large' };
      }
      chunks.push(value);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, reason: 'timeout' };
    }
    throw err;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: combined };
}

/** BYOB prevents a single arbitrary stream chunk from overshooting the shared cap. */
async function readReserved(reader: ReadableStreamBYOBReader, budget: BodyByteBudget) {
  const reserved = budget.reserve(64 * 1024);
  if (!reserved) return undefined;
  let read = 0;
  try {
    const result = await reader.read(new Uint8Array(reserved));
    read = result.value?.byteLength ?? 0;
    return result;
  } finally {
    budget.settle(reserved, read);
  }
}

/**
 * Decode a byte body per the Content-Type charset when present, else
 * UTF-8. Full non-UTF-8 `<meta charset>`-sniffing is deferred per the plan
 * (R9 / Scope Boundaries) — this is a documented known limitation, not an
 * oversight.
 */
function decodeBody(bytes: Uint8Array, contentType: string | undefined): string {
  const charsetMatch = contentType?.match(/charset=([^;]+)/i);
  // A charset parameter may be a quoted-string per RFC 7231
  // (`charset="iso-8859-1"`); strip surrounding quotes so the label handed
  // to TextDecoder is a bare token, not `"iso-8859-1"` (which TextDecoder
  // rejects, silently degrading correctly-labeled bodies to UTF-8 mojibake).
  const charset = charsetMatch?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase();
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    // Unknown/unsupported charset label — fall back to UTF-8 rather than
    // throwing; a mislabeled charset is still better decoded as best-effort
    // than treated as a hard failure.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function conditionalHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(
        ([name, value]) =>
          ['if-none-match', 'if-modified-since'].includes(name) && !/[\r\n]/.test(value),
      ),
  );
}

function selectedHeaders(
  response: UndiciResponse,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    names
      .filter((name) => response.headers.has(name))
      .map((name) => [name, response.headers.get(name) ?? '']),
  );
}

function notModifiedFlag(status: number): { notModified?: true } {
  return status === 304 ? { notModified: true } : {};
}
function withPermanentRedirect(
  result: SafeFetchBytesResult,
  permanent: boolean,
): SafeFetchBytesResult {
  return result.ok && permanent ? { ...result, permanentRedirect: true } : result;
}
