import type { ModelSpec, LoadProgress as PhononProgress, PhononTTS } from 'phonon-tts';
import { fetchTtsManifest, ttsFileUrl } from './manifest';
import { progressTracker, type TtsEngine, type Voice } from './types';

const DEFAULT_VOICE = 'default';

/** Voice ids are file names under `voices/`; the catalog's names come from the manifest. */
const VOICE_FILE = /^voices\/(.+)\.safetensors$/;

/**
 * Phonon 31m (English). `phonon-tts` runs its own worker and streams audio as it is generated.
 * Its model files come from silo's file route through a `ModelSpec`, so the browser never calls
 * Hugging Face.
 */
export function createPhononEngine(): TtsEngine {
  let tts: PhononTTS | undefined;
  let voiceList: Voice[] = [];
  const engine: TtsEngine = {
    id: 'phonon',
    label: 'Phonon (31M)',
    supportsSpeed: false,
    sampleRate: 24000,
    device: 'not loaded',
    async load(onProgress) {
      const [{ PhononTTS }, manifest] = await Promise.all([
        import('phonon-tts'),
        fetchTtsManifest(),
      ]);
      const files = manifest.engines.phonon.files;
      const voices: Record<string, string> = {
        [DEFAULT_VOICE]: ttsFileUrl('phonon', 'default-voice.safetensors'),
      };
      voiceList = [];
      for (const [path, info] of Object.entries(files)) {
        const id = VOICE_FILE.exec(path)?.[1];
        if (!id || !info.voice) continue;
        voices[id] = ttsFileUrl('phonon', path);
        voiceList.push({
          id,
          label: info.voice.name,
          language: info.voice.locale,
          trait: info.voice.gender,
        });
      }
      const spec: ModelSpec = {
        weights: { q8: ttsFileUrl('phonon', 'model.q8.gguf') },
        tokenizer: ttsFileUrl('phonon', 'tokenizer.json'),
        config: ttsFileUrl('phonon', 'config.json'),
        voices,
        defaultVoice: DEFAULT_VOICE,
      };
      const track = progressTracker<PhononProgress>(onProgress, (event) =>
        event.total ? [event.file, event.loaded, event.total] : null,
      );
      tts = await PhononTTS.load({
        lang: 'en',
        model: spec,
        quant: 'q8',
        device: 'auto',
        voices: [DEFAULT_VOICE],
        onProgress: track,
      });
      engine.sampleRate = tts.sampleRate;
      engine.device = tts.device === 'webgpu' ? 'webgpu' : `cpu x${tts.threads}`;
    },
    voices: () => voiceList,
    async *stream(text, { voice, signal }) {
      if (!tts) throw new Error('The voice model is not loaded');
      yield* tts.stream(text, { voice: voice || DEFAULT_VOICE, ...(signal ? { signal } : {}) });
    },
    dispose() {
      tts?.dispose();
      tts = undefined;
    },
  };
  return engine;
}
