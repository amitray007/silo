import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook as renderBaseHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadAloudPrefs } from '../../../lib/readerPrefs';
import { ReaderPrefsProvider } from '../../../lib/useReaderPrefs';
import { makeLink } from '../../../test/fixtures';
import type { EngineId, LoadProgress, TtsEngine } from './engines';
import { takeSpeech } from './speechFocus';
import { useReadAloud } from './useReadAloud';

const fake = vi.hoisted(() => ({
  made: [] as { id: string; disposed: number; finish: () => void }[],
  /** Per engine: hold the load open until the test finishes it. */
  hold: new Set<string>(),
  progress: new Map<string, [number, number, number]>(),
  streamed: [] as string[],
  stream: undefined as TtsEngine['stream'] | undefined,
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
      async *stream(text, options) {
        fake.streamed.push(text);
        if (fake.stream) {
          yield* fake.stream(text, options);
          return;
        }
        yield new Float32Array(2400);
      },
    };
  };
  return { ...real, createEngine: create };
});

let nextArticle = 0;
function renderHook<T, P>(callback: (props: P) => T, options?: { initialProps: P }) {
  const client = new QueryClient();
  const link = makeLink({ id: `listen-${nextArticle++}`, feedId: 'feed' });
  return renderBaseHook(callback, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <ReaderPrefsProvider link={link}>{children}</ReaderPrefsProvider>
      </QueryClientProvider>
    ),
  });
}

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
  fake.stream = undefined;
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

it('pauses when an answer read aloud in the chat takes the speakers', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  act(() => hook.result.current.startAt(1));
  await waitFor(() => expect(hook.result.current.playing).toBe(true));
  act(() => {
    takeSpeech(() => {});
  });
  expect(hook.result.current.playing).toBe(false);
  expect(hook.result.current.index).toBe(1);
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

it('re-plans article pause changes and keeps them when Settings changes', async () => {
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
  expect(context.stopped).toBe(stopped);
  expect(hook.result.current.listen.pauses).toBe('natural');
  expect(hook.result.current.listen.index).toBe(2);
  expect(hook.result.current.listen.pauses).toBe('natural');
  hook.unmount();
});

it.each(['pauses', 'settings', 'speed', 'voice', 'engine'] as const)(
  're-plans a %s change from the sentence playing inside a streaming merged unit',
  async (change) => {
    vi.useFakeTimers();
    const { prose, scroll } = article();
    prose.innerHTML = '<p>One comes here. Two comes here.</p>';
    let completed = 0;
    fake.stream = async function* (_text, { signal }) {
      yield new Float32Array(24000).fill(0.5);
      yield new Float32Array(24000).fill(0.5);
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
      completed += 1;
    };
    const hook = renderHook(() => ({
      listen: useReadAloud({ prose, scroll }),
      prefs: useReadAloudPrefs(),
    }));
    await act(async () => {
      hook.result.current.listen.startAt(0);
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(fake.streamed).toEqual(['One comes here. Two comes here.']);
    const context = FakeAudioContext.last as FakeAudioContext;
    context.currentTime = 1.2;
    await act(async () => vi.advanceTimersByTimeAsync(40));
    expect(completed).toBe(0);
    expect(hook.result.current.listen.index).toBe(1);
    expect(hook.result.current.listen.current?.text).toBe('Two comes here.');
    await act(async () => {
      const { listen, prefs } = hook.result.current;
      if (change === 'pauses') listen.setPauses('natural');
      else if (change === 'settings') prefs.update({ pauses: 'short' });
      else if (change === 'speed') listen.setRate(1.5);
      else if (change === 'voice') listen.setVoice('v1');
      else listen.setEngine('kokoro');
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(context.stopped).toBeGreaterThan(0);
    expect(fake.streamed[1]).toBe('Two comes here.');
    expect(hook.result.current.listen.index).toBe(1);
    expect(hook.result.current.listen.playing).toBe(true);
    hook.unmount();
  },
);

it('resumes the saved sentence and saves only explicit pause, close, and pagehide', async () => {
  const { prose, scroll } = article();
  const onSave = vi.fn(async () => {});
  // Legacy word stream: 20 words precede the second paragraph, 51 in total.
  const position = 20 / 51;
  const hook = renderHook(() =>
    useReadAloud({ prose, scroll, saved: position, canSave: true, onSave }),
  );
  act(() => hook.result.current.play());
  await waitFor(() => expect(hook.result.current.index).toBe(2));
  expect(onSave).not.toHaveBeenCalled();
  act(() => hook.result.current.pause());
  expect(onSave).toHaveBeenLastCalledWith(position, undefined);
  onSave.mockClear();
  act(() => hook.result.current.startAt(3));
  await waitFor(() => expect(hook.result.current.index).toBe(3));
  expect(onSave).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenLastCalledWith(expect.any(Number), { keepalive: true });
  act(() => hook.result.current.stop());
  expect(onSave).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it('does not save Listen positions for feed posts', async () => {
  const { prose, scroll } = article();
  const onSave = vi.fn(async () => {});
  const hook = renderHook(() =>
    useReadAloud({ prose, scroll, saved: 0.5, canSave: false, onSave }),
  );
  act(() => hook.result.current.startAt(1));
  await waitFor(() => expect(hook.result.current.index).toBe(1));
  act(() => {
    hook.result.current.pause();
    hook.result.current.stop();
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(onSave).not.toHaveBeenCalled();
  hook.unmount();
});

it('uses a new saved mark when Listen was already paused', async () => {
  const { prose, scroll } = article();
  const hook = renderHook(({ saved }) => useReadAloud({ prose, scroll, saved }), {
    initialProps: { saved: 0 },
  });
  act(() => hook.result.current.startAt(0));
  await waitFor(() => expect(hook.result.current.index).toBe(0));
  act(() => hook.result.current.pause());
  hook.rerender({ saved: 0.9 });
  act(() => hook.result.current.play());
  await waitFor(() => expect(hook.result.current.current?.text).toMatch(/third paragraph/));
  hook.unmount();
});

it('closing saves even after the article DOM has been removed', async () => {
  const { prose, scroll } = article();
  const onSave = vi.fn(async () => {});
  const hook = renderHook(() => useReadAloud({ prose, scroll, canSave: true, onSave }));
  act(() => hook.result.current.startAt(2));
  await waitFor(() => expect(hook.result.current.index).toBe(2));
  document.body.replaceChildren();
  hook.unmount();
  expect(onSave).toHaveBeenCalledExactlyOnceWith(expect.any(Number), undefined);
});

it('does not save when playback advances into another sentence', async () => {
  vi.useFakeTimers();
  const { prose, scroll } = article();
  prose.innerHTML = '<p>One comes here. Two comes here.</p>';
  fake.stream = async function* (_text, { signal }) {
    yield new Float32Array(24000).fill(0.5);
    yield new Float32Array(24000).fill(0.5);
    await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
  };
  const onSave = vi.fn(async () => {});
  const hook = renderHook(() => useReadAloud({ prose, scroll, canSave: true, onSave }));
  await act(async () => {
    hook.result.current.startAt(0);
    await vi.advanceTimersByTimeAsync(40);
  });
  const context = FakeAudioContext.last as FakeAudioContext;
  context.currentTime = 1.2;
  await act(async () => vi.advanceTimersByTimeAsync(40));
  expect(hook.result.current.index).toBe(1);
  expect(onSave).not.toHaveBeenCalled();
  act(() => hook.result.current.pause());
  expect(onSave).toHaveBeenCalledExactlyOnceWith(0.5, undefined);
  hook.unmount();
});

it.each(['close', 'unmount', 'pagehide'] as const)(
  'does not recreate a removed place on %s after Listen pauses',
  async (exit) => {
    const { prose, scroll } = article();
    const onSave = vi.fn(async () => {});
    const hook = renderHook(
      ({ saved }: { saved: number | null }) =>
        useReadAloud({ prose, scroll, saved, canSave: true, onSave }),
      { initialProps: { saved: 0 as number | null } },
    );
    act(() => hook.result.current.startAt(0));
    await waitFor(() => expect(hook.result.current.playing).toBe(true));
    act(() => hook.result.current.pause());
    expect(onSave).toHaveBeenCalledOnce();
    onSave.mockClear();
    hook.rerender({ saved: null });
    if (exit === 'unmount') hook.unmount();
    else {
      act(() => {
        if (exit === 'close') hook.result.current.stop();
        else window.dispatchEvent(new Event('pagehide'));
      });
      hook.unmount();
    }
    expect(onSave).not.toHaveBeenCalled();
  },
);

it('discards the Listen position synchronously when Remove and pagehide precede the cache render', async () => {
  const { prose, scroll } = article();
  const onSave = vi.fn(async () => {});
  const hook = renderHook(() => useReadAloud({ prose, scroll, saved: 0, canSave: true, onSave }));
  act(() => hook.result.current.startAt(0));
  await waitFor(() => expect(hook.result.current.playing).toBe(true));
  act(() => hook.result.current.pause());
  expect(onSave).toHaveBeenCalledOnce();
  onSave.mockClear();
  act(() => {
    hook.result.current.forgetPlace();
    window.dispatchEvent(new Event('pagehide'));
    hook.result.current.stop();
  });
  hook.unmount();
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps useful in-flight warm synthesis through the hook start path', async () => {
  let finish: () => void = () => {};
  let signal: AbortSignal | undefined;
  fake.stream = async function* (_text, options) {
    signal = options.signal;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (!signal?.aborted) yield new Float32Array(2400).fill(0.5);
  };
  const { prose, scroll } = article();
  const hook = renderHook(() => useReadAloud({ prose, scroll }));
  act(() => hook.result.current.begin());
  act(() => hook.result.current.warm());
  await waitFor(() => expect(fake.streamed).toHaveLength(1));
  const warmed = fake.streamed[0];
  act(() => hook.result.current.startAt(0));
  await waitFor(() => expect(hook.result.current.playing).toBe(true));
  expect(signal?.aborted).toBe(false);
  await act(async () => finish());
  expect(fake.streamed.filter((text) => text === warmed)).toHaveLength(1);
  hook.unmount();
});

it('round-trips legacy word shares through inline markup and skipped blocks', async () => {
  const { prose, scroll } = article();
  prose.innerHTML =
    '<h2>A title</h2><p>One <em>small</em> sentence. Two more words.</p><pre>skip these words</pre><p>Last words.</p>';
  const onSave = vi.fn(async () => {});
  // The final paragraph starts at word 8 of 10. Postgres stores this as real.
  const hook = renderHook(() =>
    useReadAloud({ prose, scroll, saved: Math.fround(0.8), canSave: true, onSave }),
  );
  act(() => hook.result.current.play());
  await waitFor(() => expect(hook.result.current.current?.text).toBe('Last words.'));
  act(() => hook.result.current.pause());
  expect(onSave).toHaveBeenLastCalledWith(0.8, undefined);
  act(() => hook.result.current.play());
  await waitFor(() => expect(hook.result.current.current?.text).toBe('Last words.'));
  act(() => hook.result.current.stop());
  expect(onSave).toHaveBeenLastCalledWith(0.8, undefined);
  hook.unmount();
});
