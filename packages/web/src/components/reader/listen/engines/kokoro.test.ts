import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKokoroEngine } from './kokoro';

vi.mock('./manifest', async (original) => ({
  ...(await original<typeof import('./manifest')>()),
  fetchTtsManifest: async () => ({
    engines: {
      kokoro: {
        label: 'K',
        license: 'Apache-2.0',
        revision: 'abc123abc123',
        files: {
          'onnx/model.onnx': { size: 800, sha256: 'a' },
          'onnx/model_quantized.onnx': { size: 300, sha256: 'b' },
          'config.json': { size: 100, sha256: 'c' },
          'tokenizer.json': { size: 50, sha256: 'd' },
          'tokenizer_config.json': { size: 50, sha256: 'e' },
        },
      },
    },
  }),
}));

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: { type: string; [key: string]: unknown }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: { type: string }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
  ready(device = 'webgpu', dtype = 'fp32') {
    this.reply({
      type: 'ready',
      device,
      dtype,
      voices: { af_heart: { name: 'Heart', language: 'en-us', gender: 'Female' } },
    });
  }
}

const FILES = `${location.origin}/api/tts/files/kokoro/abc123abc123`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

async function loaded(device = 'webgpu') {
  const engine = createKokoroEngine();
  const loading = engine.load(() => {});
  await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
  (FakeWorker.all[0] as FakeWorker).ready(device, device === 'wasm' ? 'q8' : 'fp32');
  await loading;
  return engine;
}

describe('createKokoroEngine loading', () => {
  it("asks the worker to load from silo's file route, fp32 on WebGPU", async () => {
    const engine = await loaded();
    expect((FakeWorker.all[0] as FakeWorker).posted[0]).toEqual({
      type: 'load',
      filesBase: FILES,
      webgpuDtype: 'fp32',
    });
    expect(engine.device).toBe('webgpu fp32');
    expect(engine.voices()).toEqual([
      { id: 'af_heart', label: 'Heart', language: 'en-us', trait: 'female' },
    ]);
  });

  it('retries on a fresh WebAssembly worker when the WebGPU start fails', async () => {
    const engine = createKokoroEngine();
    const loading = engine.load(() => {});
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    (FakeWorker.all[0] as FakeWorker).reply({
      type: 'error',
      message: 'no available backend found',
    });
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2));
    expect((FakeWorker.all[0] as FakeWorker).terminated).toBe(true);
    expect((FakeWorker.all[1] as FakeWorker).posted[0]).toEqual({
      type: 'load',
      filesBase: FILES,
      webgpuDtype: null,
    });
    (FakeWorker.all[1] as FakeWorker).ready('wasm', 'q8');
    await loading;
    expect(engine.device).toBe('wasm');
  });

  it('retries the same way when the worker crashes during the WebGPU start', async () => {
    const engine = createKokoroEngine();
    const loading = engine.load(() => {});
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    (FakeWorker.all[0] as FakeWorker).onerror?.({ message: 'boom' });
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2));
    (FakeWorker.all[1] as FakeWorker).ready('wasm', 'q8');
    await loading;
  });

  it('fails the load when the fallback fails too, so Retry can run', async () => {
    const engine = createKokoroEngine();
    const loading = engine.load(() => {});
    const failed = expect(loading).rejects.toThrow('out of memory');
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    (FakeWorker.all[0] as FakeWorker).reply({ type: 'error', message: 'webgpu failed' });
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2));
    (FakeWorker.all[1] as FakeWorker).reply({ type: 'error', message: 'out of memory' });
    await failed;
  });

  it('terminates the worker of a model that finishes loading after the engine was closed', async () => {
    const engine = createKokoroEngine();
    const loading = engine.load(() => {});
    const failed = expect(loading).rejects.toThrow(/closed/);
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    engine.dispose();
    await failed;
    expect((FakeWorker.all[0] as FakeWorker).terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2 - 1);
  });

  it('measures progress against the manifest sizes of the files this dtype loads', async () => {
    const engine = createKokoroEngine();
    const seen: [number | null, number, number][] = [];
    const loading = engine.load((percent, loaded, total) => seen.push([percent, loaded, total]));
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    const worker = FakeWorker.all[0] as FakeWorker;
    // fp32: 800 + 100 + 50 + 50, known before the first byte.
    expect(seen[0]).toEqual([0, 0, 1000]);
    // A small file done first is 10%, not a finished download.
    worker.reply({ type: 'progress', info: { status: 'done', file: 'config.json' } });
    expect(seen.at(-1)).toEqual([10, 100, 1000]);
    worker.reply({
      type: 'progress',
      info: { status: 'progress', file: 'onnx/model.onnx', loaded: 400, total: 800 },
    });
    expect(seen.at(-1)).toEqual([50, 500, 1000]);
    // More bytes than the manifest says cannot pass the file's share; other events are ignored.
    worker.reply({
      type: 'progress',
      info: { status: 'progress', file: 'onnx/model.onnx', loaded: 9999, total: 800 },
    });
    expect(seen.at(-1)).toEqual([90, 900, 1000]);
    const count = seen.length;
    worker.reply({ type: 'progress', info: { status: 'initiate', file: 'tokenizer.json' } });
    worker.reply({
      type: 'progress',
      info: { status: 'progress', file: 'voices/af_heart.bin', loaded: 5, total: 5 },
    });
    expect(seen).toHaveLength(count);
    worker.ready();
    await loading;
  });

  it('starts the progress over, against the q8 model, when it falls back to WebAssembly', async () => {
    const engine = createKokoroEngine();
    const seen: [number | null, number, number][] = [];
    const loading = engine.load((percent, loaded, total) => seen.push([percent, loaded, total]));
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    (FakeWorker.all[0] as FakeWorker).reply({ type: 'error', message: 'no gpu' });
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2));
    // q8: 300 + 100 + 50 + 50.
    expect(seen.at(-1)).toEqual([0, 0, 500]);
    (FakeWorker.all[1] as FakeWorker).ready('wasm', 'q8');
    await loading;
  });
});

describe('createKokoroEngine generating', () => {
  async function ask(engine: Awaited<ReturnType<typeof loaded>>, signal?: AbortSignal) {
    const stream = engine.stream('Hello.', {
      voice: 'af_heart',
      speed: 1.5,
      ...(signal ? { signal } : {}),
    });
    const next = stream[Symbol.asyncIterator]().next();
    next.catch(() => undefined);
    await tick();
    return next;
  }

  it('posts the request and yields the audio', async () => {
    const engine = await loaded();
    const worker = FakeWorker.all[0] as FakeWorker;
    const pending = ask(engine);
    await tick();
    const request = worker.posted.at(-1) as {
      type: string;
      id: number;
      text: string;
      voice: string;
      speed: number;
    };
    expect(request).toMatchObject({
      type: 'generate',
      text: 'Hello.',
      voice: 'af_heart',
      speed: 1.5,
    });
    worker.reply({
      type: 'audio',
      id: request.id,
      samples: new Float32Array([1, 2]),
      sampleRate: 24000,
    });
    expect((await pending).value).toEqual(new Float32Array([1, 2]));
  });

  it('fails a waiting request when the worker crashes, and never hangs', async () => {
    const engine = await loaded();
    const worker = FakeWorker.all[0] as FakeWorker;
    const pending = ask(engine);
    await tick();
    worker.onerror?.({ message: 'Aborted()' });
    await expect(pending).rejects.toThrow('Aborted()');
  });

  it('fails a waiting request when a message cannot be read', async () => {
    const engine = await loaded();
    const pending = ask(engine);
    await tick();
    (FakeWorker.all[0] as FakeWorker).onmessageerror?.();
    await expect(pending).rejects.toThrow(/could not be read/);
  });

  describe('after an abort', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const settle = () => vi.advanceTimersByTimeAsync(0);

    async function running(device = 'webgpu') {
      const engine = await loaded(device);
      const first = FakeWorker.all[0] as FakeWorker;
      const abort = new AbortController();
      const pending = engine
        .stream('One.', { voice: 'af_heart', speed: 1, signal: abort.signal })
        [Symbol.asyncIterator]()
        .next();
      await settle();
      const request = first.posted.at(-1) as unknown as { id: number };
      return { engine, first, abort, pending, request };
    }

    it('lets a generation that finishes within 750 ms be dropped, with no restart', async () => {
      const { first, abort, pending, request } = await running();
      abort.abort();
      // The stream ends at once and yields nothing.
      expect((await pending).done).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      first.reply({
        type: 'audio',
        id: request.id,
        samples: new Float32Array([1]),
        sampleRate: 24000,
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(first.terminated).toBe(false);
      expect(FakeWorker.all).toHaveLength(1);
    });

    it('restarts the worker, on the same device, when it is still busy after 750 ms', async () => {
      const { first, abort, pending } = await running();
      abort.abort();
      await pending;
      await vi.advanceTimersByTimeAsync(740);
      expect(first.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      expect(first.terminated).toBe(true);
      expect(FakeWorker.all).toHaveLength(2);
      expect((FakeWorker.all[1] as FakeWorker).posted[0]).toEqual({
        type: 'load',
        filesBase: FILES,
        webgpuDtype: 'fp32',
      });
    });

    it('reloads on WebAssembly after a restart when the model runs there', async () => {
      const { abort, pending } = await running('wasm');
      abort.abort();
      await pending;
      await vi.advanceTimersByTimeAsync(800);
      expect((FakeWorker.all[1] as FakeWorker).posted[0]).toMatchObject({ webgpuDtype: null });
    });

    it('queues new work behind the stale generation instead of running two at once', async () => {
      const { engine, first, abort, pending, request } = await running();
      abort.abort();
      await pending;
      const next = engine
        .stream('Two.', { voice: 'af_heart', speed: 1 })
        [Symbol.asyncIterator]()
        .next();
      await vi.advanceTimersByTimeAsync(300);
      // The worker is still busy with the stale one: the new request has not been sent.
      expect(first.posted.filter((m) => m.type === 'generate')).toHaveLength(1);
      first.reply({
        type: 'audio',
        id: request.id,
        samples: new Float32Array([1]),
        sampleRate: 24000,
      });
      await vi.advanceTimersByTimeAsync(0);
      const sent = first.posted.filter((m) => m.type === 'generate');
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({ text: 'Two.' });
      first.reply({
        type: 'audio',
        id: (sent[1] as unknown as { id: number }).id,
        samples: new Float32Array([2]),
        sampleRate: 24000,
      });
      expect((await next).value).toEqual(new Float32Array([2]));
      expect(FakeWorker.all).toHaveLength(1);
    });

    it('moves queued work to the new worker when a stale generation forces a restart', async () => {
      const { engine, first, abort, pending } = await running();
      abort.abort();
      await pending;
      const next = engine
        .stream('Two.', { voice: 'af_heart', speed: 1 })
        [Symbol.asyncIterator]()
        .next();
      await vi.advanceTimersByTimeAsync(800);
      const second = FakeWorker.all[1] as FakeWorker;
      expect(first.terminated).toBe(true);
      expect(second.posted.some((m) => m.type === 'generate')).toBe(false);
      second.ready();
      await vi.advanceTimersByTimeAsync(0);
      const request = second.posted.at(-1) as unknown as { type: string; id: number; text: string };
      expect(request).toMatchObject({ type: 'generate', text: 'Two.' });
      second.reply({
        type: 'audio',
        id: request.id,
        samples: new Float32Array([3]),
        sampleRate: 24000,
      });
      expect((await next).value).toEqual(new Float32Array([3]));
    });
  });

  it('does not restart for an abort that arrives after the audio did', async () => {
    const engine = await loaded();
    const worker = FakeWorker.all[0] as FakeWorker;
    const abort = new AbortController();
    const pending = ask(engine, abort.signal);
    await tick();
    const request = worker.posted.at(-1) as unknown as { id: number };
    worker.reply({
      type: 'audio',
      id: request.id,
      samples: new Float32Array([1]),
      sampleRate: 24000,
    });
    await pending;
    abort.abort();
    expect(FakeWorker.all).toHaveLength(1);
    expect(worker.terminated).toBe(false);
  });
});
