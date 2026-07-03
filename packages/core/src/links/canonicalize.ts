import normalizeUrl from 'normalize-url';

/**
 * Query parameters stripped from every URL during canonicalization, in
 * addition to normalize-url's own tracking-param normalization work
 * (protocol, www, trailing slash, query sort, etc).
 *
 * normalize-url's `removeQueryParameters` default is `[/^utm_\w+/i]` only —
 * passing our own array REPLACES that default rather than extending it, so
 * the utm regex is re-included here alongside the rest of the known
 * tracking-param vocabulary (ad-platform click ids + email-campaign params).
 * See plan R5 + KTD.
 *
 * Every entry is a case-insensitive regex, not a plain string: normalize-url
 * matches string entries case-sensitively, so `?FBCLID=x` / `?Gclid=x` would
 * otherwise survive and defeat dedup between mixed-case variants of a URL.
 *
 * DELIBERATELY CONSERVATIVE: only params that are unambiguously tracking are
 * stripped. `ref`/`spm` and similar are NOT stripped — they are frequently
 * page-defining (product variants, item paths, content selectors), and the
 * failure asymmetry is stark: stripping a page-defining param FALSE-MERGES two
 * distinct links into one row and destroys data, whereas keeping a real
 * tracking param only leaves a harmless duplicate. When unsure, keep it.
 */
const TRACKING_QUERY_PARAMETERS: ReadonlyArray<RegExp> = [
  /^utm_\w+/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^yclid$/i,
  /^igshid$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
];

/**
 * Only http(s) URLs are treated as safe/canonicalizable. Everything else —
 * `javascript:`, `data:`, `vbscript:`, `file:`, custom schemes — is a security
 * hazard: the stored URL is later bound into an `<a href>` (the card opens the
 * original in a new tab) and exposed over MCP, so a `javascript:`/`data:` URL
 * is a stored-XSS sink, and `file:`/link-local hosts are an SSRF/LFR vector at
 * enrichment-fetch time. Reject at this single trust boundary rather than
 * relying on every downstream render/fetch site to re-check.
 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Upper bound on raw URL length. Real URLs sit well under this (the de-facto
 * browser/CDN limit is ~2–8KB); anything larger is almost certainly abusive.
 * Bounds the synchronous work `canonicalize` does on untrusted input at the
 * write boundary (a pasted URL, or an MCP-agent-supplied one).
 */
const MAX_URL_LENGTH = 8192;

export type CanonicalizeResult = {
  /**
   * The canonicalized URL on success, or the original `rawUrl` unchanged
   * when canonicalization fails or is rejected (see `ok`).
   */
  canonical: string;
  /**
   * `false` when `rawUrl` couldn't be parsed/normalized, was over-length, or
   * used a non-http(s) scheme. The link is still saveable using `canonical`
   * (the raw url), but an `ok: false` result is NOT a safe href and NOT
   * eligible for canonical-based dedup — the caller (core write boundary)
   * must honor `ok` for both.
   */
  ok: boolean;
};

/**
 * Normalize a URL into a stable, dedup-friendly canonical form.
 *
 * Wraps `normalize-url@9`: forces https, strips hash/www/trailing-slash and
 * auth, sorts query parameters, and strips known tracking parameters (utm_*
 * plus common ad-platform params — see `TRACKING_QUERY_PARAMETERS`) while
 * preserving non-tracking, page-defining params (e.g. `?id=123`).
 *
 * Never throws (plan R7). Returns `ok: false` (with `canonical` = the raw
 * input) when the URL is over-length, uses a non-http(s) scheme, or can't be
 * parsed — the link is still saveable but is neither a safe href nor a dedup
 * key. Only `ok: true` results are safe to render as a link and to dedup on.
 */
export function canonicalize(rawUrl: string): CanonicalizeResult {
  // Bound work on untrusted input before doing any parsing.
  if (rawUrl.length > MAX_URL_LENGTH) {
    return { canonical: rawUrl, ok: false };
  }

  // Reject dangerous / non-web schemes at the boundary. Parse with the WHATWG
  // URL first (after applying normalize-url's default-protocol behavior for
  // scheme-less input like `example.com`).
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let protocol: string;
  try {
    protocol = new URL(withProtocol).protocol;
  } catch {
    return { canonical: rawUrl, ok: false };
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    return { canonical: rawUrl, ok: false };
  }

  try {
    const canonical = normalizeUrl(rawUrl, {
      defaultProtocol: 'https',
      forceHttps: true,
      stripHash: true,
      stripWWW: true,
      removeTrailingSlash: true,
      sortQueryParameters: true,
      stripAuthentication: true,
      removeQueryParameters: TRACKING_QUERY_PARAMETERS,
    });
    return { canonical, ok: true };
  } catch {
    return { canonical: rawUrl, ok: false };
  }
}
