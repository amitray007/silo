import type { MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';

const compressResponse = compress({
  contentTypeFilter:
    /^(?:text\/(?:html|css|javascript)|application\/(?:json|javascript)|image\/svg\+xml)(?:;|$)/i,
});

export const compression: MiddlewareHandler = async (c, next) => {
  await next();
  // Model JSON is streamed too; its manifest byte counts and hashes must stay exact.
  if (
    c.req.path.startsWith('/api/tts/files/') ||
    c.req.header('Range') !== undefined ||
    c.res.headers.has('Content-Range') ||
    c.res.status === 206
  ) {
    return;
  }
  await compressResponse(c, async () => {});
};
