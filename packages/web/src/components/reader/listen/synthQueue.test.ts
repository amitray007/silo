import { describe, expect, it } from 'vitest';
import type { TtsEngine } from './engines/types';
import { ReplayCache } from './replayCache';
import { SynthQueue } from './synthQueue';

type Call = { text: string; signal: AbortSignal | undefined };

/** An engine whose synthesis the test finishes by hand. */
function fakeEngine(supportsSpeed = true) {
  const calls: Call[] = [];
  const release = new Map<string, () => void>();
  const engine: TtsEngine = {
    id: 'kokoro',
    supportsSpeed,
    sampleRate: 24000,
    device: 'test',
    load: async () => {},
    voices: () => [],
    dispose: () => {},
    async *stream(text, { signal }) {
      calls.push({ text, signal });
      await new Promise<void>((resolve) => release.set(text, resolve));
      if (signal?.aborted) return;
      yield new Float32Array([1, 2, 3]);
    },
  };
  return { engine, calls, finish: (text: string) => release.get(text)?.() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SynthQueue', () => {
  it('runs one job at a time, lowest priority number first', async () => {
    const { engine, calls, finish } = fakeEngine();
    const queue = new SynthQueue();
    queue.request(engine, 'running', '', 1, 5);
    queue.request(engine, 'late', '', 1, 9);
    queue.request(engine, 'urgent', '', 1, -1);
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['running']);
    finish('running');
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['running', 'urgent']);
    finish('urgent');
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['running', 'urgent', 'late']);
  });

  it('never runs two syntheses at once, even when a finished job asks for more', async () => {
    const { engine, calls, finish } = fakeEngine();
    const queue = new SynthQueue();
    const first = queue.request(engine, 'one', '', 1, 0);
    first.listeners.add(() => {
      queue.request(engine, 'three', '', 1, 2);
    });
    queue.request(engine, 'two', '', 1, 1);
    await settle();
    finish('one');
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['one', 'two']);
    finish('two');
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['one', 'two', 'three']);
  });

  it('shares one job between equal requests and raises its priority', async () => {
    const { engine, calls, finish } = fakeEngine();
    const queue = new SynthQueue();
    queue.request(engine, 'busy', '', 1, 0);
    const first = queue.request(engine, 'same', '', 1, 50);
    queue.request(engine, 'other', '', 1, 10);
    const second = queue.request(engine, 'same', '', 1, 1);
    expect(second).toBe(first);
    finish('busy');
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['busy', 'same']);
  });

  it('streams chunks to listeners and caches the finished unit for replay', async () => {
    const { engine, calls, finish } = fakeEngine();
    const queue = new SynthQueue();
    const job = queue.request(engine, 'hello', 'v', 1, 0);
    let heard = 0;
    job.listeners.add(() => {
      heard += 1;
    });
    await settle();
    finish('hello');
    await settle();
    expect(job.done).toBe(true);
    expect(job.chunks).toHaveLength(1);
    expect(heard).toBeGreaterThan(0);
    const again = queue.request(engine, 'hello', 'v', 1, 0);
    expect(again.done).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('streams trimmed speech before completion, flushes the kept tail once, and replays it unchanged', async () => {
    const { engine } = fakeEngine(false);
    let resume: (() => void) | undefined;
    engine.stream = async function* () {
      yield new Float32Array(2400); // 100 ms lead.
      yield new Float32Array(4800).fill(0.5); // 200 ms speech.
      yield new Float32Array(12000); // Excess silence is held until completion.
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
    };
    const queue = new SynthQueue();
    const job = queue.request(engine, 'trim me', '', 1, 0);
    await settle();
    expect(job.done).toBe(false);
    expect(job.chunks.reduce((n, c) => n + c.length, 0)).toBe(6840); // 285 ms, only the final 5 ms fade waits.
    resume?.();
    await settle();
    expect(job.done).toBe(true);
    expect(job.chunks.reduce((n, c) => n + c.length, 0)).toBe(6960); // 30 + 200 + 60 ms.
    expect(queue.request(engine, 'trim me', '', 1, 0).chunks).toEqual(job.chunks);
  });

  it('tags held internal silence only on the live job and caches the full pause', async () => {
    const { engine } = fakeEngine(false);
    engine.stream = async function* () {
      yield new Float32Array(4800).fill(0.5);
      yield new Float32Array(12000);
      yield new Float32Array(4800).fill(0.25);
    };
    const queue = new SynthQueue();
    const job = queue.request(engine, 'internal pause', '', 1, 0);
    await settle();
    expect(job.done).toBe(true);
    const held = job.chunks.filter((_, index) => job.heldSilence.has(index));
    expect(held.reduce((n, chunk) => n + chunk.length, 0)).toBe(10680); // 445 ms.
    expect(held.every((chunk) => chunk.every((sample) => sample === 0))).toBe(true);
    const replay = queue.request(engine, 'internal pause', '', 1, 0);
    expect(replay.heldSilence.size).toBe(0);
    expect(replay.chunks).toEqual(job.chunks);
    expect(replay.chunks.reduce((n, chunk) => n + chunk.length, 0)).toBe(21600);
  });

  it('keys the cache by voice and speed', async () => {
    const { engine, calls, finish } = fakeEngine();
    const queue = new SynthQueue();
    queue.request(engine, 'x', 'a', 1, 0);
    await settle();
    finish('x');
    await settle();
    queue.request(engine, 'x', 'b', 1, 0);
    queue.request(engine, 'x', 'a', 1.5, 0);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('cancels waiting jobs and aborts the running one on clear', async () => {
    const { engine, calls, finish } = fakeEngine();
    const queue = new SynthQueue();
    const running = queue.request(engine, 'one', '', 1, 0);
    const waiting = queue.request(engine, 'two', '', 1, 1);
    await settle();
    queue.clear();
    finish('one');
    await settle();
    expect(calls.map((c) => c.text)).toEqual(['one']);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(running.cancelled).toBe(true);
    expect(waiting.cancelled).toBe(true);
    expect(running.done).toBe(false);
    // A cancelled unit is requested afresh, not served half finished.
    const fresh = queue.request(engine, 'one', '', 1, 0);
    expect(fresh).not.toBe(running);
    expect(fresh.chunks).toEqual([]);
  });

  it('records a failure on the job', async () => {
    const { engine } = fakeEngine();
    engine.stream = async function* () {
      yield* [];
      throw new Error('model exploded');
    };
    const queue = new SynthQueue();
    const job = queue.request(engine, 'x', '', 1, 0);
    await settle();
    expect(job.failed).toBe('model exploded');
    expect(job.done).toBe(false);
  });

  it('shares the cache cap with stretched audio', () => {
    const cache = new ReplayCache(8);
    const queue = new SynthQueue(cache);
    cache.set('a', { chunks: [new Float32Array(2)], sampleRate: 1 });
    cache.set('b', { chunks: [new Float32Array(2)], sampleRate: 1 });
    expect(queue.cache.size).toBe(1);
  });
});
