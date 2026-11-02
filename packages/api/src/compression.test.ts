import { gunzipSync, inflateSync } from 'node:zlib';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { compression } from './compression.js';

const body = 'A page of repeated article text. '.repeat(100);
const headers = { 'Accept-Encoding': 'gzip, deflate' };

function responseApp(contentType: string, extra: Record<string, string> = {}) {
  return new Hono()
    .use('*', compression)
    .get('/', () => new Response(body, { headers: { 'Content-Type': contentType, ...extra } }));
}

describe('API compression', () => {
  it.each([201, 400, 500])('compresses JSON responses with status %i', async (status) => {
    const app = new Hono()
      .use('*', compression)
      .get(
        '/',
        () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
      );
    const res = await app.request('/', { headers });
    expect(res.status).toBe(status);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(body);
  });

  it.each([
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/json',
    'image/svg+xml',
  ])('compresses %s and preserves the decoded bytes', async (type) => {
    const res = await responseApp(type).request('/', { headers });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toContain('Accept-Encoding');
    const encoded = Buffer.from(await res.arrayBuffer());
    expect(encoded.length).toBeLessThan(Buffer.byteLength(body));
    expect(gunzipSync(encoded).toString()).toBe(body);
  });

  it('negotiates deflate, identity, and disabled encodings', async () => {
    const app = responseApp('application/json');
    const res = await app.request('/', { headers: { 'Accept-Encoding': 'deflate' } });
    expect(res.headers.get('content-encoding')).toBe('deflate');
    expect(inflateSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(body);
    for (const encoding of [undefined, 'identity', 'gzip;q=0, deflate;q=0']) {
      const plain = await app.request('/', {
        headers: encoding ? { 'Accept-Encoding': encoding } : {},
      });
      expect(plain.headers.get('content-encoding')).toBeNull();
      expect(await plain.text()).toBe(body);
    }
  });

  it.each([
    'image/png',
    'image/jpeg',
    'audio/mpeg',
    'video/mp4',
    'application/octet-stream',
    'text/event-stream',
    'application/x-ndjson',
  ])('keeps %s bytes unchanged', async (type) => {
    const res = await responseApp(type).request('/', { headers });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(body);
  });

  it.each([
    { 'Content-Encoding': 'br' },
    { 'Transfer-Encoding': 'chunked' },
    { 'Content-Range': 'bytes 0-3199/6400' },
    { 'Cache-Control': 'no-transform' },
  ])('preserves encoded, streamed and partial responses: %j', async (extra) => {
    const res = await responseApp('application/json', extra).request('/', { headers });
    expect(res.headers.get('content-encoding')).toBe(extra['Content-Encoding'] ?? null);
    expect(await res.text()).toBe(body);
  });

  it('does not transform range requests even if the response is 200', async () => {
    const res = await responseApp('application/json').request('/', {
      headers: { ...headers, Range: 'bytes=0-' },
    });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(body);
  });

  it('removes the original length and keeps existing Vary fields', async () => {
    const res = await responseApp('text/html', {
      'Content-Length': String(Buffer.byteLength(body)),
      Vary: 'Origin',
      ETag: '"original"',
    }).request('/', { headers });
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('vary')).toBe('Origin, Accept-Encoding');
    expect(res.headers.get('etag')).toBe('W/"original"');
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(body);
  });
});
