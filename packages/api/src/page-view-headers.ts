export const PAGE_VIEW_HEADERS = {
  'Content-Security-Policy':
    "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:; media-src *; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
} as const;
