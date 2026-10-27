/** Process-local port. Only the composition root registers the worker implementation. */
export type LinkTitleFetcher = (
  urls: readonly string[],
  signal: AbortSignal,
) => Promise<Record<string, string>>;

let fetcher: LinkTitleFetcher | undefined;

export function setLinkTitleFetcher(next: LinkTitleFetcher | undefined): void {
  fetcher = next;
}

/**
 * Page titles for links an article points to, keyed by URL. Missing entries
 * mean the page had no usable title or could not be fetched; callers fall back
 * to the article's link text. No fetcher (tests, CLI) returns nothing.
 */
export async function linkTitles(
  urls: readonly string[],
  signal: AbortSignal,
): Promise<Record<string, string>> {
  if (!fetcher || urls.length === 0) return {};
  return fetcher(urls, signal);
}
