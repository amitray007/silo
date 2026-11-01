import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryKeys, useLink } from '../api/hooks';
import type { LinkJson, LinkResponse } from '../api/types';
import { TypeSheet } from '../components/reader/dock/TypeSheet';
import { HighlightSheet } from '../components/reader/highlights/HighlightSheet';
import { useHighlights } from '../components/reader/highlights/useHighlights';
import { ListenPlayer } from '../components/reader/listen/ListenPlayer';
import { ListenSheet } from '../components/reader/listen/ListenSheet';
import { useReadAloud } from '../components/reader/listen/useReadAloud';
import { PencilSheet } from '../components/reader/pencil/PencilSheet';
import { usePencil } from '../components/reader/pencil/usePencil';
import { makeLink } from '../test/fixtures';
import type { ReaderSettings } from './readerPrefs';
import { readerSync, useReaderType } from './readerPrefs';
import { type DeepPartial, mergeDeep } from './readerSync';
import { ReaderPrefsProvider, useReaderPrefs } from './useReaderPrefs';

vi.mock('../components/reader/listen/engines', async (original) => ({
  ...(await original<typeof import('../components/reader/listen/engines')>()),
  createEngine: () => ({
    load: async () => {},
    voices: () => [{ id: 'amy', label: 'Amy', language: 'en-us' }],
    dispose: () => {},
  }),
}));

type Overrides = DeepPartial<ReaderSettings>;
let nextId = 0;
let requests: { path: string; body: Overrides; keepalive: boolean }[];
let fail = false;
let rows: Map<string, Overrides>;
beforeEach(() => {
  localStorage.clear();
  readerSync.reset();
  requests = [];
  rows = new Map();
  fail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const { writtenAt: _writtenAt, ...body } = JSON.parse(
        String(init?.body ?? '{}'),
      ) as Overrides & { writtenAt?: string };
      requests.push({ path, body, keepalive: Boolean(init?.keepalive) });
      if (fail)
        return Response.json({ error: 'unavailable', message: 'Try again' }, { status: 503 });
      const readerPrefs = mergeDeep(rows.get(path) ?? {}, body);
      rows.set(path, readerPrefs);
      return Response.json({ readerPrefs });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  readerSync.reset();
});

function setup(overrides: Partial<LinkJson> = {}) {
  const link = makeLink({ id: `prefs-${nextId++}`, readerPrefs: {}, ...overrides });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ReaderPrefsProvider link={link}>{children}</ReaderPrefsProvider>
    </QueryClientProvider>
  );
  return { link, wrapper, client };
}

it('writes article overrides only; another article uses defaults; Settings reaches untouched fields', async () => {
  const a = setup();
  const b = setup();
  const first = renderHook(() => ({ article: useReaderPrefs(), defaults: useReaderType() }), {
    wrapper: a.wrapper,
  });
  const second = renderHook(useReaderPrefs, { wrapper: b.wrapper });
  act(() =>
    first.result.current.article.update({
      type: { size: 20 },
      readAloud: { voices: { phonon: 'amy' } },
    }),
  );
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]?.path).toBe(`/api/links/${a.link.id}/reader-prefs`);
  expect(requests[0]?.body).toEqual({
    type: { size: 20 },
    readAloud: { voices: { phonon: 'amy' } },
  });
  expect(second.result.current.prefs.type.size).toBe(16);
  expect(first.result.current.defaults.type.size).toBe(16);
  act(() => first.result.current.defaults.update({ size: 22, font: 'serif' }));
  expect(first.result.current.article.prefs.type).toMatchObject({ size: 20, font: 'serif' });
  expect(second.result.current.prefs.type).toMatchObject({ size: 22, font: 'serif' });
});

it('hydrates server overrides before paint and keeps both engines voices after a fresh mount', () => {
  const { wrapper } = setup({
    readerPrefs: {
      type: { size: 21 },
      readAloud: { voices: { phonon: 'amy', kokoro: 'af_heart' } },
    },
  });
  const { result } = renderHook(useReaderPrefs, { wrapper });
  expect(result.current.prefs.type.size).toBe(21);
  expect(result.current.prefs.readAloud.voices).toEqual({ phonon: 'amy', kokoro: 'af_heart' });
});

it('rolls back an unsuccessful new override so it follows later defaults again', async () => {
  fail = true;
  const { wrapper } = setup();
  const { result } = renderHook(() => ({ article: useReaderPrefs(), defaults: useReaderType() }), {
    wrapper,
  });
  act(() => result.current.article.update({ type: { size: 20 } }));
  expect(result.current.article.prefs.type.size).toBe(20);
  await waitFor(() => expect(result.current.article.prefs.type.size).toBe(16));
  act(() => result.current.defaults.update({ size: 22 }));
  expect(result.current.article.prefs.type.size).toBe(22);
});

it('keeps feed choices for this session without writes or changes to the defaults mirror', () => {
  const { wrapper } = setup({ feedId: 'feed' });
  const { result, unmount } = renderHook(useReaderPrefs, { wrapper });
  act(() =>
    result.current.update({
      width: 'wide',
      pencil: { wpm: 300 },
      readAloud: { pauses: 'natural' },
    }),
  );
  expect(result.current.prefs.width).toBe('wide');
  unmount();
  const again = renderHook(useReaderPrefs, { wrapper });
  expect(again.result.current.prefs.pencil.wpm).toBe(300);
  expect(requests).toEqual([]);
  expect(localStorage.getItem('silo.readerWidth')).toBeNull();
  const fresh = renderHook(useReaderPrefs, { wrapper: setup({ feedId: 'feed' }).wrapper });
  expect(fresh.result.current.prefs.width).toBe('medium');
});

it('debounces steppers and flushes pending article leaves with keepalive after navigation', async () => {
  vi.useFakeTimers();
  const { wrapper, link } = setup();
  const view = renderHook(useReaderPrefs, { wrapper });
  act(() => view.result.current.update({ type: { size: 19 } }, 400));
  act(() => view.result.current.update({ type: { size: 20 } }, 400));
  expect(requests).toHaveLength(0);
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(requests).toContainEqual({
    path: `/api/links/${link.id}/reader-prefs`,
    body: { type: { size: 20 } },
    keepalive: true,
  });
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(400));
});

function Controls({ link }: { link: LinkJson }) {
  const pencil = usePencil({
    prose: null,
    scroll: null,
    saved: null,
    canSave: false,
    onSave: async () => {},
  });
  const listen = useReadAloud({ prose: null, scroll: null });
  const highlights = useHighlights({
    link,
    prose: null,
    scroll: null,
    writable: true,
    autoColor: null,
  });
  return (
    <>
      <section aria-label="Type">
        <TypeSheet />
      </section>
      <section aria-label="Pencil">
        <PencilSheet pencil={pencil} />
      </section>
      <section aria-label="Highlight">
        <HighlightSheet color={highlights.color} setColor={highlights.setColor} />
      </section>
      <section aria-label="Listen">
        <ListenSheet listen={listen} />
      </section>
      <ListenPlayer listen={listen} sheetOpen={false} onSheet={() => {}} onClose={() => {}} />
      <button type="button" onClick={listen.warm}>
        Warm
      </button>
    </>
  );
}

it('uses the engine fallback for a stale default voice without creating an article override', async () => {
  localStorage.setItem(
    'silo.readerReadAloud',
    JSON.stringify({ voices: { phonon: 'removed-voice' } }),
  );
  const { link, wrapper } = setup({ highlights: [] });
  render(<Controls link={link} />, { wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Voice' }).hasAttribute('disabled')).toBe(false),
  );
  expect(requests).toEqual([]);
});

it('Type, width, Pencil, highlight, Listen choices and player speed all write this link', async () => {
  const { link, wrapper } = setup({ highlights: [] });
  render(<Controls link={link} />, { wrapper });
  fireEvent.click(screen.getByRole('radio', { name: 'Literata' }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase size' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Wide' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Highlighter' }));
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Pencil' })).getByRole('button', {
      name: 'Increase speed',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'blue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Voice' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Amy' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Natural' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speed 1x' }));
  fireEvent.click(screen.getByRole('button', { name: 'Voice engine' }));
  fireEvent.click(await screen.findByRole('option', { name: /Kokoro/ }));
  await waitFor(() =>
    expect(rows.get(`/api/links/${link.id}/reader-prefs`)).toEqual({
      type: { font: 'serif', size: 17 },
      width: 'wide',
      pencil: { style: 'highlighter', wpm: 260 },
      highlight: { color: 'blue' },
      readAloud: { engine: 'kokoro', voices: { phonon: 'amy' }, pauses: 'natural', rate: 1.25 },
    }),
  );
  expect(requests.every((request) => request.path === `/api/links/${link.id}/reader-prefs`)).toBe(
    true,
  );
  expect(localStorage.getItem('silo.readerType')).toBeNull();
});

it('ignores an old detail prop after a successful write, and accepts a fresh GET', async () => {
  const { client, link } = setup();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let prefs: ReturnType<typeof useReaderPrefs>;
  function Probe() {
    prefs = useReaderPrefs();
    return <output>{prefs.prefs.type.size}</output>;
  }
  const view = render(
    <ReaderPrefsProvider link={link}>
      <Probe />
    </ReaderPrefsProvider>,
    { wrapper },
  );
  await act(async () => prefs.update({ type: { size: 20 } }));
  await waitFor(() =>
    expect(rows.get(`/api/links/${link.id}/reader-prefs`)).toEqual({ type: { size: 20 } }),
  );
  view.rerender(
    <ReaderPrefsProvider link={{ ...link, readerPrefs: { type: { size: 16 } } }}>
      <Probe />
    </ReaderPrefsProvider>,
  );
  expect(screen.getByRole('status').textContent).toBe('20');
  // A GET started after the write carries the current local version and can hydrate.
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ link: { ...link, readerPrefs: { type: { size: 22 } } } }),
  );
  const detail = renderHook(() => useLink(link.id), { wrapper });
  await waitFor(() =>
    expect(detail.result.current.data?.link.readerPrefs).toEqual({ type: { size: 22 } }),
  );
  const fresh = detail.result.current.data?.link;
  if (!fresh) throw new Error('Missing fresh detail');
  view.rerender(
    <ReaderPrefsProvider link={fresh}>
      <Probe />
    </ReaderPrefsProvider>,
  );
  expect(screen.getByRole('status').textContent).toBe('22');
});

it('cancels an in-flight detail GET on edit, even when fetch ignores abort and resolves after PATCH', async () => {
  const { client, link } = setup();
  client.setQueryData<LinkResponse>(queryKeys.link(link.id), { link });
  let finishGet: (response: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  const serve = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (init?.method !== 'PATCH') {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        finishGet = resolve;
      });
    }
    if (!serve) throw new Error('Missing server');
    return serve(input, init);
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let prefs: ReturnType<typeof useReaderPrefs>;
  function Probe() {
    prefs = useReaderPrefs();
    return <output>{prefs.prefs.type.size}</output>;
  }
  function Detail() {
    const { data } = useLink(link.id);
    return (
      <ReaderPrefsProvider link={data?.link ?? link}>
        <Probe />
      </ReaderPrefsProvider>
    );
  }
  render(<Detail />, { wrapper });
  await waitFor(() => expect(signal).toBeDefined());
  await act(async () => prefs.update({ type: { size: 20 } }));
  await waitFor(() =>
    expect(client.getQueryData<LinkResponse>(queryKeys.link(link.id))?.link.readerPrefs).toEqual({
      type: { size: 20 },
    }),
  );
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    finishGet(Response.json({ link: { ...link, readerPrefs: { type: { size: 16 } } } })),
  );
  expect(screen.getByRole('status').textContent).toBe('20');
  expect(client.getQueryData<LinkResponse>(queryKeys.link(link.id))?.link.readerPrefs).toEqual({
    type: { size: 20 },
  });
});
