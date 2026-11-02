import { createHash } from 'node:crypto';

export function withETag(
  response: Response,
  bytes: string | Uint8Array,
  ifNoneMatch: string | undefined,
): Response {
  const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
  response.headers.set('ETag', etag);
  const matches = ifNoneMatch?.split(',').some((tag) => {
    const value = tag.trim();
    return value === '*' || value.replace(/^W\//, '') === etag;
  });
  if (!matches) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(null, { status: 304, headers });
}
