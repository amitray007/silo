import { fetchTtsManifest, type TtsManifestJson, ttsFileUrl } from './manifest';
import type { EngineId } from './types';

/**
 * Which files each engine keeps in the browser's Cache API, and under which names. The engines
 * load through `phonon-tts` and `transformers.js`, which write the caches themselves; this file
 * only reads and deletes those entries, so Settings can show what is stored and remove it.
 *
 * - Phonon: cache `phonon-tts-v1`, keyed by the file URL silo serves.
 * - Kokoro model files: cache `transformers-cache`, keyed by the same kind of URL.
 * - Kokoro voices: cache `kokoro-voices`, keyed by the Hugging Face URL `kokoro-js` asks for (the
 *   worker redirects the request, but the cache key stays the original address).
 */
const PHONON_CACHE = 'phonon-tts-v1';
const KOKORO_MODEL_CACHE = 'transformers-cache';
const KOKORO_VOICE_CACHE = 'kokoro-voices';
const KOKORO_VOICE_BASE =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';

/** The files Phonon loads up front (the other voices load when first chosen). */
export const PHONON_FILES = {
  weights: 'model.q8.gguf',
  tokenizer: 'tokenizer.json',
  config: 'config.json',
  defaultVoice: 'default-voice.safetensors',
} as const;

/**
 * WebGPU runs Kokoro at fp32 (the prototype measured fp16 as degraded). Without WebGPU the
 * worker runs q8 on WebAssembly.
 */
export const KOKORO_WEBGPU_DTYPE = 'fp32';
export type KokoroDtype = typeof KOKORO_WEBGPU_DTYPE | 'q8';

/** The model files a Kokoro load fetches for each dtype (voices load on first use, not then). */
export const KOKORO_SMALL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
export const KOKORO_MODEL_FILE: Record<KokoroDtype, string> = {
  fp32: 'onnx/model.onnx',
  q8: 'onnx/model_quantized.onnx',
};

let dtype: Promise<KokoroDtype> | undefined;

/** The dtype Kokoro will use in this browser: fp32 when a real GPU adapter exists, else q8. */
export function kokoroDtype(): Promise<KokoroDtype> {
  dtype ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    try {
      return (await gpu?.requestAdapter()) ? KOKORO_WEBGPU_DTYPE : 'q8';
    } catch {
      return 'q8';
    }
  })();
  return dtype;
}

type Entry = { cache: string; key: string };

/** The files a load needs: if all are cached, the engine starts without downloading. */
export function requiredEntries(
  manifest: TtsManifestJson,
  engine: EngineId,
  kokoro: KokoroDtype,
): Entry[] {
  if (engine === 'phonon') {
    return Object.values(PHONON_FILES).map((path) => ({
      cache: PHONON_CACHE,
      key: ttsFileUrl(manifest, 'phonon', path),
    }));
  }
  return [KOKORO_MODEL_FILE[kokoro], ...KOKORO_SMALL_FILES].map((path) => ({
    cache: KOKORO_MODEL_CACHE,
    key: ttsFileUrl(manifest, 'kokoro', path),
  }));
}

/** Every file of the engine that any load could have cached: what Remove deletes. */
function allEntries(manifest: TtsManifestJson, engine: EngineId): Entry[] {
  const paths = Object.keys(manifest.engines[engine].files);
  if (engine === 'phonon') {
    return paths.map((path) => ({ cache: PHONON_CACHE, key: ttsFileUrl(manifest, engine, path) }));
  }
  return paths.map((path) =>
    path.startsWith('voices/')
      ? { cache: KOKORO_VOICE_CACHE, key: `${KOKORO_VOICE_BASE}${path.slice('voices/'.length)}` }
      : { cache: KOKORO_MODEL_CACHE, key: ttsFileUrl(manifest, engine, path) },
  );
}

/** Download size in bytes of the required files (Kokoro: for this browser's device). */
export function requiredBytes(
  manifest: TtsManifestJson,
  engine: EngineId,
  kokoro: KokoroDtype,
): number {
  const files = manifest.engines[engine].files;
  const paths =
    engine === 'phonon'
      ? Object.values(PHONON_FILES)
      : [KOKORO_MODEL_FILE[kokoro], ...KOKORO_SMALL_FILES];
  return paths.reduce((sum, path) => sum + (files[path]?.size ?? 0), 0);
}

async function hasEntry({ cache, key }: Entry): Promise<boolean> {
  return Boolean(await (await caches.open(cache)).match(key));
}

/** True when every required file is in this browser's cache. False when the cache is unusable. */
export async function isDownloaded(engine: EngineId): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const manifest = await fetchTtsManifest();
    const needed = requiredEntries(manifest, engine, await kokoroDtype());
    return (await Promise.all(needed.map(hasEntry))).every(Boolean);
  } catch {
    return false;
  }
}

/** Deletes exactly the manifest's files for the engine from the caches that hold them. */
export async function removeDownload(engine: EngineId): Promise<void> {
  if (typeof caches === 'undefined') return;
  const manifest = await fetchTtsManifest();
  await Promise.all(
    allEntries(manifest, engine).map(async ({ cache, key }) => {
      await (await caches.open(cache)).delete(key);
    }),
  );
}
