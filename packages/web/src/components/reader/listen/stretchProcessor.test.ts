import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stretch } from './stretch';
import { StretchProcessor } from './stretchProcessor';
import type { StretchReply, StretchRequest } from './stretchWorker';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: StretchReply }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: StretchRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: StretchRequest, transfer: Transferable[]) {
    this.sent.push(structuredClone(message, { transfer }));
    expect(message.input.byteLength).toBe(0);
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    const message = this.sent.shift();
    if (message)
      this.onmessage?.({ data: { id: message.id, pcm: stretch(message.input, message.rate) } });
  }
}
beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe('StretchProcessor', () => {
  it.each([0.75, 1.25, 2, 3])(
    'transfers owned joined samples at %sx without detaching cached chunks',
    async (rate) => {
      const backing = Float32Array.from({ length: 12000 }, (_, i) => Math.sin(i / 13));
      const chunks = [backing.subarray(0, 4000), backing.subarray(4000)];
      const expected = stretch(backing, rate);
      const processor = new StretchProcessor();
      const result = processor.process(chunks, rate);
      FakeWorker.all[0]?.finish();
      expect(await result).toEqual(expected);
      expect(backing.length).toBe(12000);
      expect(chunks[0]?.length).toBe(4000);
      expect(chunks[1]?.length).toBe(8000);
      expect(backing[100]).toBeCloseTo(Math.sin(100 / 13));
      processor.cancel();
    },
  );

  it('cancels queued and running transforms, ignores late replies, and can start again', async () => {
    const processor = new StretchProcessor();
    const one = processor.process([new Float32Array(100)], 2);
    const two = processor.process([new Float32Array(200)], 2);
    const first = expect(one).rejects.toMatchObject({ name: 'AbortError' });
    const second = expect(two).rejects.toMatchObject({ name: 'AbortError' });
    const worker = FakeWorker.all[0];
    processor.cancel();
    await first;
    await second;
    expect(worker?.terminated).toBe(true);
    const next = processor.process([new Float32Array(300)], 2);
    worker?.finish();
    FakeWorker.all[1]?.finish();
    expect((await next).length).toBe(150);
    processor.cancel();
  });

  it('rejects a crashed transform and releases the worker', async () => {
    const processor = new StretchProcessor();
    const result = processor.process([new Float32Array(100)], 2);
    const failed = expect(result).rejects.toThrow('crashed');
    FakeWorker.all[0]?.onerror?.({ message: 'crashed' });
    await failed;
    expect(FakeWorker.all[0]?.terminated).toBe(true);
  });
});

it('keeps a single cached chunk attached and ignores errors from a cancelled worker', async () => {
  const processor = new StretchProcessor();
  const chunk = new Float32Array([1, 2, 3, 4]);
  const stale = processor.process([chunk], 2);
  const stopped = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
  const oldWorker = FakeWorker.all[0];
  processor.cancel();
  await stopped;
  expect(chunk).toEqual(new Float32Array([1, 2, 3, 4]));
  const next = processor.process([chunk], 2);
  oldWorker?.onerror?.({ message: 'late error' });
  expect(FakeWorker.all[1]?.terminated).toBe(false);
  FakeWorker.all[1]?.finish();
  expect(await next).toEqual(new Float32Array([1, 4]));
  expect(chunk.byteLength).toBe(16);
  processor.cancel();
});
