import { afterEach, expect, it, vi } from 'vitest';
import { stretch } from './stretch';
import type { StretchReply, StretchRequest } from './stretchWorker';

const scope = self as unknown as {
  onmessage: ((event: { data: StretchRequest }) => void) | null;
  postMessage: (message: StretchReply, transfer: Transferable[]) => void;
};
const previous = scope.onmessage;
afterEach(() => {
  scope.onmessage = previous;
  vi.unstubAllGlobals();
});

it('the worker returns exactly the old WSOLA output sample for sample and transfers its owned result', async () => {
  const posted = vi.fn();
  vi.stubGlobal('postMessage', posted);
  await import('./stretchWorker');
  for (const length of [0, 300, 1280, 24001]) {
    for (const rate of [0.75, 1, 1.25, 1.5, 3]) {
      const input = Float32Array.from({ length }, (_, i) => Math.sin(i / 7) * Math.cos(i / 17));
      scope.onmessage?.({ data: { id: 9, input, rate } });
      const [reply, transfer] = posted.mock.calls.at(-1) as [StretchReply, Transferable[]];
      expect('pcm' in reply).toBe(true);
      if (!('pcm' in reply)) throw new Error('Missing audio');
      expect(reply.id).toBe(9);
      expect(reply.pcm).toEqual(stretch(input, rate));
      expect(reply.pcm.buffer.byteLength).toBe(reply.pcm.length * 4);
      expect(transfer).toEqual([reply.pcm.buffer]);
      expect(reply.pcm.buffer).not.toBe(input.buffer);
    }
  }
});
