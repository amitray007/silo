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

/**
 * Download progress over every file an engine will load. The sizes come from the manifest, so
 * the total is known before the first byte and the figure never jumps when a big file starts.
 * `files` maps an event to `[file, bytes loaded]`, or null for events that are not progress;
 * files not in `sizes` are ignored. Calls `onProgress(0, 0, total)` at once.
 */
export function progressTracker<E>(
  onProgress: LoadProgress,
  sizes: Readonly<Record<string, number>>,
  files: (event: E) => [file: string, loaded: number] | null,
): (event: E) => void {
  const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
  const seen = new Map<string, number>();
  const report = () => {
    let loaded = 0;
    for (const [file, bytes] of seen) loaded += Math.min(bytes, sizes[file] ?? 0);
    onProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null, loaded, total);
  };
  report();
  return (event) => {
    const entry = files(event);
    if (!entry || !Object.hasOwn(sizes, entry[0])) return;
    seen.set(entry[0], entry[1]);
    report();
  };
}
