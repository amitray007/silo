// biome-ignore-all lint/suspicious/noExplicitAny: throwaway prototype, third-party types are loose
/** In-browser AI text-to-speech engines for the read-aloud prototype. */

export type EngineId = 'kokoro' | 'phonon';
export type Voice = { id: string; label: string; language?: string; trait?: string };
export type LoadProgress = (percent: number | null, loaded: number, total: number) => void;

export type TtsEngine = {
  id: EngineId;
  label: string;
  /** True when the engine takes a speed option; otherwise the player uses playbackRate. */
  supportsSpeed: boolean;
  sampleRate: number;
  /** Where the model runs once loaded, for example "webgpu" or "wasm". */
  device: string;
  load(onProgress: LoadProgress): Promise<void>;
  voices(): Voice[];
  stream(
    text: string,
    options: { voice: string; speed: number; signal?: AbortSignal },
  ): AsyncIterable<Float32Array>;
  dispose(): void;
};

/** Sum progress events from several files into one percentage. */
function progressTracker(
  onProgress: LoadProgress,
  files: (event: any) => [string, number, number] | null,
) {
  const seen = new Map<string, [number, number]>();
  return (event: any) => {
    const entry = files(event);
    if (!entry) return;
    seen.set(entry[0], [entry[1], entry[2]]);
    let loaded = 0;
    let total = 0;
    for (const [l, t] of seen.values()) {
      loaded += l;
      total += t;
    }
    onProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null, loaded, total);
  };
}

/** WebGPU dtype for Kokoro. Chosen by the measurements in the round-4 report. */
export const KOKORO_WEBGPU_DTYPE = 'fp32';

export function createKokoroEngine(options: { webgpuDtype?: string | null } = {}): TtsEngine {
  const worker = new Worker(new URL('./kokoroWorker.prototype.ts', import.meta.url), {
    type: 'module',
  });
  let voiceInfo: Record<string, any> = {};
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: { samples: Float32Array; sampleRate: number }) => void;
      reject: (error: Error) => void;
    }
  >();
  let onReady: ((info: any) => void) | undefined;
  let onFail: ((error: Error) => void) | undefined;
  let track: ((event: any) => void) | undefined;
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'progress') track?.(message.info);
    else if (message.type === 'ready') onReady?.(message);
    else if (message.type === 'audio') {
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    } else if (message.type === 'error') {
      const error = new Error(message.message);
      if (message.id === undefined) onFail?.(error);
      else {
        pending.get(message.id)?.reject(error);
        pending.delete(message.id);
      }
    }
  };
  const engine: TtsEngine = {
    id: 'kokoro',
    label: 'Kokoro (82M)',
    supportsSpeed: true,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      track = progressTracker(onProgress, (event) =>
        event.status === 'progress' && event.file
          ? [event.file as string, event.loaded as number, event.total as number]
          : null,
      );
      const ready = new Promise<any>((resolve, reject) => {
        onReady = resolve;
        onFail = reject;
      });
      worker.postMessage({
        type: 'load',
        webgpuDtype: options.webgpuDtype === undefined ? KOKORO_WEBGPU_DTYPE : options.webgpuDtype,
      });
      const info = await ready;
      voiceInfo = info.voices;
      engine.device = `${info.device} ${info.dtype}`;
    },
    voices() {
      return Object.entries(voiceInfo).map(([id, info]) => ({
        id,
        label: info.name as string,
        language: info.language as string,
        trait: info.gender as string,
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

export function createPhononEngine(): TtsEngine {
  let tts: any;
  const engine: TtsEngine = {
    id: 'phonon',
    label: 'Phonon (31M, English)',
    supportsSpeed: false,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      const { PhononTTS } = await import('phonon-tts');
      const track = progressTracker(onProgress, (event) =>
        event.total ? [event.file as string, event.loaded as number, event.total as number] : null,
      );
      tts = await PhononTTS.load({
        lang: 'en',
        device: 'auto',
        onProgress: track,
      });
      engine.sampleRate = tts.sampleRate;
      engine.device = tts.device === 'webgpu' ? 'webgpu' : `cpu x${tts.threads}`;
    },
    voices() {
      return tts ? (tts.voices as string[]).map((id) => ({ id, label: id, language: 'en' })) : [];
    },
    async *stream(text, { voice, signal }) {
      const speech = tts.stream(text, {
        ...(voice ? { voice } : {}),
        ...(signal ? { signal } : {}),
      });
      yield* speech as AsyncIterable<Float32Array>;
    },
    dispose() {
      tts?.dispose();
      tts = undefined;
    },
  };
  return engine;
}

export function createEngine(id: EngineId): TtsEngine {
  return id === 'kokoro' ? createKokoroEngine() : createPhononEngine();
}

export const ENGINES: { id: EngineId; label: string }[] = [
  { id: 'kokoro', label: 'Kokoro (82M)' },
  { id: 'phonon', label: 'Phonon (31M)' },
];
