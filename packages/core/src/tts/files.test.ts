import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTtsFiles, dataDir, TtsDownloadError } from './files.js';
import type { TtsManifest } from './manifest.js';

const BODY = Buffer.from('voice model bytes '.repeat(500));
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

let upstream: Server;
let origin = '';
let hits: string[] = [];
let respond: (path: string) => { status: number; body: Buffer } = () => ({
  status: 200,
  body: BODY,
});
let dir = '';

beforeAll(async () => {
  upstream = createServer((request, response) => {
    hits.push(request.url ?? '');
    const { status, body } = respond(request.url ?? '');
    // A short delay makes concurrent requests overlap.
    setTimeout(() => {
      response.writeHead(status, { 'content-length': body.length });
      response.end(body);
    }, 30);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

beforeEach(async () => {
  hits = [];
  respond = () => ({ status: 200, body: BODY });
  dir = await mkdtemp(join(tmpdir(), 'silo-tts-'));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

function manifest(overrides: { sha256?: string; size?: number } = {}): TtsManifest {
  return {
    phonon: {
      label: 'Phonon',
      license: 'Apache-2.0',
      files: {
        'model.bin': {
          url: `${origin}/model.bin`,
          size: overrides.size ?? BODY.length,
          sha256: overrides.sha256 ?? sha(BODY),
        },
        'voices/a.safetensors': { url: `${origin}/a`, size: BODY.length, sha256: sha(BODY) },
      },
    },
  };
}

describe('dataDir', () => {
  it('prefers SILO_DATA_DIR', () => {
    expect(dataDir({ SILO_DATA_DIR: '/srv/silo', XDG_STATE_HOME: '/x' })).toBe('/srv/silo');
  });
  it('falls back to the XDG state directory', () => {
    expect(dataDir({ XDG_STATE_HOME: '/state' })).toBe(join('/state', 'silo'));
  });
  it('ends in ~/.local/state/silo by default', () => {
    expect(dataDir({}).endsWith(join('.local', 'state', 'silo'))).toBe(true);
  });
  it('ignores an empty SILO_DATA_DIR', () => {
    expect(dataDir({ SILO_DATA_DIR: '', XDG_STATE_HOME: '/state' })).toBe(join('/state', 'silo'));
  });
});

describe('createTtsFiles', () => {
  it('downloads a listed file once and reuses the verified copy', async () => {
    const files = createTtsFiles({ dir, manifest: manifest() });
    const first = await files.ensure('phonon', 'model.bin');
    const second = await files.ensure('phonon', 'model.bin');
    expect(first.path).toBe(second.path);
    expect(first.size).toBe(BODY.length);
    expect(hits).toEqual(['/model.bin']);
    expect(await readdir(dir)).toEqual([sha(BODY)]);
  });

  it('shares one download between concurrent first requests', async () => {
    const files = createTtsFiles({ dir, manifest: manifest() });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => files.ensure('phonon', 'model.bin')),
    );
    expect(new Set(results.map((result) => result.path)).size).toBe(1);
    expect(hits).toHaveLength(1);
  });

  it('knows only manifest entries and never turns a request path into a file path', async () => {
    const files = createTtsFiles({ dir, manifest: manifest() });
    for (const [engine, path] of [
      ['phonon', '../../etc/passwd'],
      ['phonon', 'voices/../model.bin'],
      ['phonon', '/model.bin'],
      ['phonon', 'model.bin/'],
      ['phonon', '__proto__'],
      ['phonon', 'constructor'],
      ['nope', 'model.bin'],
      ['__proto__', 'model.bin'],
    ] as const) {
      expect(files.entry(engine, path)).toBeUndefined();
      await expect(files.ensure(engine, path)).rejects.toBeInstanceOf(TtsDownloadError);
    }
    expect(hits).toEqual([]);
  });

  it('rejects a download whose sha256 does not match and leaves no file', async () => {
    const files = createTtsFiles({
      dir,
      manifest: manifest({ sha256: sha(Buffer.from('other')) }),
    });
    await expect(files.ensure('phonon', 'model.bin')).rejects.toThrow(/pinned hash/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects a download whose size does not match and leaves no file', async () => {
    const files = createTtsFiles({ dir, manifest: manifest({ size: BODY.length + 1 }) });
    await expect(files.ensure('phonon', 'model.bin')).rejects.toBeInstanceOf(TtsDownloadError);
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects an upstream error, leaves no file, and succeeds on a later retry', async () => {
    respond = () => ({ status: 503, body: Buffer.from('down') });
    const files = createTtsFiles({ dir, manifest: manifest() });
    await expect(files.ensure('phonon', 'model.bin')).rejects.toThrow(/503/);
    expect(await readdir(dir)).toEqual([]);
    respond = () => ({ status: 200, body: BODY });
    await expect(files.ensure('phonon', 'model.bin')).resolves.toMatchObject({ size: BODY.length });
  });

  it('rejects when the upstream cannot be reached', async () => {
    const files = createTtsFiles({
      dir,
      manifest: manifest(),
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(files.ensure('phonon', 'model.bin')).rejects.toBeInstanceOf(TtsDownloadError);
    expect(await readdir(dir)).toEqual([]);
  });
});
