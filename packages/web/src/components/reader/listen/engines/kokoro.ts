import { KOKORO_MODEL_FILE, KOKORO_SMALL_FILES, KOKORO_WEBGPU_DTYPE } from './files';
import { fetchTtsManifest, ttsFilesBase } from './manifest';
import { progressTracker, type TtsEngine, type Voice } from './types';

/**
 * After an abort, the generation in the worker may finish on its own. Wait this long for it
 * before the worker is stopped and reloaded (a reload costs a second or more).
 */
const STALE_MS = 750;

type VoiceInfo = { name: string; language: string; gender: string };
type Progress = { status?: string; file?: string; loaded?: number; total?: number };
type Ready = { device: string; dtype: string; voices: Record<string, VoiceInfo> };
type Reply =
  | { type: 'progress'; info: Progress }
  | ({ type: 'ready' } & Ready)
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string };

type Pending = {
  resolve: (value: { samples: Float32Array; sampleRate: number }) => void;
  reject: (error: Error) => void;
};

/** One Kokoro worker, with the model loaded once. */
type Channel = {
  worker: Worker;
  pending: Map<number, Pending>;
  ready: Promise<Ready>;
  /** Settles when the request ahead of the next one has finished: the worker does one at a time. */
  tail: Promise<void>;
  /** Reject the load and every request waiting on this worker. */
  fail(error: Error): void;
};

function startWorker(
  filesBase: string,
  onProgress: (info: Progress) => void,
  webgpuDtype: string | null,
): Channel {
  const worker = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  let reject: (error: Error) => void = () => {};
  const ready = new Promise<Ready>((resolve, rejectReady) => {
    reject = rejectReady;
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.type === 'progress') onProgress(reply.info);
      else if (reply.type === 'ready') resolve(reply);
      else if (reply.type === 'audio') {
        pending.get(reply.id)?.resolve(reply);
        pending.delete(reply.id);
      } else if (reply.id === undefined) rejectReady(new Error(reply.message));
      else {
        pending.get(reply.id)?.reject(new Error(reply.message));
        pending.delete(reply.id);
      }
    };
  });
  const fail = (error: Error) => {
    reject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  // A worker that crashes or cannot start must fail its load and its requests, not hang them.
  worker.onerror = (event) => fail(new Error(event.message || 'The voice worker crashed'));
  worker.onmessageerror = () =>
    fail(new Error('The voice worker sent a message that could not be read'));
  worker.postMessage({ type: 'load', filesBase, webgpuDtype });
  return { worker, pending, ready, tail: Promise.resolve(), fail };
}

/** Kokoro 82M in a module Web Worker that silo owns. */
export function createKokoroEngine(): TtsEngine {
  let channel: Channel | undefined;
  let voiceInfo: Record<string, VoiceInfo> = {};
  let sequence = 0;
  let disposed = false;
  // What a restarted worker needs to load the same model again.
  let restart: { filesBase: string; dtype: string | null } | undefined;

  /** Stop generation that nobody wants. The model reloads from the browser cache. */
  const replace = (stale: Channel) => {
    if (channel !== stale || disposed || !restart) return;
    stale.worker.terminate();
    stale.fail(new Error('Stopped'));
    channel = startWorker(restart.filesBase, () => {}, restart.dtype);
    // A failed reload is reported by the next request that waits on it.
    channel.ready.catch(() => undefined);
  };

  /**
   * Wait for the worker (it does one request at a time) and take the next turn on it. If the
   * worker is replaced while waiting, the turn moves to the new one.
   */
  const takeTurn = async (): Promise<{ current: Channel; release: () => void }> => {
    for (;;) {
      const current = channel;
      if (!current) throw new Error('The voice model was closed');
      await current.ready;
      let release: () => void = () => {};
      const ahead = current.tail;
      current.tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await ahead;
      if (channel === current) return { current, release };
      release();
    }
  };

  /**
   * A request nobody wants any more. Its generation may still finish soon, and its result is
   * dropped; the worker restarts only if it is still busy after STALE_MS.
   */
  const abandon = (stale: Channel, result: Promise<unknown>) => {
    const timer = setTimeout(() => replace(stale), STALE_MS);
    const done = () => clearTimeout(timer);
    result.then(done, done);
  };

  const engine: TtsEngine = {
    id: 'kokoro',
    supportsSpeed: true,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      const manifest = await fetchTtsManifest();
      const filesBase = ttsFilesBase(manifest, 'kokoro');
      const files = manifest.engines.kokoro.files;
      /** Progress over the files this dtype loads, sized from the manifest. */
      const trackFor = (dtype: string | null) => {
        const model = KOKORO_MODEL_FILE[dtype === null ? 'q8' : 'fp32'];
        const sizes = Object.fromEntries(
          [model, ...KOKORO_SMALL_FILES].map((path) => [path, files[path]?.size ?? 0]),
        );
        return progressTracker<Progress>(onProgress, sizes, (info) => {
          if (!info.file) return null;
          if (info.status === 'done') return [info.file, sizes[info.file] ?? 0];
          return info.status === 'progress' ? [info.file, info.loaded ?? 0] : null;
        });
      };
      let dtype: string | null = KOKORO_WEBGPU_DTYPE;
      let info: Ready;
      try {
        channel = startWorker(filesBase, trackFor(dtype), dtype);
        info = await channel.ready;
      } catch (error) {
        if (disposed) throw error;
        // The GPU run failed to start. ONNX Runtime keeps that failure, so WebAssembly gets a
        // fresh worker (and a fresh progress total: q8 is a different file).
        channel?.worker.terminate();
        dtype = null;
        channel = startWorker(filesBase, trackFor(dtype), dtype);
        info = await channel.ready;
      }
      if (disposed) {
        channel.worker.terminate();
        throw new Error('The voice model was closed while it loaded');
      }
      restart = { filesBase, dtype: info.device === 'wasm' ? null : dtype };
      voiceInfo = info.voices;
      engine.device = info.device === 'wasm' ? 'wasm' : `${info.device} ${info.dtype}`;
    },
    voices(): Voice[] {
      return Object.entries(voiceInfo).map(([id, info]) => ({
        id,
        label: info.name,
        language: info.language,
        trait: info.gender.toLowerCase(),
      }));
    },
    async *stream(text, { voice, speed, signal }) {
      if (!channel) throw new Error('The voice model is not loaded');
      const { current, release } = await takeTurn();
      if (signal?.aborted) {
        release();
        return;
      }
      const id = ++sequence;
      const result = new Promise<{ samples: Float32Array; sampleRate: number }>(
        (resolve, reject) => {
          current.pending.set(id, { resolve, reject });
        },
      );
      // The worker is busy until this request settles, whether or not anyone still wants it.
      result.then(release, release);
      current.worker.postMessage({ type: 'generate', id, text, voice, speed });
      const gone = new Promise<null>((resolve) => {
        if (signal?.aborted) resolve(null);
        else signal?.addEventListener('abort', () => resolve(null), { once: true });
      });
      let audio: { samples: Float32Array; sampleRate: number } | null;
      try {
        audio = await Promise.race([result, gone]);
      } catch (error) {
        if (signal?.aborted) return;
        throw error;
      }
      if (audio === null) {
        abandon(current, result);
        return;
      }
      engine.sampleRate = audio.sampleRate;
      yield audio.samples;
    },
    dispose() {
      disposed = true;
      channel?.worker.terminate();
      channel?.fail(new Error('The voice model was closed'));
      channel = undefined;
    },
  };
  return engine;
}
