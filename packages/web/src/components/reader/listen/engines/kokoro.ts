import { ttsFilesBase } from './manifest';
import { progressTracker, type TtsEngine, type Voice } from './types';

/**
 * WebGPU runs Kokoro at fp32: the prototype measured fp16 as degraded. Without WebGPU the
 * worker falls back to q8 on WebAssembly.
 */
export const KOKORO_WEBGPU_DTYPE = 'fp32';

type VoiceInfo = { name: string; language: string; gender: string };
type Reply =
  | { type: 'progress'; info: { status?: string; file?: string; loaded?: number; total?: number } }
  | { type: 'ready'; device: string; dtype: string; voices: Record<string, VoiceInfo> }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string };

type Pending = {
  resolve: (value: { samples: Float32Array; sampleRate: number }) => void;
  reject: (error: Error) => void;
};

/** Kokoro 82M in a module Web Worker that silo owns. */
export function createKokoroEngine(): TtsEngine {
  const worker = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' });
  let voiceInfo: Record<string, VoiceInfo> = {};
  let sequence = 0;
  const pending = new Map<number, Pending>();
  let onReady: ((reply: Extract<Reply, { type: 'ready' }>) => void) | undefined;
  let onFail: ((error: Error) => void) | undefined;
  let track: ((info: Extract<Reply, { type: 'progress' }>['info']) => void) | undefined;

  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data;
    if (reply.type === 'progress') track?.(reply.info);
    else if (reply.type === 'ready') onReady?.(reply);
    else if (reply.type === 'audio') {
      pending.get(reply.id)?.resolve(reply);
      pending.delete(reply.id);
    } else if (reply.id === undefined) onFail?.(new Error(reply.message));
    else {
      pending.get(reply.id)?.reject(new Error(reply.message));
      pending.delete(reply.id);
    }
  };

  const engine: TtsEngine = {
    id: 'kokoro',
    label: 'Kokoro 82M',
    supportsSpeed: true,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      track = progressTracker(onProgress, (info) =>
        info.status === 'progress' && info.file && info.total
          ? [info.file, info.loaded ?? 0, info.total]
          : null,
      );
      const ready = new Promise<Extract<Reply, { type: 'ready' }>>((resolve, reject) => {
        onReady = resolve;
        onFail = reject;
      });
      worker.postMessage({
        type: 'load',
        filesBase: ttsFilesBase('kokoro'),
        webgpuDtype: KOKORO_WEBGPU_DTYPE,
      });
      const info = await ready;
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
      const id = ++sequence;
      const result = new Promise<{ samples: Float32Array; sampleRate: number }>(
        (resolve, reject) => {
          pending.set(id, { resolve, reject });
        },
      );
      worker.postMessage({ type: 'generate', id, text, voice, speed });
      const audio = await result;
      if (signal?.aborted) return;
      engine.sampleRate = audio.sampleRate;
      yield audio.samples;
    },
    dispose() {
      worker.terminate();
    },
  };
  return engine;
}
