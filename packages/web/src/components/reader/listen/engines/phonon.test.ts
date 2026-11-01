import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPhononEngine } from './phonon';

const state = vi.hoisted(() => ({
  options: undefined as undefined | Record<string, unknown>,
  release: undefined as undefined | (() => void),
  instance: undefined as
    | undefined
    | { dispose: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> },
}));

vi.mock('phonon-tts', () => ({
  PhononTTS: {
    load: vi.fn(async (options: Record<string, unknown>) => {
      state.options = options;
      // The test can hold the load open to close the engine in the middle of it.
      if (state.release === undefined) await Promise.resolve();
      else
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      const instance = {
        sampleRate: 24000,
        device: 'webgpu',
        threads: 1,
        dispose: vi.fn(),
        stream: vi.fn(async function* () {
          yield new Float32Array([1]);
        }),
      };
      state.instance = instance;
      return instance;
    }),
  },
}));

vi.mock('./manifest', async (original) => ({
  ...(await original<typeof import('./manifest')>()),
  fetchTtsManifest: async () => ({
    engines: {
      phonon: {
        label: 'Phonon',
        license: 'Apache-2.0',
        revision: 'abc123abc123',
        files: {
          'config.json': { size: 1, sha256: 'a' },
          'tokenizer.json': { size: 1, sha256: 'b' },
          'model.q8.gguf': { size: 1, sha256: 'c' },
          'default-voice.safetensors': { size: 1, sha256: 'd' },
          'voices/Zoe0.safetensors': {
            size: 1,
            sha256: 'e',
            voice: { name: 'Zoey', locale: 'en-us', gender: 'female' },
          },
          'voices/Mae1.safetensors': {
            size: 1,
            sha256: 'f',
            voice: { name: 'Maeve', locale: 'en-gb', gender: 'female' },
          },
        },
      },
    },
  }),
}));

beforeEach(() => {
  state.options = undefined;
  state.release = undefined;
  state.instance = undefined;
});

describe('createPhononEngine', () => {
  it("loads the model from silo's file route through a ModelSpec, in English, q8", async () => {
    const engine = createPhononEngine();
    await engine.load(() => {});
    const options = state.options as {
      lang: string;
      quant: string;
      device: string;
      model: {
        weights: { q8: string };
        tokenizer: string;
        config: string;
        voices: Record<string, string>;
        defaultVoice: string;
      };
    };
    expect(options.lang).toBe('en');
    expect(options.quant).toBe('q8');
    expect(options.device).toBe('auto');
    const base = `${location.origin}/api/tts/files/phonon/abc123abc123/`;
    expect(options.model.weights.q8).toBe(`${base}model.q8.gguf`);
    expect(options.model.tokenizer).toBe(`${base}tokenizer.json`);
    expect(options.model.config).toBe(`${base}config.json`);
    expect(options.model.defaultVoice).toBe('default');
    expect(options.model.voices).toEqual({
      default: `${base}default-voice.safetensors`,
      Zoe0: `${base}voices/Zoe0.safetensors`,
      Mae1: `${base}voices/Mae1.safetensors`,
    });
    // No address anywhere in the spec leaves silo.
    for (const url of [
      options.model.weights.q8,
      options.model.tokenizer,
      options.model.config,
      ...Object.values(options.model.voices),
    ]) {
      expect(new URL(url).origin).toBe(location.origin);
    }
    expect(engine.voices()).toEqual([
      { id: 'Zoe0', label: 'Zoey', language: 'en-us', trait: 'female' },
      { id: 'Mae1', label: 'Maeve', language: 'en-gb', trait: 'female' },
    ]);
    expect(engine.device).toBe('webgpu');
  });

  it('sums download progress across files', async () => {
    const engine = createPhononEngine();
    const seen: [number | null, number, number][] = [];
    const load = engine.load((percent, loaded, total) => seen.push([percent, loaded, total]));
    await load;
    const onProgress = state.options?.onProgress as (event: unknown) => void;
    onProgress({ file: 'weights', loaded: 50, total: 100, cached: false });
    onProgress({ file: 'tokenizer', loaded: 10, total: 100, cached: false });
    expect(seen.at(-1)).toEqual([30, 60, 200]);
    onProgress({ file: 'config', loaded: 1, total: null, cached: false });
    expect(seen).toHaveLength(2);
  });

  it('speaks with the default voice when none is named', async () => {
    const engine = createPhononEngine();
    await engine.load(() => {});
    for await (const chunk of engine.stream('Hello', { voice: '', speed: 1 })) void chunk;
    expect(state.instance?.stream).toHaveBeenCalledWith('Hello', { voice: 'default' });
    for await (const chunk of engine.stream('Hello', { voice: 'Zoe0', speed: 1 })) void chunk;
    expect(state.instance?.stream).toHaveBeenLastCalledWith('Hello', { voice: 'Zoe0' });
  });

  it('frees a model that finishes loading after the engine was closed', async () => {
    state.release = () => {};
    const engine = createPhononEngine();
    const loading = engine.load(() => {});
    const assertion = expect(loading).rejects.toThrow(/closed while it loaded/);
    await vi.waitFor(() => expect(state.options).toBeDefined());
    engine.dispose();
    state.release?.();
    await assertion;
    expect(state.instance?.dispose).toHaveBeenCalledTimes(1);
  });

  it('refuses to stream before it is loaded', async () => {
    const engine = createPhononEngine();
    await expect(
      engine.stream('x', { voice: '', speed: 1 })[Symbol.asyncIterator]().next(),
    ).rejects.toThrow(/not loaded/);
  });
});
