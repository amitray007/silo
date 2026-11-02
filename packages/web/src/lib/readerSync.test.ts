import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, type DeepPartial, mergeDeep, type SyncTransport } from './readerSync';

type State = { type: { size: number; font: string }; width: string };
const START: State = { type: { size: 16, font: 'inter' }, width: 'medium' };

function harness(initial: State = START, hasLocal = true, hydrated = true) {
  let state = structuredClone(initial);
  const sync = createSync<State>({
    read: () => state,
    apply: (patch) => {
      state = mergeDeep(state, patch);
    },
    hasLocal: () => hasLocal,
  });
  if (hydrated) sync.hydrate(initial);
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

const connections: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const disconnect of connections.splice(0)) disconnect();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('mergeDeep', () => {
  it('shares the record guard: replaces arrays and null, and ignores undefined', () => {
    expect(mergeDeep({ field: { a: 1 } }, { field: null })).toEqual({ field: null });
    expect(mergeDeep({ field: [1] }, { field: [2, 3] })).toEqual({ field: [2, 3] });
    expect(mergeDeep({ field: 1 }, { field: undefined })).toEqual({ field: 1 });
  });

  it('keeps untouched fields and replaces leaves', () => {
    expect(mergeDeep({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 } })).toEqual({
      a: { b: 9, c: 2 },
      d: 3,
    });
  });
});

describe('commit', () => {
  it('applies locally at once and sends the full scope', async () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ type: { font: 'serif' } });
    expect(h.state().type).toEqual({ size: 16, font: 'serif' });
    expect(h.sent).toEqual([{ ...START, type: { ...START.type, font: 'serif' } }]);
  });

  it('debounces: only the last of several quick changes is sent', () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    for (const size of [17, 18, 19]) h.sync.commit({ type: { size } }, 400);
    expect(h.state().type.size).toBe(19);
    expect(h.sent).toEqual([]);
    vi.advanceTimersByTime(399);
    expect(h.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.sent).toEqual([{ ...START, type: { ...START.type, size: 19 } }]);
  });

  it('a discrete change sends the waiting stepper change with it', () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ type: { size: 20 } }, 400);
    h.sync.commit({ width: 'wide' });
    expect(h.sent).toEqual([{ ...START, type: { ...START.type, size: 20 }, width: 'wide' }]);
  });

  it('sends one request at a time and the next carries what changed meanwhile', async () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'wide' });
    h.sync.commit({ type: { font: 'mono' } });
    expect(h.sent).toHaveLength(1);
    h.replies[0]?.resolve({ ...START, width: 'wide' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent[1]).toEqual({ ...START, width: 'wide', type: { ...START.type, font: 'mono' } });
    // The first answer did not undo the newer local change.
    expect(h.state().type.font).toBe('mono');
  });

  it('waits for a transport and sends then', () => {
    const h = harness();
    h.sync.commit({ width: 'narrow' });
    expect(h.state().width).toBe('narrow');
    connections.push(h.sync.connect(h.transport));
    expect(h.sent).toEqual([{ ...START, width: 'narrow' }]);
  });

  it('adopts the server value once the request settles and nothing waits', async () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'wide' });
    h.replies[0]?.resolve({ type: { size: 22, font: 'inter' }, width: 'wide' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.size).toBe(22);
  });

  it('rolls back only the refused fields, to their first value', async () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
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
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ type: { font: 'serif' } });
    h.sync.commit({ type: { font: 'mono' } });
    h.replies[0]?.reject(new Error('refused'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.font).toBe('mono');
  });

  it('sends a waiting change when the page is hidden', () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ type: { size: 21 } }, 400);
    dispatchEvent(new Event('pagehide'));
    expect(h.transport.keepalive).toHaveBeenCalledWith(
      { ...START, type: { ...START.type, size: 21 } },
      expect.any(String),
    );
  });
});

describe('hydrate', () => {
  it('server wins: its value replaces the local one', () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.hydrate({ type: { size: 22, font: 'mono' }, width: 'narrow' });
    expect(h.state()).toEqual({ type: { size: 22, font: 'mono' }, width: 'narrow' });
    expect(h.sent).toEqual([]);
  });

  it('does not overwrite a change that is waiting or in flight', () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'wide' });
    h.sync.hydrate(START);
    expect(h.state().width).toBe('wide');
  });

  it('uploads the local values once when the server has none', () => {
    const h = harness({ type: { size: 20, font: 'serif' }, width: 'wide' }, true, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.hydrate(null);
    expect(h.sent).toEqual([{ type: { size: 20, font: 'serif' }, width: 'wide' }]);
    h.replies[0]?.resolve({ type: { size: 20, font: 'serif' }, width: 'wide' });
    h.sync.hydrate(null);
    expect(h.sent).toHaveLength(1);
  });

  it('uploads nothing when the browser holds no values', () => {
    const h = harness(START, false, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.hydrate(null);
    expect(h.sent).toEqual([]);
  });
});

describe('sync failure and lifecycle regressions', () => {
  it('restores the last confirmed field after two consecutive refusals', async () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ type: { font: 'serif' } });
    h.sync.commit({ type: { font: 'mono' } });
    h.replies[0]?.reject(new Error('first refusal'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.font).toBe('mono');
    h.replies[1]?.reject(new Error('second refusal'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().type.font).toBe('inter');
  });

  it('uses a successful reply as the rollback baseline for the next request', async () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'wide' });
    h.sync.commit({ width: 'narrow' });
    h.replies[0]?.resolve({ ...START, width: 'wide' });
    await vi.advanceTimersByTimeAsync(0);
    h.replies[1]?.reject(new Error('refused'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().width).toBe('wide');
  });

  it('retries a failed migration with all local fields on the next hydration', async () => {
    const local = { type: { size: 22, font: 'mono' }, width: 'wide' };
    const h = harness(local, true, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.hydrate(null);
    h.replies[0]?.reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    h.sync.hydrate(null);
    expect(h.sent).toEqual([local, local]);
    h.replies[1]?.resolve(local);
    await vi.advanceTimersByTimeAsync(0);
    h.sync.hydrate(null);
    expect(h.sent).toHaveLength(2);
  });

  it('keeps every local field when an edit retries a failed migration', async () => {
    const local = { type: { size: 22, font: 'mono' }, width: 'wide' };
    const h = harness(local, true, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.hydrate(null);
    h.replies[0]?.reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    h.sync.commit({ type: { size: 23 } });
    expect(h.sent[1]).toEqual({ type: { size: 23, font: 'mono' }, width: 'wide' });
  });

  it('uploads the full mirror when an edit precedes the first GET reply', () => {
    const h = harness({ type: { size: 22, font: 'mono' }, width: 'wide' }, true, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'narrow' });
    expect(h.sent).toEqual([]);
    h.sync.hydrate(null);
    expect(h.sent).toEqual([{ type: { size: 22, font: 'mono' }, width: 'narrow' }]);
  });

  it('keeps an early edit while adopting the saved server fields', () => {
    const h = harness(START, false, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'wide' });
    h.sync.hydrate({ type: { size: 22, font: 'mono' }, width: 'narrow' });
    expect(h.state()).toEqual({ type: { size: 22, font: 'mono' }, width: 'wide' });
    expect(h.sent).toEqual([{ type: { size: 22, font: 'mono' }, width: 'wide' }]);
  });

  it('sends debounced work with keepalive only when visibility changes to hidden', () => {
    const h = harness();
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ type: { size: 21 } }, 400);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.transport.keepalive).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.transport.keepalive).toHaveBeenCalledWith(
      { ...START, type: { ...START.type, size: 21 } },
      expect.any(String),
    );
  });

  it('keeps the full local value in an early pagehide migration', () => {
    const h = harness(START, true, false);
    connections.push(h.sync.connect(h.transport));
    h.sync.commit({ width: 'wide' }, 400);
    dispatchEvent(new Event('pagehide'));
    expect(h.transport.keepalive).toHaveBeenCalledWith(
      { ...START, width: 'wide' },
      expect.any(String),
    );
  });
});

describe('article queue lifecycle', () => {
  it('flushes a debounced edit on disconnect and releases pagehide after it settles', async () => {
    const h = harness();
    const close = h.sync.connect(h.transport, true);
    h.sync.commit({ type: { size: 20 } }, 400);
    close();
    expect(h.sent).toEqual([{ ...START, type: { ...START.type, size: 20 } }]);
    h.replies[0]?.resolve({ ...START, type: { ...START.type, size: 20 } });
    await Promise.resolve();
    h.sync.commit({ width: 'wide' }, 400);
    dispatchEvent(new Event('pagehide'));
    expect(h.transport.keepalive).not.toHaveBeenCalled();
    h.sync.reset();
  });

  it('drains an edit queued behind a request before disconnecting', async () => {
    const h = harness();
    const close = h.sync.connect(h.transport, true);
    h.sync.commit({ type: { size: 20 } });
    h.sync.commit({ width: 'wide' }, 400);
    close();
    expect(h.sent).toHaveLength(1);
    dispatchEvent(new Event('pagehide'));
    expect(h.transport.keepalive).toHaveBeenCalledWith(
      { ...START, type: { ...START.type, size: 20 }, width: 'wide' },
      expect.any(String),
    );
    h.replies[0]?.resolve({ ...START, type: { ...START.type, size: 20 } });
    await Promise.resolve();
    expect(h.sent).toHaveLength(2);
    h.replies[1]?.resolve({ type: { size: 20, font: 'inter' }, width: 'wide' });
    await Promise.resolve();
    expect(h.state().width).toBe('wide');
    h.sync.reset();
  });

  it('removes a failed override and preserves another leaf that succeeded later locally', async () => {
    type Overrides = DeepPartial<State>;
    let state: Overrides = {};
    let reject: (error: Error) => void = () => {};
    const sync = createSync<Overrides>({
      read: () => state,
      apply: (patch) => {
        state = mergeDeep(state, patch);
      },
      replace: (value) => {
        state = value;
      },
      hasLocal: () => false,
    });
    sync.hydrate({});
    const close = sync.connect({
      send: () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
      keepalive: () => {},
    });
    sync.commit({ type: { size: 20 } });
    sync.commit({ type: { font: 'serif' } }, 400);
    reject(new Error('offline'));
    await Promise.resolve();
    expect(state).toEqual({ type: { font: 'serif' } });
    sync.reset();
    close();
  });
});

it('keeps a full newer snapshot when pagehide overtakes an in-flight write', async () => {
  const h = harness();
  const writes: Array<{ value: State; writtenAt: string }> = [];
  let stored = START;
  let savedAt = '';
  const save = (value: State, writtenAt: string) => {
    if (writtenAt > savedAt) {
      stored = value;
      savedAt = writtenAt;
    }
    return stored;
  };
  let finishOld = () => {};
  connections.push(
    h.sync.connect({
      send: (value, writtenAt) => {
        writes.push({ value, writtenAt });
        return new Promise((resolve) => {
          finishOld = () => resolve(save(value, writtenAt));
        });
      },
      keepalive: (value, writtenAt) => {
        writes.push({ value, writtenAt });
        save(value, writtenAt);
      },
    }),
  );
  h.sync.commit({ type: { size: 20 } });
  h.sync.commit({ width: 'wide' }, 400);
  dispatchEvent(new Event('pagehide'));
  finishOld();
  await Promise.resolve();
  expect(writes[0]?.writtenAt).toBeDefined();
  expect((writes[0]?.writtenAt ?? '') < (writes[1]?.writtenAt ?? '')).toBe(true);
  expect(stored).toEqual({ type: { size: 20, font: 'inter' }, width: 'wide' });
  expect(h.state()).toEqual(stored);
  h.sync.reset();
});

it('clears a drained disconnector once and ignores an old cleanup after reconnect', async () => {
  const h = harness();
  const detached = vi.fn();
  const close = h.sync.connect(h.transport, true, detached);
  h.sync.commit({ width: 'wide' }, 400);
  close();
  const newer = { send: vi.fn(async (value: State) => value), keepalive: vi.fn() };
  const closeNew = h.sync.connect(newer, true, detached);
  close();
  h.replies[0]?.resolve({ ...START, width: 'wide' });
  await Promise.resolve();
  expect(detached).not.toHaveBeenCalled();
  h.sync.commit({ width: 'narrow' });
  await Promise.resolve();
  expect(newer.send).toHaveBeenCalledTimes(1);
  closeNew();
  expect(detached).toHaveBeenCalledTimes(1);
  closeNew();
  expect(detached).toHaveBeenCalledTimes(1);
});
