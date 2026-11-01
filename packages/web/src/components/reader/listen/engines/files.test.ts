import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDownloaded, removeDownload, requiredBytes, requiredEntries } from './files';
import type { TtsManifestJson } from './manifest';

const file = (size: number) => ({ size, sha256: 'x' });
const MANIFEST: TtsManifestJson = {
  engines: {
    phonon: {
      label: 'Phonon',
      license: 'Apache-2.0',
      revision: 'pr',
      files: {
        'model.q8.gguf': file(1000),
        'tokenizer.json': file(10),
        'config.json': file(1),
        'default-voice.safetensors': file(5),
        'voices/abc.safetensors': file(5),
      },
    },
    kokoro: {
      label: 'Kokoro',
      license: 'Apache-2.0',
      revision: 'kr',
      files: {
        'config.json': file(1),
        'tokenizer.json': file(2),
        'tokenizer_config.json': file(3),
        'onnx/model.onnx': file(5000),
        'onnx/model_quantized.onnx': file(900),
        'voices/af_heart.bin': file(7),
      },
    },
  },
};

vi.mock('./manifest', async (original) => ({
  ...(await original<typeof import('./manifest')>()),
  fetchTtsManifest: async () => MANIFEST,
}));

/** A tiny Cache API: named caches holding keys. */
function stubCaches(initial: Record<string, string[]>) {
  const store = new Map(Object.entries(initial).map(([name, keys]) => [name, new Set(keys)]));
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      const keys = store.get(name) ?? new Set<string>();
      store.set(name, keys);
      return {
        match: async (key: string) => (keys.has(key) ? new Response('x') : undefined),
        delete: async (key: string) => keys.delete(key),
      };
    },
  });
  return store;
}

const base = (engine: string, revision: string) =>
  `${location.origin}/api/tts/files/${engine}/${revision}`;

function noGpu() {
  vi.stubGlobal('navigator', { ...navigator, gpu: undefined });
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe('required files and size', () => {
  it('Phonon needs the model, tokenizer, config and default voice', () => {
    const urls = requiredEntries(MANIFEST, 'phonon', 'q8').map((entry) => entry.key);
    expect(urls.map((url) => url.replace(base('phonon', 'pr'), ''))).toEqual([
      '/model.q8.gguf',
      '/tokenizer.json',
      '/config.json',
      '/default-voice.safetensors',
    ]);
    expect(requiredBytes(MANIFEST, 'phonon', 'q8')).toBe(1016);
  });

  it('Kokoro sizes the model for the device: fp32 on WebGPU, q8 otherwise', () => {
    expect(requiredBytes(MANIFEST, 'kokoro', 'fp32')).toBe(5006);
    expect(requiredBytes(MANIFEST, 'kokoro', 'q8')).toBe(906);
    const q8 = requiredEntries(MANIFEST, 'kokoro', 'q8').map((entry) => entry.key);
    expect(q8).toContain(`${base('kokoro', 'kr')}/onnx/model_quantized.onnx`);
    expect(q8).not.toContain(`${base('kokoro', 'kr')}/onnx/model.onnx`);
  });
});

describe('isDownloaded and removeDownload', () => {
  it('Phonon is downloaded when all four files are in phonon-tts-v1', async () => {
    const root = base('phonon', 'pr');
    const keys = ['model.q8.gguf', 'tokenizer.json', 'config.json'].map((f) => `${root}/${f}`);
    const store = stubCaches({ 'phonon-tts-v1': keys });
    expect(await isDownloaded('phonon')).toBe(false);
    store.get('phonon-tts-v1')?.add(`${root}/default-voice.safetensors`);
    expect(await isDownloaded('phonon')).toBe(true);
  });

  it('Kokoro checks the model file for this device (q8 without WebGPU)', async () => {
    noGpu();
    const root = base('kokoro', 'kr');
    stubCaches({
      'transformers-cache': ['config.json', 'tokenizer.json', 'tokenizer_config.json'].map(
        (f) => `${root}/${f}`,
      ),
    });
    const files = await import('./files');
    expect(await files.isDownloaded('kokoro')).toBe(false);
    const store = stubCaches({
      'transformers-cache': [
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
        'onnx/model_quantized.onnx',
      ].map((f) => `${root}/${f}`),
    });
    expect(await files.isDownloaded('kokoro')).toBe(true);
    expect(store.size).toBe(1);
  });

  it('is false when the Cache API is missing', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await isDownloaded('phonon')).toBe(false);
  });

  it('Remove deletes exactly the engine files, from every cache that holds them', async () => {
    const phonon = base('phonon', 'pr');
    const kokoro = base('kokoro', 'kr');
    const hf = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';
    const store = stubCaches({
      'phonon-tts-v1': [`${phonon}/model.q8.gguf`, `${phonon}/voices/abc.safetensors`, 'other'],
      'transformers-cache': [`${kokoro}/onnx/model.onnx`, `${kokoro}/config.json`, 'foreign'],
      'kokoro-voices': [`${hf}af_heart.bin`, `${hf}not-listed.bin`],
    });
    await removeDownload('kokoro');
    expect([...(store.get('transformers-cache') ?? [])]).toEqual(['foreign']);
    expect([...(store.get('kokoro-voices') ?? [])]).toEqual([`${hf}not-listed.bin`]);
    // Phonon's files stay.
    expect(store.get('phonon-tts-v1')?.size).toBe(3);
    await removeDownload('phonon');
    expect([...(store.get('phonon-tts-v1') ?? [])]).toEqual(['other']);
  });
});
