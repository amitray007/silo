import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { type FileHandle, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
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

/** What a request is served from: the verified cache, or the download still in progress. */
export type TtsServe =
  | { kind: 'file'; file: TtsLocalFile }
  | {
      kind: 'live';
      size: number;
      sha256: string;
      /** The file's bytes as they arrive. It errors, and never completes, if the download fails. */
      body: ReadableStream<Uint8Array>;
    };

export type TtsFiles = {
  /** The manifest entry for a request path, or undefined when the file is not in the allowlist. */
  entry(engine: string, path: string): TtsFileEntry | undefined;
  /** The revision a file URL for this engine must carry, or undefined for an unknown engine. */
  revision(engine: string): string | undefined;
  /**
   * Open a manifest file for serving. A verified cached file comes back as a file. Otherwise the
   * first call starts the download from the pinned URL and every call returns a live stream of
   * it, so the browser sees bytes from the first one. Rejects with `TtsDownloadError` for a file
   * that is not in the manifest, or when the host fails before sending any data.
   */
  open(engine: string, path: string): Promise<TtsServe>;
  /** The verified local copy, waiting for the download to finish. Rejects with `TtsDownloadError`. */
  ensure(engine: string, path: string): Promise<TtsLocalFile>;
};

/** Stop a download that sends no bytes for this long. */
const STALL_MS = 60_000;
/** How much of the file one read hands to a client. */
const CHUNK = 256 * 1024;

/**
 * A URL revision for one engine: it changes whenever any pinned file does, so an immutable
 * browser cache can never hold a file that a later pin replaced (old URLs answer 404).
 */
function engineRevision(files: TtsManifest[string]): string {
  const hash = createHash('sha256');
  for (const path of Object.keys(files.files).sort()) {
    hash.update(`${path}\0${files.files[path]?.sha256}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

function asDownloadError(error: unknown): TtsDownloadError {
  if (error instanceof TtsDownloadError) return error;
  return new TtsDownloadError(error instanceof Error ? error.message : 'download failed');
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * One download. It writes a `.part` file while clients read the same file as it grows, and moves
 * it into place only when the size and sha256 match. Clients are never held up by each other,
 * and the download carries on when the first one leaves.
 */
class Download {
  written = 0;
  done = false;
  error: Error | undefined;
  followers = 0;
  private reader: FileHandle | undefined;
  private waiters = new Set<() => void>();
  readonly promise: Promise<void>;

  constructor(
    private readonly entry: TtsFileEntry,
    private readonly target: string,
    private readonly fetchImpl: typeof fetch,
    private readonly stallMs: number,
    private readonly onSettled: () => void,
  ) {
    this.promise = this.run();
    // The error is read through `error`; nobody else may leave it unhandled.
    this.promise.catch(() => undefined);
  }

  changed(): Promise<void> {
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  private wake(): void {
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiting) resolve();
  }

  /** Resolves once data has arrived (or the download has failed or finished). */
  async firstData(): Promise<void> {
    while (this.written === 0 && !this.done && !this.error) await this.changed();
  }

  async read(buffer: Buffer, position: number): Promise<number> {
    const { bytesRead } = await (this.reader as FileHandle).read(
      buffer,
      0,
      buffer.length,
      position,
    );
    return bytesRead;
  }

  /** The last client left a settled download: close what it kept open. */
  release(): void {
    this.followers -= 1;
    if (this.followers === 0 && (this.done || this.error))
      void this.reader?.close().catch(() => undefined);
  }

  /** Write the response to `writer`, checking the size on the way and the hash at the end. */
  private async receive(response: Response, writer: FileHandle, arm: () => void): Promise<void> {
    const { entry } = this;
    const hash = createHash('sha256');
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    for await (const chunk of body as AsyncIterable<Buffer>) {
      arm();
      if (this.written + chunk.length > entry.size) {
        throw new TtsDownloadError('the download is larger than its pinned size');
      }
      hash.update(chunk);
      await writer.write(chunk);
      this.written += chunk.length;
      this.wake();
    }
    if (this.written !== entry.size || hash.digest('hex') !== entry.sha256) {
      throw new TtsDownloadError('the downloaded file does not match its pinned hash');
    }
  }

  private async run(): Promise<void> {
    const part = `${this.target}.${randomUUID()}.part`;
    const abort = new AbortController();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(
        () => abort.abort(new TtsDownloadError('the model host stopped sending data')),
        this.stallMs,
      );
    };
    let writer: FileHandle | undefined;
    try {
      writer = await open(part, 'w');
      this.reader = await open(part, 'r');
      arm();
      const response = await this.fetchImpl(this.entry.url, { signal: abort.signal });
      if (!response.ok || !response.body) {
        throw new TtsDownloadError(`the model host answered ${response.status}`);
      }
      await this.receive(response, writer, arm);
      await writer.close();
      writer = undefined;
      await rename(part, this.target);
      this.done = true;
    } catch (error) {
      const failure = asDownloadError(abort.signal.reason ?? error);
      await writer?.close().catch(() => undefined);
      // Clean up first: a client that sees the error may look at the directory at once.
      await unlink(part).catch(() => undefined);
      this.error = failure;
    } finally {
      clearTimeout(stall);
      this.onSettled();
      this.wake();
      if (this.followers === 0) void this.reader?.close().catch(() => undefined);
    }
  }

  /**
   * The file's bytes as they arrive. The last byte is held back until the hash has been checked,
   * so a client that was promised the whole file never gets all of a file that failed its check.
   */
  follow(): ReadableStream<Uint8Array> {
    const size = this.entry.size;
    let position = 0;
    let open = true;
    this.followers += 1;
    const leave = () => {
      if (!open) return;
      open = false;
      this.release();
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        for (;;) {
          if (this.error) {
            leave();
            controller.error(this.error);
            return;
          }
          const available = this.done ? size : Math.min(this.written, size - 1);
          if (position < available) {
            const buffer = Buffer.allocUnsafe(Math.min(CHUNK, available - position));
            const got = await this.read(buffer, position);
            position += got;
            controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, got));
            return;
          }
          if (position >= size) {
            leave();
            controller.close();
            return;
          }
          await this.changed();
        }
      },
      cancel: leave,
    });
  }
}

/**
 * Serves model files from a download-once cache. Files are stored by their sha256 in `dir`, so a
 * request path never becomes a filesystem path. Only manifest entries exist; anything else is
 * unknown. `fetch` and `stallMs` are parameters so tests can point the manifest at a stub host.
 */
export function createTtsFiles({
  dir,
  manifest,
  fetch: fetchImpl = fetch,
  stallMs = STALL_MS,
}: {
  dir: string;
  manifest: TtsManifest;
  fetch?: typeof fetch;
  stallMs?: number;
}): TtsFiles {
  const inflight = new Map<string, Download>();
  /** Files whose bytes this process has checked against their sha256. */
  const trusted = new Set<string>();
  let prepared: Promise<void> | undefined;

  const entry = (engine: string, path: string): TtsFileEntry | undefined => {
    if (!Object.hasOwn(manifest, engine)) return undefined;
    const files = manifest[engine]?.files;
    return files && Object.hasOwn(files, path) ? files[path] : undefined;
  };

  const revision = (engine: string): string | undefined =>
    Object.hasOwn(manifest, engine)
      ? engineRevision(manifest[engine] as TtsManifest[string])
      : undefined;

  /** Once: make the directory and drop `.part` files a crashed process left behind. */
  const prepare = () => {
    prepared ??= (async () => {
      await mkdir(dir, { recursive: true });
      for (const name of await readdir(dir)) {
        if (name.endsWith('.part')) await unlink(join(dir, name)).catch(() => undefined);
      }
    })();
    return prepared;
  };

  /** A cached copy of the right size whose bytes match the pin (checked once per process). */
  const cached = async (found: TtsFileEntry, target: string): Promise<boolean> => {
    let size: number;
    try {
      size = (await stat(target)).size;
    } catch {
      return false;
    }
    if (size !== found.size) return false;
    if (trusted.has(found.sha256)) return true;
    if ((await sha256Of(target)) === found.sha256) {
      trusted.add(found.sha256);
      return true;
    }
    await unlink(target).catch(() => undefined);
    return false;
  };

  const start = (found: TtsFileEntry, target: string): Download => {
    const shared = inflight.get(found.sha256);
    if (shared) return shared;
    const task: Download = new Download(found, target, fetchImpl, stallMs, () => {
      if (inflight.get(found.sha256) === task) inflight.delete(found.sha256);
      if (task.done) trusted.add(found.sha256);
    });
    inflight.set(found.sha256, task);
    return task;
  };

  const prepareFor = async (engine: string, path: string) => {
    const found = entry(engine, path);
    if (!found) throw new TtsDownloadError('unknown model file');
    await prepare();
    return { found, target: join(dir, found.sha256) };
  };

  const open_ = async (engine: string, path: string): Promise<TtsServe> => {
    const { found, target } = await prepareFor(engine, path);
    if (await cached(found, target)) {
      return { kind: 'file', file: { path: target, size: found.size, sha256: found.sha256 } };
    }
    const task = start(found, target);
    // A host that fails before sending anything is a plain error, not a broken transfer.
    await task.firstData();
    if (task.error) throw task.error;
    return { kind: 'live', size: found.size, sha256: found.sha256, body: task.follow() };
  };

  const ensure = async (engine: string, path: string): Promise<TtsLocalFile> => {
    const { found, target } = await prepareFor(engine, path);
    const local: TtsLocalFile = { path: target, size: found.size, sha256: found.sha256 };
    if (await cached(found, target)) return local;
    const task = start(found, target);
    await task.promise;
    if (task.error) throw task.error;
    return local;
  };

  return { entry, revision, open: open_, ensure };
}
