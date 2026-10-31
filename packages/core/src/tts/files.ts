import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TtsFileEntry, TtsManifest } from './manifest.js';

/**
 * Silo's data directory: where it keeps files that are not in Postgres. `SILO_DATA_DIR` when set,
 * else the app's state directory (`$XDG_STATE_HOME/silo`, or `~/.local/state/silo`). The
 * containers set it to a mounted volume.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.SILO_DATA_DIR;
  if (set !== undefined && set !== '') return resolve(set);
  const state = env.XDG_STATE_HOME;
  const base = state !== undefined && state !== '' ? state : join(homedir(), '.local', 'state');
  return join(base, 'silo');
}

/** A model file that could not be fetched or did not match its pinned hash. */
export class TtsDownloadError extends Error {
  readonly code = 'tts_download_failed';
}

/** A verified local copy of a manifest file. */
export type TtsLocalFile = { path: string; size: number; sha256: string };

export type TtsFiles = {
  /** The manifest entry for a request path, or undefined when the file is not in the allowlist. */
  entry(engine: string, path: string): TtsFileEntry | undefined;
  /**
   * The verified local copy of a manifest file. The first call downloads it from its pinned URL;
   * calls that arrive meanwhile share that one download. Rejects with `TtsDownloadError`, and
   * leaves no partial file behind.
   */
  ensure(engine: string, path: string): Promise<TtsLocalFile>;
};

/** The longest one file may take to download. */
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

async function sizeOnDisk(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/**
 * Stream `entry.url` into a temporary file beside `target`, check size and sha256 on the way,
 * and move it into place only when both match.
 */
async function download(entry: TtsFileEntry, target: string, fetchImpl: typeof fetch) {
  const partial = `${target}.${randomUUID()}.part`;
  try {
    const response = await fetchImpl(entry.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      throw new TtsDownloadError(`the model host answered ${response.status}`);
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    await pipeline(body, createWriteStream(partial));
    if (bytes !== entry.size || hash.digest('hex') !== entry.sha256) {
      throw new TtsDownloadError('the downloaded file does not match its pinned hash');
    }
    await rename(partial, target);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error instanceof TtsDownloadError
      ? error
      : new TtsDownloadError(error instanceof Error ? error.message : 'download failed');
  }
}

/**
 * Serves model files from a download-once cache. Files are stored by their sha256 in `dir`, so a
 * request path never becomes a filesystem path. Only manifest entries exist; anything else is
 * unknown. `fetch` is a parameter so tests can point the manifest at a stub host.
 */
export function createTtsFiles({
  dir,
  manifest,
  fetch: fetchImpl = fetch,
}: {
  dir: string;
  manifest: TtsManifest;
  fetch?: typeof fetch;
}): TtsFiles {
  const inflight = new Map<string, Promise<TtsLocalFile>>();

  const entry = (engine: string, path: string): TtsFileEntry | undefined => {
    if (!Object.hasOwn(manifest, engine)) return undefined;
    const files = manifest[engine]?.files;
    return files && Object.hasOwn(files, path) ? files[path] : undefined;
  };

  const ensure = async (engine: string, path: string): Promise<TtsLocalFile> => {
    const found = entry(engine, path);
    if (!found) throw new TtsDownloadError('unknown model file');
    const target = join(dir, found.sha256);
    const local: TtsLocalFile = { path: target, size: found.size, sha256: found.sha256 };
    if ((await sizeOnDisk(target)) === found.size) return local;
    const shared = inflight.get(found.sha256);
    if (shared) return shared;
    const started = (async () => {
      try {
        await mkdir(dir, { recursive: true });
        await download(found, target, fetchImpl);
        return local;
      } finally {
        inflight.delete(found.sha256);
      }
    })();
    inflight.set(found.sha256, started);
    return started;
  };

  return { entry, ensure };
}
