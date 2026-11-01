import type { TtsManifestJson } from './manifest';
import type { EngineId, Voice } from './types';

/** Phonon voice ids are file names under `voices/`; the catalog's names come from the manifest. */
export const PHONON_VOICE_FILE = /^voices\/(.+)\.safetensors$/;
const KOKORO_VOICE_FILE = /^voices\/(.+)\.bin$/;

/**
 * Kokoro voice ids read `<accent><gender>_<name>`: `af_heart` is American, female, Heart. This
 * is the naming `kokoro-js` lists its voices by, so Settings can offer them before the model
 * has loaded; a loaded engine reports its own list.
 */
function kokoroVoice(id: string): Voice | null {
  const match = /^([ab])([fm])_(.+)$/.exec(id);
  if (!match) return null;
  const [, accent, gender, name] = match;
  if (name === undefined) return null;
  return {
    id,
    label: name.replace(/^./, (letter) => letter.toUpperCase()),
    language: accent === 'a' ? 'en-us' : 'en-gb',
    trait: gender === 'f' ? 'female' : 'male',
  };
}

/** The voices an engine offers, from the manifest alone (no model load). */
export function manifestVoices(manifest: TtsManifestJson, engine: EngineId): Voice[] {
  const voices: Voice[] = [];
  for (const [path, info] of Object.entries(manifest.engines[engine].files)) {
    if (engine === 'phonon') {
      const id = PHONON_VOICE_FILE.exec(path)?.[1];
      if (id && info.voice) {
        voices.push({
          id,
          label: info.voice.name,
          language: info.voice.locale,
          trait: info.voice.gender,
        });
      }
    } else {
      const id = KOKORO_VOICE_FILE.exec(path)?.[1];
      const voice = id ? kokoroVoice(id) : null;
      if (voice) voices.push(voice);
    }
  }
  return voices;
}
