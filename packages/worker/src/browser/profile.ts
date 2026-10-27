export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

/** A fixed profile, never headers supplied by the untrusted page. */
export function browserAccept(resourceType: string): string {
  if (resourceType === 'document')
    return 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  if (resourceType === 'stylesheet') return 'text/css,*/*;q=0.1';
  return '*/*';
}
