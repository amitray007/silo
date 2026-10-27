/** Process-local port. Only the composition root registers the worker implementation. */
export type SiteIconFinder = (domain: string, signal: AbortSignal) => Promise<string | undefined>;

let finder: SiteIconFinder | undefined;

export function setSiteIconFinder(next: SiteIconFinder | undefined): void {
  finder = next;
}

/**
 * The absolute URL of a site's own icon, read from its home page. Undefined
 * means the site declares no usable icon or could not be reached. No finder
 * (tests, CLI) returns undefined.
 */
export async function findSiteIcon(
  domain: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  return finder ? finder(domain, signal) : undefined;
}
