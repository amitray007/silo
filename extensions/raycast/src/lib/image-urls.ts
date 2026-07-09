/**
 * The ONLY place proxy image/favicon URLs are built. silo's privacy rule
 * ("no third-party calls per row") means the client must fetch images from
 * silo's own proxy, never the source host — centralizing the URL shape here
 * makes that impossible to get wrong per-call.
 */
export function faviconUrl(baseUrl: string, domain: string): string {
  return `${baseUrl}/api/favicon?domain=${encodeURIComponent(domain)}`;
}

export function previewImageUrl(baseUrl: string, linkId: string): string {
  return `${baseUrl}/api/preview-image?linkId=${encodeURIComponent(linkId)}`;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
