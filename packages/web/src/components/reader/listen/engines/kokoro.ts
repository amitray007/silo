import { ttsFilesBase } from './manifest';
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

/** One Kokoro worker, loaded once. A worker whose WebGPU start failed cannot be reused. */
function startWorker(onProgress: (info: Progress) => void, webgpuDtype: string | null) {
  const worker = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  const ready = new Promise<Ready>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.type === 'progress') onProgress(reply.info);
      else if (reply.type === 'ready') resolve(reply);
      else if (reply.type === 'audio') {
        pending.get(reply.id)?.resolve(reply);
        pending.delete(reply.id);
      } else if (reply.id === undefined) reject(new Error(reply.message));
      else {
        pending.get(reply.id)?.reject(new Error(reply.message));
        pending.delete(reply.id);
      }
    };
  });
  worker.postMessage({ type: 'load', filesBase: ttsFilesBase('kokoro'), webgpuDtype });
  return { worker, pending, ready };
}

/** Kokoro 82M in a module Web Worker that silo owns. */
export function createKokoroEngine(): TtsEngine {
  let current: ReturnType<typeof startWorker> | undefined;
  let voiceInfo: Record<string, VoiceInfo> = {};
  let sequence = 0;

  const engine: TtsEngine = {
    id: 'kokoro',
    label: 'Kokoro (82M)',
    supportsSpeed: true,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      const track = progressTracker<Progress>(onProgress, (info) =>
        info.status === 'progress' && info.file && info.total
          ? [info.file, info.loaded ?? 0, info.total]
          : null,
      );
      let info: Ready;
      try {
        current = startWorker(track, KOKORO_WEBGPU_DTYPE);
        info = await current.ready;
      } catch {
        // The GPU run failed to start. ONNX Runtime keeps that failure, so WebAssembly gets a
        // fresh worker.
        current?.worker.terminate();
        current = startWorker(track, null);
        info = await current.ready;
      }
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
      if (!current) throw new Error('The voice model is not loaded');
      const id = ++sequence;
      const result = new Promise<{ samples: Float32Array; sampleRate: number }>(
        (resolve, reject) => {
          current?.pending.set(id, { resolve, reject });
        },
      );
      current.worker.postMessage({ type: 'generate', id, text, voice, speed });
      const audio = await result;
      if (signal?.aborted) return;
      engine.sampleRate = audio.sampleRate;
      yield audio.samples;
    },
    dispose() {
      current?.worker.terminate();
      current = undefined;
    },
  };
  return engine;
}
