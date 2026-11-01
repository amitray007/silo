import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ReaderSettings,
  readAloudPrefsDefaults,
  readerSync,
  readerTypeDefaults,
  useReadAloudPrefs,
  useReaderType,
} from '../lib/readerPrefs';
import { mergeDeep } from '../lib/readerSync';
import { useReaderWidth } from '../lib/useReaderWidth';
import { ReaderSettingsSync } from './ReaderSettingsSync';

const FULL: ReaderSettings = {
  type: { ...readerTypeDefaults },
  width: 'medium',
  pencil: { style: 'underline', wpm: 240 },
  highlight: { color: 'yellow' },
  readAloud: { ...readAloudPrefsDefaults },
};

const KEYS = [
  'silo.readerType',
  'silo.readerWidth',
  'silo.readerPencil',
  'silo.readerHighlight',
  'silo.readerReadAloud',
];

/** A stateful stand-in for `/api/settings`: PATCH merges a partial reader over the stored one. */
function fakeServer(initial: ReaderSettings | null, options: { failPatch?: boolean } = {}) {
  let reader = initial;
  const patches: unknown[] = [];
  let fail = options.failPatch ?? false;
  const settings = () => ({ theme: 'system', trashPurgeDays: 30, reader });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { reader: unknown };
        patches.push(body.reader);
        if (fail) return Response.json({ error: 'x', message: 'no' }, { status: 500 });
        reader = mergeDeep(reader ?? FULL, body.reader);
      }
      return Response.json(settings());
    }),
  );
  return {
    patches,
    set: (next: ReaderSettings | null) => {
      reader = next;
    },
    failNext: (value: boolean) => {
      fail = value;
    },
    get reader() {
      return reader;
    },
  };
}

function Providers({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ReaderSettingsSync />
      {children}
    </QueryClientProvider>
  );
}

function Probe() {
  const { type, update } = useReaderType();
  const [width, setWidth] = useReaderWidth();
  const { prefs } = useReadAloudPrefs();
  return (
    <>
      <output>{`${type.font}/${type.size}/${width}/${prefs.rate}/${prefs.voices.kokoro}`}</output>
      <button type="button" onClick={() => update({ font: 'serif' })}>
        serif
      </button>
      <button type="button" onClick={() => setWidth('wide')}>
        wide
      </button>
    </>
  );
}

beforeEach(() => {
  for (const key of KEYS) localStorage.removeItem(key);
  readerSync.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // Put the stores back to defaults for the next test.
  for (const key of KEYS) localStorage.removeItem(key);
  readerSync.reset();
});

describe('ReaderSettingsSync', () => {
  it('paints from the local mirror, then the server value wins', async () => {
    localStorage.setItem('silo.readerType', JSON.stringify({ v: 1, font: 'mono', size: 18 }));
    const server = fakeServer({
      ...FULL,
      type: { font: 'serif', size: 20, leading: 'relaxed', theme: 'sepia' },
      width: 'narrow',
      readAloud: { engine: 'kokoro', voices: { phonon: '', kokoro: 'af_heart' }, rate: 1.5 },
    });
    render(<Probe />, { wrapper: Providers });
    // First paint: the mirror, before the server answers.
    expect(screen.getByRole('status').textContent).toBe('mono/18/medium/1/');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('serif/20/narrow/1.5/af_heart'),
    );
    // The mirror now holds the server value, for the next first paint.
    expect(JSON.parse(localStorage.getItem('silo.readerType') ?? '{}')).toMatchObject({
      font: 'serif',
      size: 20,
      theme: 'sepia',
    });
    expect(localStorage.getItem('silo.readerWidth')).toBe('narrow');
    expect(server.patches).toEqual([]);
  });

  it('uploads local values once when the server has none', async () => {
    localStorage.setItem('silo.readerType', JSON.stringify({ v: 1, font: 'mono', size: 18 }));
    localStorage.setItem('silo.readerWidth', 'wide');
    const server = fakeServer(null);
    render(<Probe />, { wrapper: Providers });
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0]).toMatchObject({
      type: { font: 'mono', size: 18, leading: 'normal', theme: 'default' },
      width: 'wide',
    });
    expect(server.reader?.type.font).toBe('mono');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.patches).toHaveLength(1);
  });

  it('uploads nothing for a browser with no local values', async () => {
    const server = fakeServer(null);
    render(<Probe />, { wrapper: Providers });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.patches).toEqual([]);
    // Positive control: this fresh sync still sends when the user edits.
    act(() => screen.getByText('wide').click());
    await waitFor(() => expect(server.patches).toHaveLength(1));
  });

  it('sends a change as a partial patch and every subscriber follows', async () => {
    const server = fakeServer(FULL);
    const view = render(
      <>
        <Probe />
        <Probe />
      </>,
      { wrapper: Providers },
    );
    await waitFor(() => expect(server.patches).toEqual([]));
    act(() => view.getAllByText('serif')[0]?.click());
    expect(view.getAllByRole('status').map((node) => node.textContent)).toEqual([
      'serif/16/medium/1/',
      'serif/16/medium/1/',
    ]);
    await waitFor(() => expect(server.patches).toEqual([{ type: { font: 'serif' } }]));
  });

  it('rolls the local value back when the server refuses the change', async () => {
    const server = fakeServer(FULL, { failPatch: true });
    render(<Probe />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('inter/16/medium/1/'));
    act(() => screen.getByText('wide').click());
    expect(screen.getByRole('status').textContent).toBe('inter/16/wide/1/');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('inter/16/medium/1/'));
    expect(localStorage.getItem('silo.readerWidth')).toBe('medium');
    expect(server.patches).toEqual([{ width: 'wide' }]);
  });

  it('debounces stepper changes into one request', async () => {
    const server = fakeServer(FULL);
    const view = renderHook(() => ({ type: useReaderType(), aloud: useReadAloudPrefs() }), {
      wrapper: Providers,
    });
    await waitFor(() => expect(view.result.current.type.type.size).toBe(16));
    vi.useFakeTimers();
    act(() => view.result.current.type.update({ size: 17 }));
    act(() => view.result.current.type.update({ size: 18 }));
    act(() => view.result.current.type.update({ size: 19 }));
    act(() => view.result.current.aloud.update({ rate: 1.25 }));
    act(() => view.result.current.aloud.update({ rate: 1.5 }));
    expect(view.result.current.type.type.size).toBe(19);
    expect(server.patches).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(server.patches).toEqual([{ type: { size: 19 }, readAloud: { rate: 1.5 } }]);
  });

  it('a second profile with the same server picks up the settings', async () => {
    const server = fakeServer({ ...FULL, type: { ...FULL.type, font: 'mono' } });
    // A fresh browser: nothing in localStorage at all.
    render(<Probe />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('mono/'));
    expect(server.patches).toEqual([]);
  });
});

it.each([
  ['silo.readerType', JSON.stringify({ font: 'mono' }), { type: { font: 'mono' } }],
  ['silo.readerWidth', 'wide', { width: 'wide' }],
  ['silo.readerPencil', JSON.stringify({ wpm: 300 }), { pencil: { wpm: 300 } }],
  ['silo.readerHighlight', JSON.stringify({ color: 'pink' }), { highlight: { color: 'pink' } }],
  ['silo.readerReadAloud', JSON.stringify({ rate: 2 }), { readAloud: { rate: 2 } }],
])('migrates an existing mirror from %s', async (key, value, expected) => {
  localStorage.setItem(key, value);
  const server = fakeServer(null);
  render(<Probe />, { wrapper: Providers });
  await waitFor(() => expect(server.patches).toHaveLength(1));
  expect(server.patches[0]).toMatchObject(expected);
});

it('preserves the full mirror when the user edits before the initial GET answers', async () => {
  localStorage.setItem('silo.readerType', JSON.stringify({ font: 'mono', size: 22 }));
  const server = fakeServer(null);
  const serve = vi.mocked(fetch).getMockImplementation();
  let answer: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    answer = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (init?.method !== 'PATCH') await ready;
    if (!serve) throw new Error('Missing fake server');
    return serve(input, init);
  });
  render(<Probe />, { wrapper: Providers });
  act(() => screen.getByText('wide').click());
  expect(server.patches).toEqual([]);
  await act(async () => answer?.());
  await waitFor(() => expect(server.patches).toHaveLength(1));
  expect(server.reader?.type).toMatchObject({ font: 'mono', size: 22 });
  expect(server.reader?.width).toBe('wide');
});

it('times out a hung PATCH and sends the next queued edit', async () => {
  const server = fakeServer({ ...FULL, type: { ...FULL.type, font: 'mono' } });
  const serve = vi.mocked(fetch).getMockImplementation();
  let hung = true;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (init?.method === 'PATCH' && hung) {
      hung = false;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Timed out', 'AbortError')),
        );
      });
    }
    if (!serve) throw new Error('Missing fake server');
    return serve(input, init);
  });
  render(<Probe />, { wrapper: Providers });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('mono/16/medium/1/'));
  vi.useFakeTimers();
  act(() => screen.getByText('wide').click());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  act(() => screen.getByText('serif').click());
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(server.patches).toEqual([{ type: { font: 'serif' } }]);
  expect(screen.getByRole('status').textContent).toBe('serif/16/medium/1/');
});
