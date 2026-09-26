import type { Context } from 'hono';

const CSRF_HEADER_NAME = 'x-silo-csrf';
const CSRF_HEADER_VALUE = '1';
export function csrfFailure(c: Context): Response | null {
  if (c.req.header(CSRF_HEADER_NAME) === CSRF_HEADER_VALUE) return null;
  return c.json(
    { error: 'csrf_required', message: 'X-Silo-CSRF: 1 is required for this request.' },
    403,
  );
}

export function isUnsafeRequest(c: Context): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
}
