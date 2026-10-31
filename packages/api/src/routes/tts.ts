import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  createTtsFiles,
  dataDir,
  TTS_MANIFEST,
  TtsDownloadError,
  type TtsFileEntry,
  type TtsFiles,
  type TtsLocalFile,
} from '@silo/core';
import type { Context, Hono } from 'hono';

/**
 * Read aloud model files (reader tools, slice 4). The browser runs the voice models, so it needs
 * their weights, and it must not call Hugging Face to get them. `GET /api/tts/files/:engine/*`
 * serves only files in the pinned manifest: the first request downloads the file into the data
 * directory (`tts-cache/`), checks its sha256, and serves it; later requests read the cache.
 * `GET /api/tts/manifest` lists what can be served, without the upstream URLs.
 */

const IMMUTABLE = 'public, max-age=31536000, immutable';

function notFound(c: Context) {
  return c.json({ error: 'not_found', message: 'No such model file' }, 404);
}

/** One `bytes=` range over a file of `size` bytes: inclusive start and end, or why not. */
export function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Not a single byte range (or not bytes at all): ignore it and serve the whole file.
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? null : { start, end };
}

function contentType(path: string): string {
  return path.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream';
}

/** The manifest path a request names, or null when it is not valid text. */
function requestedPath(c: Context, engine: string): string | null {
  const prefix = `/api/tts/files/${engine}/`;
  const raw = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
  try {
    return raw.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/** The verified file as a response: whole, partial (206), not modified (304) or unsatisfiable (416). */
function fileResponse(c: Context, local: TtsLocalFile, path: string): Response {
  const etag = `"${local.sha256}"`;
  const base = {
    'Cache-Control': IMMUTABLE,
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType(path),
    'X-Content-Type-Options': 'nosniff',
  };
  if (c.req.header('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: base });
  }
  const requested = c.req.header('range');
  const range = requested ? parseRange(requested, local.size) : null;
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${local.size}` },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? local.size - 1;
  const body = Readable.toWeb(createReadStream(local.path, { start, end })) as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...base,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${local.size}` } : {}),
    },
  });
}

function manifestJson() {
  const engines = Object.entries(TTS_MANIFEST).map(([id, engine]) => {
    const files = Object.entries(engine.files as Record<string, TtsFileEntry>).map(
      ([path, entry]) => [
        path,
        { size: entry.size, sha256: entry.sha256, ...(entry.voice ? { voice: entry.voice } : {}) },
      ],
    );
    return [id, { label: engine.label, license: engine.license, files: Object.fromEntries(files) }];
  });
  return { engines: Object.fromEntries(engines) };
}

export function registerTtsRoutes(api: Hono, files?: TtsFiles): void {
  // Built on first use, so the data directory is read when a model is first asked for.
  let store = files;
  const filesNow = (): TtsFiles =>
    (store ??= createTtsFiles({ dir: join(dataDir(), 'tts-cache'), manifest: TTS_MANIFEST }));

  api.get('/tts/manifest', (c) => c.json(manifestJson()));

  api.get('/tts/files/:engine/*', async (c) => {
    const engine = c.req.param('engine');
    const path = requestedPath(c, engine);
    const found = filesNow();
    if (path === null || !found.entry(engine, path)) return notFound(c);
    try {
      return fileResponse(c, await found.ensure(engine, path), path);
    } catch (error) {
      if (!(error instanceof TtsDownloadError)) throw error;
      console.error('[silo/api] model file download failed:', engine, path, error.message);
      return c.json(
        { error: 'upstream_failed', message: 'The model file could not be downloaded' },
        502,
      );
    }
  });
}
