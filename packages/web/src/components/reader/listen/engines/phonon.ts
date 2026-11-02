import type { ModelSpec, LoadProgress as PhononProgress, PhononTTS } from 'phonon-tts';
import { PHONON_FILES } from './files';
import { fetchTtsManifest, ttsFileUrl } from './manifest';
import { progressTracker, type TtsEngine, type Voice } from './types';
import { PHONON_VOICE_FILE } from './voices';

const DEFAULT_VOICE = 'default';

/**
 * Phonon 31m (English). `phonon-tts` runs its own worker and streams audio as it is generated.
 * Its model files come from silo's file route through a `ModelSpec`, so the browser never calls
 * Hugging Face.
 */
export function createPhononEngine(): TtsEngine {
  let tts: PhononTTS | undefined;
  let voiceList: Voice[] = [];
  let disposed = false;
  const engine: TtsEngine = {
    id: 'phonon',
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
        [DEFAULT_VOICE]: ttsFileUrl(manifest, 'phonon', PHONON_FILES.defaultVoice),
      };
      voiceList = [];
      for (const [path, info] of Object.entries(files)) {
        const id = PHONON_VOICE_FILE.exec(path)?.[1];
        if (!id || !info.voice) continue;
        voices[id] = ttsFileUrl(manifest, 'phonon', path);
        voiceList.push({
          id,
          label: info.voice.name,
          language: info.voice.locale,
          trait: info.voice.gender,
        });
      }
      const spec: ModelSpec = {
        weights: { q8: ttsFileUrl(manifest, 'phonon', PHONON_FILES.weights) },
        tokenizer: ttsFileUrl(manifest, 'phonon', PHONON_FILES.tokenizer),
        config: ttsFileUrl(manifest, 'phonon', PHONON_FILES.config),
        voices,
        defaultVoice: DEFAULT_VOICE,
      };
      // Every file this load fetches, with its manifest size (the default voice loads up front).
      const size = (path: string) => files[path]?.size ?? 0;
      const track = progressTracker<PhononProgress>(
        onProgress,
        {
          weights: size(PHONON_FILES.weights),
          tokenizer: size(PHONON_FILES.tokenizer),
          config: size(PHONON_FILES.config),
          [`voice:${DEFAULT_VOICE}`]: size(PHONON_FILES.defaultVoice),
        },
        (event) => [event.file, event.loaded],
      );
      tts = await PhononTTS.load({
        lang: 'en',
        model: spec,
        quant: 'q8',
        device: 'auto',
        voices: [DEFAULT_VOICE],
        onProgress: track,
      });
      if (disposed) {
        // The article closed while the model loaded: free it now, nobody will.
        tts.dispose();
        tts = undefined;
        throw new Error('The voice model was closed while it loaded');
      }
      engine.sampleRate = tts.sampleRate;
      engine.device = tts.device === 'webgpu' ? 'webgpu' : `cpu x${tts.threads}`;
    },
    voices: () => voiceList,
    async *stream(text, { voice, signal }) {
      if (!tts) throw new Error('The voice model is not loaded');
      yield* tts.stream(text, { voice: voice || DEFAULT_VOICE, ...(signal ? { signal } : {}) });
    },
    dispose() {
      disposed = true;
      tts?.dispose();
      tts = undefined;
    },
  };
  return engine;
}
