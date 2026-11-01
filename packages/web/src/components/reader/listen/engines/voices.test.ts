import { expect, it } from 'vitest';
import type { TtsManifestJson } from './manifest';
import { manifestVoices } from './voices';

const f = (voice?: { name: string; locale: string; gender: string }) => ({
  size: 1,
  sha256: 'x',
  ...(voice ? { voice } : {}),
});
const MANIFEST: TtsManifestJson = {
  engines: {
    phonon: {
      label: 'Phonon',
      license: 'x',
      revision: 'p',
      files: {
        'model.q8.gguf': f(),
        'voices/abc.safetensors': f({ name: 'Zoey', locale: 'en-us', gender: 'female' }),
      },
    },
    kokoro: {
      label: 'Kokoro',
      license: 'x',
      revision: 'k',
      files: {
        'config.json': f(),
        'voices/af_heart.bin': f(),
        'voices/bm_lewis.bin': f(),
        'voices/odd.bin': f(),
        'voices/af_.bin': f(),
        'voices/am.bin': f(),
      },
    },
  },
};

it('lists Phonon voices from the manifest catalog', () => {
  expect(manifestVoices(MANIFEST, 'phonon')).toEqual([
    { id: 'abc', label: 'Zoey', language: 'en-us', trait: 'female' },
  ]);
});

it('derives Kokoro voices from their ids, and skips ids it cannot read', () => {
  expect(manifestVoices(MANIFEST, 'kokoro')).toEqual([
    { id: 'af_heart', label: 'Heart', language: 'en-us', trait: 'female' },
    { id: 'bm_lewis', label: 'Lewis', language: 'en-gb', trait: 'male' },
  ]);
});
