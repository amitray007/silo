import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { backends: { onnx: { wasm: {} as Record<string, unknown> } } } as Record<
    string,
    unknown
  > & {
    backends: { onnx: { wasm: Record<string, unknown> } };
  },
  fromPretrained: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({ env: mocks.env }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: mocks.fromPretrained } }));

type Handler = (event: { data: unknown }) => Promise<void>;
const scope = self as unknown as {
  onmessage: Handler | null;
  postMessage: ReturnType<typeof vi.fn>;
  fetch: typeof fetch;
};
const FILES = 'https://silo.test/api/tts/files/kokoro/abc123abc123';
const upstream = vi.fn(async () => new Response('ok'));
const originalFetch = globalThis.fetch;
const sent = () =>
  scope.postMessage.mock.calls.map(
    ([message]) => message as { type: string; [key: string]: unknown },
  );

beforeEach(async () => {
  vi.resetModules();
  scope.postMessage = vi.fn();
  upstream.mockClear();
  globalThis.fetch = upstream as unknown as typeof fetch;
  mocks.fromPretrained.mockReset();
  mocks.fromPretrained.mockResolvedValue({ voices: { af_heart: { name: 'Heart' } } });
  await import('./kokoroWorker');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
});

const load = (webgpuDtype: 'fp32' | null = 'fp32') =>
  (scope.onmessage as Handler)({ data: { type: 'load', filesBase: FILES, webgpuDtype } });

function gpu(adapter: unknown) {
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: async () => adapter },
    configurable: true,
  });
}

describe('the Kokoro worker', () => {
  it("points transformers.js at silo's file route", async () => {
    await load();
    expect(mocks.env.remoteHost).toBe('https://silo.test/api/tts/files/kokoro');
    expect(mocks.env.remotePathTemplate).toBe('abc123abc123');
    expect(mocks.env.allowLocalModels).toBe(false);
  });

  it('never lets ONNX Runtime fall back to a CDN for its WebAssembly files', async () => {
    await load();
    const paths = mocks.env.backends.onnx.wasm.wasmPaths as { mjs: string; wasm: string };
    for (const url of [paths.mjs, paths.wasm]) {
      expect(url).toMatch(/ort-wasm-simd-threaded\.jsep\.(mjs|wasm)$/);
      expect(url).not.toMatch(/jsdelivr|unpkg|cdn|https?:\/\/(?!localhost)/);
    }
  });

  it('sends the hard-coded voice address to silo and refuses any other Hugging Face or CDN request', async () => {
    await load();
    await scope.fetch(
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin',
    );
    expect(upstream).toHaveBeenCalledWith(`${FILES}/voices/af_heart.bin`, undefined);
    for (const url of [
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/config.json',
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.wasm',
    ]) {
      await expect(scope.fetch(url)).rejects.toThrow(/blocked/);
    }
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('runs fp32 on WebGPU when the browser hands out an adapter', async () => {
    gpu({});
    await load();
    expect(mocks.fromPretrained).toHaveBeenCalledWith(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      expect.objectContaining({ dtype: 'fp32', device: 'webgpu' }),
    );
    expect(sent().at(-1)).toMatchObject({ type: 'ready', device: 'webgpu', dtype: 'fp32' });
  });

  it('runs q8 on WebAssembly when the GPU API has no adapter, or WebGPU is not offered', async () => {
    gpu(null);
    await load();
    expect(mocks.fromPretrained).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ dtype: 'q8', device: 'wasm' }),
    );
    await load(null);
    expect(mocks.fromPretrained).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ dtype: 'q8', device: 'wasm' }),
    );
    expect(sent().filter((m) => m.type === 'ready')).toHaveLength(2);
  });

  it('reports a failed WebGPU start as an error, so the main thread retries on a fresh worker', async () => {
    gpu({});
    mocks.fromPretrained.mockRejectedValueOnce(new Error('no available backend found'));
    await load();
    expect(sent().at(-1)).toMatchObject({ type: 'error', message: 'no available backend found' });
    expect(mocks.fromPretrained).toHaveBeenCalledTimes(1);
  });

  it('answers a generate request with the audio and transfers its buffer', async () => {
    await load();
    const samples = new Float32Array([0.5, -0.5]);
    mocks.fromPretrained.mock.results[0]?.value.then((model: { generate?: unknown }) => model);
    const model = (await mocks.fromPretrained.mock.results[0]?.value) as {
      generate?: unknown;
      voices: unknown;
    };
    model.generate = vi.fn(async () => ({ audio: samples, sampling_rate: 24000 }));
    await (scope.onmessage as Handler)({
      data: { type: 'generate', id: 7, text: 'Hi.', voice: '', speed: 1.25 },
    });
    expect(model.generate).toHaveBeenCalledWith('Hi.', { voice: 'af_heart', speed: 1.25 });
    expect(sent().at(-1)).toMatchObject({ type: 'audio', id: 7, sampleRate: 24000 });
  });

  it('reports a generate request before the model loaded as an error for that request', async () => {
    await (scope.onmessage as Handler)({
      data: { type: 'generate', id: 3, text: 'x', voice: '', speed: 1 },
    });
    expect(sent().at(-1)).toMatchObject({ type: 'error', id: 3 });
  });
});
