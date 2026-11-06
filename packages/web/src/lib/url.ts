/**
 * URL-derived display helpers for the Library row (plan 010). Both are pure
 * string transforms of `LinkJson.url` — no network, no workspace import.
 */

/**
 * The row's domain suffix: `new URL(url).hostname` with a leading `www.`
 * stripped (the same `www.` handling `Chip` applies). Falls back to
 * the raw `url` string on a malformed URL rather than throwing — a row must
 * always render something.
 */
export function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

/**
 * A short site name for a pill: the registrable label without its suffix
 * ("simonwillison.net" -> "simonwillison", "bbc.co.uk" -> "bbc"). A bare or
 * single-label host passes through.
 */
export function siteName(domain: string): string {
  const labels = domain
    .replace(/^www\./i, '')
    .toLowerCase()
    .split('.');
  if (labels.length < 2) return labels.join('.');
  const second = labels.at(-2) ?? '';
  const drop = labels.length > 2 && second.length <= 3 && SECOND_LEVEL.has(second) ? 2 : 1;
  return labels.at(-1 - drop) ?? labels[0] ?? domain;
}

/**
 * The row's title fallback when `LinkJson.title` is `null`: the url with its
 * `http://`/`https://` scheme stripped (the prototype's fallback — confirmed
 * against `render-rows-*.png`). Non-http(s) schemes and scheme-less input
 * pass through unchanged.
 */
export function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./i, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    const segment = path.split('/').filter(Boolean).at(-1);
    if (!segment) return host;
    const slug = decodeURIComponent(segment).replace(/\.(html?|php|aspx)$/i, '');
    if (/\p{L}/u.test(slug) && /[-_]/.test(slug)) {
      const title = slug.replace(/[-_]+/g, ' ');
      return title.charAt(0).toUpperCase() + title.slice(1);
    }
    return host + path;
  } catch {
    return url.replace(/^https?:\/\//i, '');
  }
}

/**
 * The omnibar's `omniIsUrl` heuristic (`Silo-v3.html`): does typed text look
 * enough like a URL to switch the bar from "search" to "keep" mode? Accepts
 * an explicit `http(s)://` URL, OR a bare `word.tld[...]` shape (a scheme-less
 * paste like `example.com/path` — the common case) with no internal
 * whitespace. Deliberately loose (a false positive just shows the `keep ↵`
 * affordance a beat early; capture itself, landing in V3-3, will do the real
 * validation) — this is a UI-mode heuristic, not a security/parsing boundary.
 */
export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmed);
}

export function normalizeFeedUrl(url: string): string {
  const value = url.trim();
  const hasScheme =
    value.includes('://') ||
    /^(?:mailto|javascript|data|tel|sms|urn|about|blob|file|http|https|ftp):/i.test(value);
  return hasScheme ? value : `https://${value}`;
}
