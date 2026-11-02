import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createApp } from './app.js';

const html = `<html><body>${'The app shell. '.repeat(150)}</body></html>`;
const script = 'console.log("silo");'.repeat(100);
let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/silo_placeholder');
  dir = mkdtempSync(join(tmpdir(), 'silo-transfer-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, 'assets', 'index-Ab_cd-12.js'), script);
  writeFileSync(join(dir, 'assets', 'styles-Xy123456.css'), 'body { color: red; }');
  writeFileSync(join(dir, 'assets', 'unhashed.js'), script);
  vi.stubEnv('SILO_WEB_DIST', dir);
  app = (await import('./app.js')).createApp();
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('web cache headers', () => {
  it.each(['/assets/index-Ab_cd-12.js', '/assets/styles-Xy123456.css'])(
    'serves hashed %s with one-year immutable caching',
    async (path) => {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    },
  );

  it('does not mark unhashed or missing assets immutable', async () => {
    for (const [path, status] of [
      ['/assets/unhashed.js', 200],
      ['/assets/missing-12345678.js', 404],
    ] as const) {
      const res = await app.request(path);
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control') ?? '').not.toContain('immutable');
    }
  });

  it.each(['/', '/index.html', '/feeds/example', '/tags/example'])(
    'revalidates the shell at %s and returns an empty 304',
    async (path) => {
      const first = await app.request(path);
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-cache');
      const etag = first.headers.get('etag');
      expect(etag).toMatch(/^"[a-f0-9]+"$/);
      expect(await first.text()).toBe(html);
      const second = await app.request(path, { headers: { 'If-None-Match': etag ?? '' } });
      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
      expect(second.headers.get('cache-control')).toBe('no-cache');
      expect(await second.text()).toBe('');
    },
  );

  it('picks up a changed shell without restarting the app', async () => {
    const first = await app.request('/index.html');
    writeFileSync(join(dir, 'index.html'), `${html}<!-- redeployed -->`);
    try {
      const next = await app.request('/index.html', {
        headers: { 'If-None-Match': first.headers.get('etag') ?? '' },
      });
      expect(next.status).toBe(200);
      expect(next.headers.get('etag')).not.toBe(first.headers.get('etag'));
      expect(await next.text()).toContain('redeployed');
    } finally {
      writeFileSync(join(dir, 'index.html'), html);
    }
  });

  it('revalidates gzip shell responses with weak or listed validators', async () => {
    const first = await app.request('/', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(first.headers.get('content-encoding')).toBe('gzip');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\//);
    expect(gunzipSync(Buffer.from(await first.arrayBuffer())).toString()).toBe(html);
    for (const validator of [etag ?? '', `"old", ${etag}`, '*']) {
      const second = await app.request('/', {
        headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': validator },
      });
      expect(second.status).toBe(304);
      expect(second.headers.get('cache-control')).toBe('no-cache');
      expect(second.headers.get('content-encoding')).toBeNull();
      expect(second.headers.get('vary')).toContain('Accept-Encoding');
      expect(await second.text()).toBe('');
    }
  });

  it('compresses the served JS asset when requested', async () => {
    const res = await app.request('/assets/index-Ab_cd-12.js', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(script);
  });
});
