import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTtsFiles, type TtsManifest } from '@silo/core';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRange, registerTtsRoutes } from './tts.js';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

const BODY = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
const sha256 = createHash('sha256').update(BODY).digest('hex');

let upstream: Server;
let origin = '';
let status = 200;
let requests = 0;
let dir = '';

beforeAll(async () => {
  upstream = createServer((_request, response) => {
    requests += 1;
    response.writeHead(status, { 'content-length': status === 200 ? BODY.length : 4 });
    response.end(status === 200 ? BODY : 'down');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

beforeEach(async () => {
  status = 200;
  requests = 0;
  dir = await mkdtemp(join(tmpdir(), 'silo-tts-api-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

let revision = '';

function appWith(overrides: { sha256?: string } = {}): Hono {
  const manifest: TtsManifest = {
    phonon: {
      label: 'Phonon',
      license: 'Apache-2.0',
      files: {
        'model.q8.gguf': {
          url: `${origin}/m`,
          size: BODY.length,
          sha256: overrides.sha256 ?? sha256,
        },
        'config.json': { url: `${origin}/c`, size: BODY.length, sha256 },
        'voices/Zoe y.safetensors': { url: `${origin}/v`, size: BODY.length, sha256 },
      },
    },
  };
  const api = new Hono();
  const files = createTtsFiles({ dir, manifest });
  revision = files.revision('phonon') ?? '';
  registerTtsRoutes(api, files);
  return new Hono().route('/api', api);
}

const get = (app: Hono, path: string, headers: Record<string, string> = {}) =>
  app.request(`/api/tts/files/phonon/${revision}/${path}`, { headers });

describe('GET /api/tts/files/:engine/:revision/*', () => {
  it('serves a manifest file with immutable cache headers', async () => {
    const res = await get(appWith(), 'model.q8.gguf');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY)).toBe(true);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toBe(`"${sha256}"`);
    expect(res.headers.get('content-length')).toBe(String(BODY.length));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves JSON files as JSON and decodes encoded names', async () => {
    const app = appWith();
    expect((await get(app, 'config.json')).headers.get('content-type')).toMatch(
      /^application\/json/,
    );
    expect((await get(app, 'voices/Zoe%20y.safetensors')).status).toBe(200);
  });

  it('downloads once and then reads the cache', async () => {
    const app = appWith();
    await get(app, 'model.q8.gguf');
    await get(app, 'model.q8.gguf');
    expect(requests).toBe(1);
  });

  it('answers a byte range with 206 and the matching Content-Range', async () => {
    const app = appWith();
    await (await get(app, 'model.q8.gguf')).arrayBuffer();
    const res = await get(app, 'model.q8.gguf', { Range: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 10-19/${BODY.length}`);
    expect(res.headers.get('content-length')).toBe('10');
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY.subarray(10, 20))).toBe(true);
  });

  it('answers open-ended and suffix ranges', async () => {
    const app = appWith();
    await (await get(app, 'model.q8.gguf')).arrayBuffer();
    const open = await get(app, 'model.q8.gguf', { Range: 'bytes=990-' });
    expect(open.headers.get('content-range')).toBe(`bytes 990-999/${BODY.length}`);
    const tail = await get(app, 'model.q8.gguf', { Range: 'bytes=-5' });
    expect(Buffer.from(await tail.arrayBuffer()).equals(BODY.subarray(995))).toBe(true);
  });

  it('answers 416 for a range past the end', async () => {
    const app = appWith();
    await (await get(app, 'model.q8.gguf')).arrayBuffer();
    const res = await get(app, 'model.q8.gguf', { Range: `bytes=${BODY.length}-` });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${BODY.length}`);
  });

  it('answers 304 when the ETag matches', async () => {
    const app = appWith();
    await (await get(app, 'model.q8.gguf')).arrayBuffer();
    const res = await get(app, 'model.q8.gguf', { 'If-None-Match': `"${sha256}"` });
    expect(res.status).toBe(304);
  });

  it('answers 404 for anything outside the manifest, with no download', async () => {
    const app = appWith();
    for (const path of [
      'nope.bin',
      '../model.q8.gguf',
      '..%2F..%2Fetc%2Fpasswd',
      '%2e%2e/model.q8.gguf',
      '%zz',
    ]) {
      const res = await get(app, path);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe('not_found');
    }
    expect((await app.request('/api/tts/files/other/x/model.q8.gguf')).status).toBe(404);
    expect(requests).toBe(0);
  });

  it('answers 502 when the download fails and leaves no partial file', async () => {
    status = 503;
    const res = await get(appWith(), 'model.q8.gguf');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('upstream_failed');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('revision in the URL', () => {
  it('serves only URLs that carry the current revision; old and unversioned URLs are 404', async () => {
    const app = appWith();
    for (const url of [
      '/api/tts/files/phonon/model.q8.gguf',
      '/api/tts/files/phonon/000000000000/model.q8.gguf',
      `/api/tts/files/phonon/${revision}x/model.q8.gguf`,
    ]) {
      expect((await app.request(url)).status).toBe(404);
    }
    expect(requests).toBe(0);
  });
});

describe('streaming the first download', () => {
  it('sends Content-Length and ETag with the first bytes, then serves ranges from the cache', async () => {
    const app = appWith();
    const first = await get(app, 'model.q8.gguf');
    expect(first.headers.get('content-length')).toBe(String(BODY.length));
    expect(first.headers.get('etag')).toBe(`"${sha256}"`);
    expect(Buffer.from(await first.arrayBuffer()).equals(BODY)).toBe(true);
    const range = await get(app, 'model.q8.gguf', { Range: 'bytes=0-3' });
    expect(range.status).toBe(206);
    expect(requests).toBe(1);
  });

  it('breaks the transfer, and keeps no file, when the hash does not match', async () => {
    const app = appWith({ sha256: createHash('sha256').update('other').digest('hex') });
    const res = await get(app, 'model.q8.gguf');
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toBeDefined();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('parseRange', () => {
  it('reads one byte range and ignores other forms', () => {
    expect(parseRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 });
    expect(parseRange('bytes=5-100', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseRange('items=0-1', 10)).toBeNull();
    expect(parseRange('bytes=5-2', 10)).toBeNull();
  });
});

describe('GET /api/tts/manifest (the real manifest)', () => {
  it('lists both engines, their licenses and sha256 pins, without upstream URLs', async () => {
    const { createApp } = await import('../app.js');
    const res = await createApp().request('/api/tts/manifest');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('huggingface.co');
    const json = JSON.parse(text) as {
      engines: Record<
        string,
        { license: string; files: Record<string, { sha256: string; size: number }> }
      >;
    };
    expect(Object.keys(json.engines).sort()).toEqual(['kokoro', 'phonon']);
    for (const engine of Object.values(json.engines)) {
      expect(engine.license).toBe('Apache-2.0');
      expect((engine as { revision?: string }).revision).toMatch(/^[0-9a-f]{12}$/);
      for (const file of Object.values(engine.files)) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.size).toBeGreaterThan(0);
      }
    }
    expect(json.engines.phonon?.files['model.q8.gguf']).toBeDefined();
    expect(json.engines.kokoro?.files['onnx/model_quantized.onnx']).toBeDefined();
  });

  it('refuses a path that is not in the real manifest without any download', async () => {
    const { createApp } = await import('../app.js');
    const res = await createApp().request('/api/tts/files/phonon/model.safetensors');
    expect(res.status).toBe(404);
  });
});
