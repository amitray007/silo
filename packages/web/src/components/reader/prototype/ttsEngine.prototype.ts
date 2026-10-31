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

export function createKokoroEngine(): TtsEngine {
  let tts: any;
  const engine: TtsEngine = {
    id: 'kokoro',
    label: 'Kokoro (82M)',
    supportsSpeed: true,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      const { KokoroTTS } = await import('kokoro-js');
      const gpu = Boolean((navigator as any).gpu);
      const track = progressTracker(onProgress, (event) =>
        event.status === 'progress' && event.file
          ? [event.file as string, event.loaded as number, event.total as number]
          : null,
      );
      const options = gpu
        ? ({ dtype: 'fp32', device: 'webgpu' } as const)
        : ({ dtype: 'q8', device: 'wasm' } as const);
      try {
        tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          ...options,
          progress_callback: track,
        });
        engine.device = options.device;
      } catch (error) {
        if (!gpu) throw error;
        // WebGPU adapter exists but the model failed on it: retry on wasm.
        tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: track,
        });
        engine.device = 'wasm (webgpu failed)';
      }
    },
    voices() {
      if (!tts) return [];
      return Object.entries(tts.voices as Record<string, any>).map(([id, info]) => ({
        id,
        label: info.name as string,
        language: info.language as string,
        trait: info.gender as string,
      }));
    },
    async *stream(text, { voice, speed }) {
      const audio = await tts.generate(text, { voice: voice || 'af_heart', speed });
      engine.sampleRate = audio.sampling_rate;
      yield audio.audio as Float32Array;
    },
    dispose() {
      tts = undefined;
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
