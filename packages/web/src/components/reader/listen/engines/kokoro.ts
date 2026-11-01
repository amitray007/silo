import { fetchTtsManifest, ttsFilesBase } from './manifest';
import { progressTracker, type TtsEngine, type Voice } from './types';

/**
 * WebGPU runs Kokoro at fp32: the prototype measured fp16 as degraded. Without WebGPU the
 * worker runs q8 on WebAssembly.
 */
const KOKORO_WEBGPU_DTYPE = 'fp32';

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
  return { worker, pending, ready, fail };
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

  const engine: TtsEngine = {
    id: 'kokoro',
    supportsSpeed: true,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      const filesBase = ttsFilesBase(await fetchTtsManifest(), 'kokoro');
      const track = progressTracker<Progress>(onProgress, (info) =>
        info.status === 'progress' && info.file && info.total
          ? [info.file, info.loaded ?? 0, info.total]
          : null,
      );
      let dtype: string | null = KOKORO_WEBGPU_DTYPE;
      let info: Ready;
      try {
        channel = startWorker(filesBase, track, dtype);
        info = await channel.ready;
      } catch (error) {
        if (disposed) throw error;
        // The GPU run failed to start. ONNX Runtime keeps that failure, so WebAssembly gets a
        // fresh worker.
        channel?.worker.terminate();
        dtype = null;
        channel = startWorker(filesBase, track, dtype);
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
      const current = channel;
      await current.ready;
      const id = ++sequence;
      const result = new Promise<{ samples: Float32Array; sampleRate: number }>(
        (resolve, reject) => {
          current.pending.set(id, { resolve, reject });
        },
      );
      const stop = () => replace(current);
      signal?.addEventListener('abort', stop, { once: true });
      current.worker.postMessage({ type: 'generate', id, text, voice, speed });
      let audio: { samples: Float32Array; sampleRate: number };
      try {
        audio = await result;
      } catch (error) {
        if (signal?.aborted) return;
        throw error;
      } finally {
        // The request is over; an abort after this must not restart the worker.
        signal?.removeEventListener('abort', stop);
      }
      if (signal?.aborted) return;
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
