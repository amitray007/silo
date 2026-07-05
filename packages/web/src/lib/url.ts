/**
 * URL-derived display helpers for the Library row (plan 010). Both are pure
 * string transforms of `LinkJson.url` — no network, no workspace import.
 */

/**
 * The row's domain suffix: `new URL(url).hostname` with a leading `www.`
 * stripped (mirrors `Chip`'s own `www.` handling, `chipLetter`). Falls back to
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

/**
 * The row's title fallback when `LinkJson.title` is `null`: the url with its
 * `http://`/`https://` scheme stripped (the prototype's fallback — confirmed
 * against `render-rows-*.png`). Non-http(s) schemes and scheme-less input
 * pass through unchanged.
 */
export function deriveTitleFromUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '');
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
