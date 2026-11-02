import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTtsFiles, dataDir, TtsDownloadError, type TtsServe } from './files.js';
import type { TtsManifest } from './manifest.js';

const BODY = Buffer.from('voice model bytes '.repeat(500));
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let upstream: Server;
let origin = '';
let hits: string[] = [];
const ok: Handler = (_request, response) => {
  // A short delay makes concurrent requests overlap.
  setTimeout(() => {
    response.writeHead(200, { 'content-length': BODY.length });
    response.end(BODY);
  }, 30);
};
let handle: Handler = ok;
let dir = '';

beforeAll(async () => {
  upstream = createServer((request, response) => {
    hits.push(request.url ?? '');
    handle(request, response);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

beforeEach(async () => {
  hits = [];
  handle = ok;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read a live stream to its end: the bytes that arrived, and the error that cut it short. */
async function drain(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes: Buffer.concat(chunks), error: undefined };
      chunks.push(value);
    }
  } catch (error) {
    return { bytes: Buffer.concat(chunks), error: error as Error };
  }
}

function live(served: TtsServe) {
  if (served.kind !== 'live') throw new Error('expected a live download');
  return served.body;
}

describe('createTtsFiles', () => {
  it('downloads a listed file once and reuses the verified copy', async () => {
    const files = createTtsFiles({ dir, manifest: manifest() });
    const first = await files.ensure('phonon', 'model.bin');
    const second = await files.ensure('phonon', 'model.bin');
    expect(first.path).toBe(second.path);
    expect(first.size).toBe(BODY.length);
    expect(hits).toEqual(['/model.bin']);
    expect(await readdir(dir)).toEqual([sha(BODY)]);
    expect((await files.open('phonon', 'model.bin')).kind).toBe('file');
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
      await expect(files.open(engine, path)).rejects.toBeInstanceOf(TtsDownloadError);
    }
    expect(hits).toEqual([]);
  });

  it('rejects an upstream error before any data, leaves no file, and succeeds on a later retry', async () => {
    handle = (_request, response) => {
      response.writeHead(503, { 'content-length': 4 });
      response.end('down');
    };
    const files = createTtsFiles({ dir, manifest: manifest() });
    await expect(files.open('phonon', 'model.bin')).rejects.toThrow(/503/);
    await expect(files.ensure('phonon', 'model.bin')).rejects.toThrow(/503/);
    expect(await readdir(dir)).toEqual([]);
    handle = ok;
    await expect(files.ensure('phonon', 'model.bin')).resolves.toMatchObject({ size: BODY.length });
  });

  it('rejects when the upstream cannot be reached', async () => {
    const files = createTtsFiles({
      dir,
      manifest: manifest(),
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(files.open('phonon', 'model.bin')).rejects.toBeInstanceOf(TtsDownloadError);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('live downloads', () => {
  /** An upstream that sends the first half, waits for `release`, then sends the rest. */
  function split() {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handle = (_request, response) => {
      response.writeHead(200, { 'content-length': BODY.length });
      response.write(BODY.subarray(0, BODY.length / 2));
      void gate.then(() => response.end(BODY.subarray(BODY.length / 2)));
    };
    return release;
  }

  it('streams bytes to the client from the first one, before the download has finished', async () => {
    const release = split();
    const files = createTtsFiles({ dir, manifest: manifest() });
    const body = live(await files.open('phonon', 'model.bin'));
    const reader = body.getReader();
    const first = await reader.read();
    expect(first.value?.length).toBeGreaterThan(0);
    // Half the file is here and the rest is still upstream.
    expect(first.value?.length).toBeLessThan(BODY.length);
    release();
    const rest: Uint8Array[] = [first.value as Uint8Array];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value);
    }
    expect(Buffer.concat(rest).equals(BODY)).toBe(true);
    expect(await readdir(dir)).toEqual([sha(BODY)]);
  });

  it('gives every concurrent client the whole file from one upstream request', async () => {
    const release = split();
    const files = createTtsFiles({ dir, manifest: manifest() });
    const bodies = await Promise.all(
      [1, 2, 3].map(async () => live(await files.open('phonon', 'model.bin'))),
    );
    release();
    const results = await Promise.all(bodies.map(drain));
    for (const result of results) {
      expect(result.error).toBeUndefined();
      expect(result.bytes.equals(BODY)).toBe(true);
    }
    expect(hits).toHaveLength(1);
  });

  it('keeps downloading when the first client leaves', async () => {
    const release = split();
    const files = createTtsFiles({ dir, manifest: manifest() });
    const body = live(await files.open('phonon', 'model.bin'));
    await body.cancel();
    release();
    await expect(files.ensure('phonon', 'model.bin')).resolves.toMatchObject({ size: BODY.length });
    expect(hits).toHaveLength(1);
    expect(await readdir(dir)).toEqual([sha(BODY)]);
  });

  it('errors the stream and keeps nothing when the hash does not match', async () => {
    const files = createTtsFiles({
      dir,
      manifest: manifest({ sha256: sha(Buffer.from('other')) }),
    });
    const body = live(await files.open('phonon', 'model.bin'));
    const result = await drain(body);
    expect(result.error?.message).toMatch(/pinned hash/);
    // The last byte is held back, so the client was never handed a whole file.
    expect(result.bytes.length).toBeLessThan(BODY.length);
    await sleep(20);
    expect(await readdir(dir)).toEqual([]);
  });

  it('aborts a download larger than its pinned size', async () => {
    handle = (_request, response) => {
      response.writeHead(200);
      response.write(BODY);
      setTimeout(() => response.end(Buffer.from('extra')), 40);
    };
    const files = createTtsFiles({ dir, manifest: manifest() });
    const result = await drain(live(await files.open('phonon', 'model.bin')));
    expect(result.error?.message).toMatch(/larger than its pinned size/);
    expect(result.bytes.length).toBeLessThan(BODY.length);
    await sleep(20);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a single response bigger than the pinned size before sending anything', async () => {
    handle = (_request, response) => {
      response.writeHead(200);
      response.end(Buffer.concat([BODY, Buffer.from('extra')]));
    };
    const files = createTtsFiles({ dir, manifest: manifest() });
    await expect(files.open('phonon', 'model.bin')).rejects.toThrow(/larger than its pinned size/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('aborts a download that stops sending data', async () => {
    handle = (_request, response) => {
      response.writeHead(200, { 'content-length': BODY.length });
      response.write(BODY.subarray(0, 100));
      // Never finishes.
    };
    const files = createTtsFiles({ dir, manifest: manifest(), stallMs: 150 });
    const result = await drain(live(await files.open('phonon', 'model.bin')));
    expect(result.error?.message).toMatch(/stopped sending data/);
    expect(result.bytes.length).toBeLessThan(BODY.length);
    await sleep(20);
    expect(await readdir(dir)).toEqual([]);
    handle = ok;
    await expect(files.ensure('phonon', 'model.bin')).resolves.toMatchObject({ size: BODY.length });
  });

  it('deletes stale .part files on first use', async () => {
    await writeFile(join(dir, 'abc.123.part'), 'left behind');
    await writeFile(join(dir, 'keep.txt'), 'not a part file');
    const files = createTtsFiles({ dir, manifest: manifest() });
    await files.ensure('phonon', 'model.bin');
    expect((await readdir(dir)).sort()).toEqual([sha(BODY), 'keep.txt'].sort());
  });

  it('does not trust a cached file of the right size whose bytes differ', async () => {
    await writeFile(join(dir, sha(BODY)), Buffer.alloc(BODY.length, 1));
    const files = createTtsFiles({ dir, manifest: manifest() });
    const result = await files.open('phonon', 'model.bin');
    expect(result.kind).toBe('live');
    await drain(live(result));
    // The next open reads the verified copy and does not download again.
    expect((await files.open('phonon', 'model.bin')).kind).toBe('file');
    expect(hits).toHaveLength(1);
  });
});

describe('revision', () => {
  it('is stable, and changes when any pin changes', () => {
    const a = createTtsFiles({ dir, manifest: manifest() }).revision('phonon');
    const b = createTtsFiles({ dir, manifest: manifest() }).revision('phonon');
    const c = createTtsFiles({
      dir,
      manifest: manifest({ sha256: sha(Buffer.from('new pin')) }),
    }).revision('phonon');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('is undefined for an engine that is not in the manifest', () => {
    const files = createTtsFiles({ dir, manifest: manifest() });
    expect(files.revision('nope')).toBeUndefined();
    expect(files.revision('__proto__')).toBeUndefined();
  });
});
