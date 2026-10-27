/** Process-local port. Only the composition root registers the worker implementation. */
export type SiteIconFinder = (domain: string, signal: AbortSignal) => Promise<readonly string[]>;

let finder: SiteIconFinder | undefined;

export function setSiteIconFinder(next: SiteIconFinder | undefined): void {
  finder = next;
}

/**
 * A site's own icon URLs, best first, read from its home page. The caller tries
 * them in order because a declared icon can still fail to load. Empty means the
 * site could not be reached; no finder (tests, CLI) returns none.
 */
export async function findSiteIcons(
  domain: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  return finder ? finder(domain, signal) : [];
}
