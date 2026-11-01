import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKokoroEngine } from './kokoro';

vi.mock('./manifest', async (original) => ({
  ...(await original<typeof import('./manifest')>()),
  fetchTtsManifest: async () => ({
    engines: { kokoro: { label: 'K', license: 'Apache-2.0', revision: 'abc123abc123', files: {} } },
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

  it('sums download progress across files', async () => {
    const engine = createKokoroEngine();
    const seen: (number | null)[] = [];
    const loading = engine.load((percent) => seen.push(percent));
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(1));
    const worker = FakeWorker.all[0] as FakeWorker;
    worker.reply({
      type: 'progress',
      info: { status: 'progress', file: 'a', loaded: 25, total: 100 },
    });
    worker.reply({
      type: 'progress',
      info: { status: 'progress', file: 'b', loaded: 75, total: 100 },
    });
    worker.reply({ type: 'progress', info: { status: 'download', file: 'c' } });
    worker.ready();
    await loading;
    expect(seen).toEqual([25, 50]);
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

  it('terminates the worker and reloads the model when a running request is aborted', async () => {
    const engine = await loaded();
    const first = FakeWorker.all[0] as FakeWorker;
    const abort = new AbortController();
    const pending = ask(engine, abort.signal);
    await tick();
    abort.abort();
    // The stale generation ends at once and yields nothing.
    expect((await pending).done).toBe(true);
    expect(first.terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    const second = FakeWorker.all[1] as FakeWorker;
    expect(second.posted[0]).toEqual({ type: 'load', filesBase: FILES, webgpuDtype: 'fp32' });
    // The next request waits for the reloaded model, then runs on the new worker.
    const next = ask(engine);
    await tick();
    expect(second.posted.some((message) => message.type === 'generate')).toBe(false);
    second.ready();
    await tick();
    const request = second.posted.at(-1) as { type: string; id: number };
    expect(request.type).toBe('generate');
    second.reply({
      type: 'audio',
      id: request.id,
      samples: new Float32Array([9]),
      sampleRate: 24000,
    });
    expect((await next).value).toEqual(new Float32Array([9]));
  });

  it('reloads on WebAssembly after an abort when the model runs there', async () => {
    const engine = await loaded('wasm');
    const abort = new AbortController();
    const pending = ask(engine, abort.signal);
    await tick();
    abort.abort();
    await pending;
    expect((FakeWorker.all[1] as FakeWorker).posted[0]).toMatchObject({ webgpuDtype: null });
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
