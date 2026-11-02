import type { MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';

const compressResponse = compress({
  contentTypeFilter:
    /^(?:text\/(?:html|css|javascript)|application\/(?:json|javascript)|image\/svg\+xml)(?:;|$)/i,
});

export const compression: MiddlewareHandler = async (c, next) => {
  const json = c.json as (...args: unknown[]) => Response;
  let jsonBody: ReadableStream | null | undefined;
  c.json = ((...args: unknown[]) => {
    const response = json(...args);
    jsonBody = response.body;
    return response;
  }) as typeof c.json;
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
  // c.json has already serialized its whole body; never read an arbitrary response stream.
  if (jsonBody && c.res.body === jsonBody && !c.res.headers.has('Content-Length')) {
    const body = await c.res.arrayBuffer();
    c.res = new Response(body, c.res);
    c.res.headers.set('Content-Length', String(body.byteLength));
  }
  await compressResponse(c, async () => {});
};
