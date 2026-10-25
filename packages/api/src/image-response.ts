/**
 * The image MIME types this proxy will forward. A link's `imageUrl` names an
 * ARBITRARY host (a captured page's `og:image` could point anywhere), so the
 * upstream `Content-Type` is untrusted: without this allowlist a malicious
 * `og:image` could respond `text/html` with a script body that a browser
 * NAVIGATING to `/api/preview-image?linkId=...` (not just loading it via
 * `<img>`) would render as same-origin content from silo (security review,
 * plan 012). We forward the response ONLY when its type is a real image
 * MIME; anything else is treated as "no preview image" (404). Paired with
 * `X-Content-Type-Options: nosniff` on the response so a browser can't
 * MIME-sniff the bytes into something executable regardless.
 *
 * SVG is DELIBERATELY EXCLUDED (CodeRabbit security review): an
 * attacker-controlled `og:image` returning `image/svg+xml` can carry inline
 * `<script>`, and `nosniff` does NOT stop a same-origin SVG from executing if
 * a browser NAVIGATES to the proxy URL. Preview images are raster (og:image
 * PNG/JPEG, the YouTube thumbnail JPEG) — no legitimate preview needs SVG, so
 * dropping it removes the XSS vector outright. `image/x-icon`/`vnd.microsoft.
 * icon`/`bmp`/`tiff` are kept as inert raster formats.
 */
const ALLOWED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/bmp',
  'image/tiff',
]);

/**
 * Normalize an upstream `Content-Type` (`image/png; charset=binary` ->
 * `image/png`) and return it only if it's an allowed image MIME — else
 * `undefined`, which the caller treats as "not an image, don't serve it".
 */
export function allowedImageContentType(rawContentType: string): string | undefined {
  const mime = rawContentType.split(';')[0]?.trim().toLowerCase();
  return mime && ALLOWED_IMAGE_MIME_TYPES.has(mime) ? mime : undefined;
}

/**
 * Build the 200 image response with the security/cache headers every served
 * image (cached or fresh) must carry: `X-Content-Type-Options: nosniff` so a
 * browser can't MIME-sniff the proxied bytes into something executable, plus
 * the 24h `Cache-Control`. `contentType` is always an already-allowlisted
 * image MIME by the time it reaches here.
 */
export function imageResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
