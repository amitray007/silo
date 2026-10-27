import { VIEW_SCROLL_SCRIPT_HASH } from '@silo/core/view-scroll';

/** The copy may run only silo's hash-pinned scroll reporter, on an opaque origin. */
export const PAGE_VIEW_HEADERS = {
  'Content-Security-Policy': `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src '${VIEW_SCROLL_SCRIPT_HASH}'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:; media-src *; frame-ancestors 'self'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
} as const;
