import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadAloudPrefs } from '../../../lib/readerPrefs';
import type { EngineId, LoadProgress, TtsEngine } from './engines';
import { useReadAloud } from './useReadAloud';

const fake = vi.hoisted(() => ({
  made: [] as { id: string; disposed: number; finish: () => void }[],
  /** Per engine: hold the load open until the test finishes it. */
  hold: new Set<string>(),
  progress: new Map<string, [number, number, number]>(),
  streamed: [] as string[],
}));

vi.mock('./engines', async (original) => {
  const real = await original<typeof import('./engines')>();
  const create = (id: EngineId): TtsEngine => {
    const record = { id, disposed: 0, finish: () => {} };
    fake.made.push(record);
    return {
      id,
      supportsSpeed: id === 'kokoro',
      sampleRate: 24000,
      device: 'test',
      load: (onProgress: LoadProgress) => {
        const seen = fake.progress.get(id);
        if (seen) onProgress(...seen);
        if (!fake.hold.has(id)) return Promise.resolve();
        // Like a real library, a held load cannot be cancelled: it finishes when it finishes.
        return new Promise<void>((resolve) => {
          record.finish = resolve;
        });
      },
      voices: () => [{ id: 'v1', label: 'One', language: 'en-us' }],
      dispose: () => {
        record.disposed += 1;
      },
      async *stream(text: string) {
        fake.streamed.push(text);
        yield new Float32Array(2400);
      },
    };
  };
  return { ...real, createEngine: create };
});

class FakeAudioContext {
  static last: FakeAudioContext | undefined;
  currentTime = 0;
  state = 'running';
  destination = {};
  onstatechange: (() => void) | null = null;
  closed = false;
  stopped = 0;
  constructor() {
    FakeAudioContext.last = this;
  }
  resume = async () => {};
  close = async () => {
    this.closed = true;
  };
  createBuffer(_c: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: () => {},
      start: () => {},
      stop: () => {
        this.stopped += 1;
      },
    };
  }
}

function article() {
  document.body.innerHTML = `<div class="silo-reader-scroll"><div class="silo-reader-prose">
    <p>The first paragraph has a sentence that is long enough to stand alone here. And a second one follows it.</p>
    <p>The second paragraph is written so that it holds enough words to be read alone as well.</p>
    <p>The third paragraph closes the article with one more sentence of a decent length.</p>
  </div></div>`;
  return {
    prose: document.querySelector('.silo-reader-prose') as HTMLElement,
    scroll: document.querySelector('.silo-reader-scroll') as HTMLElement,
  };
}

beforeEach(() => {
  fake.made = [];
  fake.hold.clear();
  fake.progress.clear();
  fake.streamed = [];
  localStorage.clear();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 100, 100, 20);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Element.prototype.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('frees engines that are still loading when the article closes, and any that finish late', async () => {
  fake.hold.add('phonon');
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  act(() => hook.result.current.begin());
  act(() => hook.result.current.warm());
  await waitFor(() => expect(fake.made).toHaveLength(1));
  hook.unmount();
  const [engine] = fake.made;
  expect(engine?.disposed).toBeGreaterThanOrEqual(1);
  const before = engine?.disposed ?? 0;
  // The load finishes anyway, as a library that cannot be cancelled would: it is freed again.
  await act(async () => engine?.finish());
  expect(engine?.disposed).toBeGreaterThan(before);
  expect(FakeAudioContext.last?.closed).toBe(true);
});

it('keeps a separate download state per engine', async () => {
  fake.hold.add('phonon');
  fake.progress.set('phonon', [42, 42, 100]);
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  act(() => hook.result.current.begin());
  act(() => hook.result.current.warm());
  await waitFor(() => expect(hook.result.current.progress).toBe(42));
  expect(hook.result.current.status).toBe('loading');
  // Kokoro has its own, untouched state.
  await act(async () => hook.result.current.setEngine('kokoro'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  expect(hook.result.current.progress).toBe(null);
  // Back to Phonon, which is still downloading: its progress is still there.
  await act(async () => hook.result.current.setEngine('phonon'));
  expect(hook.result.current.status).toBe('loading');
  expect(hook.result.current.progress).toBe(42);
  expect(hook.result.current.bytes).toEqual({ loaded: 42, total: 100 });
  hook.unmount();
});

function select(node: Node, from: number, to: number) {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

it('Listen from here starts at the sentence the selection starts in', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  const second = prose.querySelectorAll('p')[0]?.firstChild as Text;
  // Select from inside the second sentence of the first paragraph.
  const at = second.data.indexOf('And a second');
  select(second, at + 4, at + 10);
  act(() => hook.result.current.startHere());
  await waitFor(() => expect(hook.result.current.current?.text).toMatch(/^And a second one/));
  hook.unmount();
});

it('Listen from here falls back to the last click, then to the first sentence on screen', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  window.getSelection()?.removeAllRanges();
  const third = prose.querySelectorAll('p')[2] as HTMLElement;
  act(() => {
    third.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  act(() => hook.result.current.startHere());
  await waitFor(() => expect(hook.result.current.current?.text).toMatch(/third paragraph/));
  hook.unmount();

  const fresh = article();
  const again = renderHook(() => useReadAloud(fresh));
  act(() => again.result.current.startHere());
  await waitFor(() => expect(again.result.current.active).toBe(true));
  expect(again.result.current.current?.text).toMatch(/first paragraph/);
  again.unmount();
});

it('pauses when the audio device is suspended or interrupted, and Play resumes from the same sentence', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  act(() => hook.result.current.startAt(1));
  await waitFor(() => expect(hook.result.current.playing).toBe(true));
  const context = FakeAudioContext.last as FakeAudioContext;
  act(() => {
    context.state = 'interrupted';
    context.onstatechange?.();
  });
  expect(hook.result.current.playing).toBe(false);
  expect(hook.result.current.index).toBe(1);
  context.state = 'running';
  act(() => hook.result.current.play());
  await waitFor(() => expect(hook.result.current.playing).toBe(true));
  expect(hook.result.current.current?.text).toMatch(/^The second paragraph|^And a second/);
  hook.unmount();
});

it('pauses playback that stays in a hidden tab, but not one that comes back in time', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  act(() => hook.result.current.startAt(0));
  await waitFor(() => expect(hook.result.current.playing).toBe(true));
  vi.useFakeTimers();
  const hidden = (value: boolean) => {
    Object.defineProperty(document, 'hidden', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  hidden(true);
  act(() => vi.advanceTimersByTime(60_000));
  hidden(false);
  act(() => vi.advanceTimersByTime(5 * 60_000));
  expect(hook.result.current.playing).toBe(true);
  hidden(true);
  act(() => vi.advanceTimersByTime(2 * 60_000 + 10));
  expect(hook.result.current.playing).toBe(false);
  hidden(false);
  hook.unmount();
});

it('re-plans pause changes from the current sentence, including changes made in Settings', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(() => ({
    listen: useReadAloud({ prose, scroll }),
    prefs: useReadAloudPrefs(),
  }));
  act(() => hook.result.current.listen.startAt(2));
  await waitFor(() => expect(fake.streamed.length).toBeGreaterThan(0));
  const firstText = fake.streamed[0];
  const context = FakeAudioContext.last as FakeAudioContext;
  await act(async () => hook.result.current.listen.setPauses('natural'));
  await waitFor(() => expect(context.stopped).toBeGreaterThan(0));
  expect(hook.result.current.listen.index).toBe(2);
  expect(hook.result.current.listen.playing).toBe(true);
  expect(fake.streamed.filter((text) => text === firstText).length).toBe(2);
  const stopped = context.stopped;
  await act(async () => hook.result.current.prefs.update({ pauses: 'short' }));
  await waitFor(() => expect(context.stopped).toBeGreaterThan(stopped));
  expect(hook.result.current.listen.index).toBe(2);
  expect(hook.result.current.listen.pauses).toBe('short');
  hook.unmount();
});
