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
