import type { ReadAloudEngine } from '../../../../lib/readerPrefs';

/** The engine ids are the stored preference's, so there is one list of them. */
export type EngineId = ReadAloudEngine;

export type Voice = {
  id: string;
  label: string;
  /** A locale such as `en-us`; voices group by it in the sheet. */
  language: string;
  /** A muted trait beside the name, such as `female`. */
  trait?: string;
};

/** Download progress: a percentage when the total is known, and the bytes so far. */
export type LoadProgress = (percent: number | null, loaded: number, total: number) => void;

export type TtsEngine = {
  id: EngineId;
  /** True when the engine takes a speed option; otherwise the player stretches the audio. */
  supportsSpeed: boolean;
  sampleRate: number;
  /** Where the model runs once loaded, such as `webgpu` or `wasm`. */
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
export function progressTracker<E>(
  onProgress: LoadProgress,
  files: (event: E) => [file: string, loaded: number, total: number] | null,
): (event: E) => void {
  const seen = new Map<string, [number, number]>();
  return (event) => {
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
