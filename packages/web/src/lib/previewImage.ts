/**
 * The preview-image proxy URL for a link (`GET /api/preview-image?linkId=`,
 * `packages/api/src/routes/preview-image.ts`) — privacy rule: the browser
 * never fetches a third-party image host (YouTube thumbnail, og:image)
 * directly, only silo's own origin, which proxies the link's OWN stored
 * `imageUrl` server-side. Mirrors `Chip.tsx`'s `/api/favicon?domain=` pattern.
 */
export function previewImageUrl(linkId: string): string {
  return `/api/preview-image?linkId=${encodeURIComponent(linkId)}`;
}
