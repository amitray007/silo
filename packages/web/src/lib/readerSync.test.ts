import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, type DeepPartial, mergeDeep, type SyncTransport } from './readerSync';

type State = { type: { size: number; font: string }; width: string };
const START: State = { type: { size: 16, font: 'inter' }, width: 'medium' };

function harness(initial: State = START, hasLocal = true) {
  let state = structuredClone(initial);
  const sync = createSync<State>({
    read: () => state,
    apply: (patch) => {
      state = mergeDeep(state, patch);
    },
    hasLocal: () => hasLocal,
  });
  const sent: DeepPartial<State>[] = [];
  const replies: Array<{ resolve: (value: State) => void; reject: (error: Error) => void }> = [];
  const transport: SyncTransport<State> = {
    send: (patch) => {
      sent.push(patch);
      return new Promise<State>((resolve, reject) => replies.push({ resolve, reject }));
    },
    keepalive: vi.fn(),
  };
  return { sync, transport, sent, replies, state: () => state };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mergeDeep', () => {
  it('keeps untouched fields and replaces leaves', () => {
    expect(mergeDeep({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 } })).toEqual({
      a: { b: 9, c: 2 },
      d: 3,
    });
  });
});

describe('commit', () => {
  it('applies locally at once and sends a partial patch', async () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ type: { font: 'serif' } });
    expect(h.state().type).toEqual({ size: 16, font: 'serif' });
    expect(h.sent).toEqual([{ type: { font: 'serif' } }]);
  });

  it('debounces: only the last of several quick changes is sent', () => {
    const h = harness();
    h.sync.connect(h.transport);
    for (const size of [17, 18, 19]) h.sync.commit({ type: { size } }, 400);
    expect(h.state().type.size).toBe(19);
    expect(h.sent).toEqual([]);
    vi.advanceTimersByTime(399);
    expect(h.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.sent).toEqual([{ type: { size: 19 } }]);
  });

  it('a discrete change sends the waiting stepper change with it', () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ type: { size: 20 } }, 400);
    h.sync.commit({ width: 'wide' });
    expect(h.sent).toEqual([{ type: { size: 20 }, width: 'wide' }]);
  });

  it('sends one request at a time and the next carries what changed meanwhile', async () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ width: 'wide' });
    h.sync.commit({ type: { font: 'mono' } });
    expect(h.sent).toHaveLength(1);
    h.replies[0]?.resolve({ ...START, width: 'wide' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent[1]).toEqual({ type: { font: 'mono' } });
    // The first answer did not undo the newer local change.
    expect(h.state().type.font).toBe('mono');
  });

  it('waits for a transport and sends then', () => {
    const h = harness();
    h.sync.commit({ width: 'narrow' });
    expect(h.state().width).toBe('narrow');
    h.sync.connect(h.transport);
    expect(h.sent).toEqual([{ width: 'narrow' }]);
  });

  it('adopts the server value once the request settles and nothing waits', async () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ width: 'wide' });
    h.replies[0]?.resolve({ type: { size: 22, font: 'inter' }, width: 'wide' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.size).toBe(22);
  });

  it('rolls back only the refused fields, to their first value', async () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ type: { size: 18 } }, 400);
    h.sync.commit({ type: { size: 20 } }, 400);
    vi.advanceTimersByTime(400);
    // A later change to another field is not part of the refused request.
    h.sync.commit({ width: 'wide' });
    h.replies[0]?.reject(new Error('refused'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.size).toBe(16);
    expect(h.state().width).toBe('wide');
  });

  it('does not roll back a field the user changed again after the refused request', async () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ type: { font: 'serif' } });
    h.sync.commit({ type: { font: 'mono' } });
    h.replies[0]?.reject(new Error('refused'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.font).toBe('mono');
  });

  it('sends a waiting change when the page is hidden', () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ type: { size: 21 } }, 400);
    dispatchEvent(new Event('pagehide'));
    expect(h.transport.keepalive).toHaveBeenCalledWith({ type: { size: 21 } });
  });
});

describe('hydrate', () => {
  it('server wins: its value replaces the local one', () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.hydrate({ type: { size: 22, font: 'mono' }, width: 'narrow' });
    expect(h.state()).toEqual({ type: { size: 22, font: 'mono' }, width: 'narrow' });
    expect(h.sent).toEqual([]);
  });

  it('does not overwrite a change that is waiting or in flight', () => {
    const h = harness();
    h.sync.connect(h.transport);
    h.sync.commit({ width: 'wide' });
    h.sync.hydrate(START);
    expect(h.state().width).toBe('wide');
  });

  it('uploads the local values once when the server has none', () => {
    const h = harness({ type: { size: 20, font: 'serif' }, width: 'wide' });
    h.sync.connect(h.transport);
    h.sync.hydrate(null);
    expect(h.sent).toEqual([{ type: { size: 20, font: 'serif' }, width: 'wide' }]);
    h.replies[0]?.resolve({ type: { size: 20, font: 'serif' }, width: 'wide' });
    h.sync.hydrate(null);
    expect(h.sent).toHaveLength(1);
  });

  it('uploads nothing when the browser holds no values', () => {
    const h = harness(START, false);
    h.sync.connect(h.transport);
    h.sync.hydrate(null);
    expect(h.sent).toEqual([]);
  });
});
