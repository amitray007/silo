import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { queryKeys, useHighlightWrites } from './hooks';
import type { HighlightJson, LinkResponse } from './types';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const cached = () => client.getQueryData<LinkResponse>(queryKeys.link('a'))?.link.highlights ?? [];

const server = (overrides: Partial<HighlightJson> = {}): HighlightJson => ({
  id: 'real-1',
  quote: 'quote',
  prefix: '',
  suffix: '',
  startOffset: 0,
  endOffset: 5,
  color: 'yellow',
  note: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const draft = {
  quote: 'quote',
  prefix: '',
  suffix: '',
  startOffset: 0,
  endOffset: 5,
  color: 'yellow' as const,
};

const reply = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [] }),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('shows a new highlight at once and swaps in the server row', async () => {
  const gate = deferred();
  const fetchMock = vi.fn(() => gate.promise);
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  act(() => {
    added = result.current.add(draft);
  });
  expect(cached()).toHaveLength(1);
  expect(cached()[0]?.id).toMatch(/^pending-/);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/links/a/highlights');
  expect(init.method).toBe('POST');
  gate.resolve(reply({ highlight: server() }, 201));
  await act(async () => {
    await added.saved;
  });
  expect(cached().map((h) => h.id)).toEqual(['real-1']);
  expect(result.current.resolveId(added.id)).toBe('real-1');
});

it('removes the temporary row and rejects when the create fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ error: 'x', message: 'no' }, 500)),
  );
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  act(() => {
    added = result.current.add(draft);
  });
  await act(async () => {
    await expect(added.saved).rejects.toBeDefined();
  });
  expect(cached()).toEqual([]);
});

it('applies an edit at once and keeps it when the server agrees', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server()] }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      reply({ highlight: server({ note: 'hi', updatedAt: '2026-02-01T00:00:00Z' }) }),
    ),
  );
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  let done!: Promise<void>;
  act(() => {
    done = result.current.edit('real-1', { note: 'hi' });
  });
  expect(cached()[0]?.note).toBe('hi');
  await act(async () => {
    await done;
  });
  expect(cached()[0]).toMatchObject({ note: 'hi', updatedAt: '2026-02-01T00:00:00Z' });
});

it('rolls an edit back and rejects when the save fails', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server({ note: 'old', color: 'blue' })] }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ error: 'x', message: 'no' }, 500)),
  );
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  await act(async () => {
    await expect(
      result.current.edit('real-1', { note: 'new', color: 'pink' }),
    ).rejects.toBeDefined();
  });
  expect(cached()[0]).toMatchObject({ note: 'old', color: 'blue' });
});

it('removes at once and puts the highlight back where it was when the delete fails', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({
      id: 'a',
      highlights: [server({ id: 'x1' }), server({ id: 'x2' }), server({ id: 'x3' })],
    }),
  });
  const gate = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => gate.promise),
  );
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  let done!: Promise<void>;
  act(() => {
    done = result.current.remove('x2');
  });
  expect(cached().map((h) => h.id)).toEqual(['x1', 'x3']);
  gate.resolve(reply({ error: 'x', message: 'no' }, 500));
  await act(async () => {
    await expect(done).rejects.toBeDefined();
  });
  expect(cached().map((h) => h.id)).toEqual(['x1', 'x2', 'x3']);
});

it('deletes through DELETE /api/highlights/:id', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server()] }),
  });
  const fetchMock = vi.fn(async () => reply(null, 204));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  await act(async () => {
    await result.current.remove('real-1');
  });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/highlights/real-1');
  expect(init.method).toBe('DELETE');
  expect(cached()).toEqual([]);
});

it('waits for the create before an edit made on the temporary id, then uses the real id', async () => {
  const create = deferred();
  const calls: Array<[string, RequestInit]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push([url, init]);
      return init.method === 'POST'
        ? create.promise
        : Promise.resolve(reply({ highlight: server({ note: 'late' }) }));
    }),
  );
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  let edited!: Promise<void>;
  act(() => {
    added = result.current.add(draft);
    edited = result.current.edit(added.id, { note: 'late' });
  });
  expect(cached()[0]?.note).toBe('late');
  expect(calls).toHaveLength(1);
  create.resolve(reply({ highlight: server() }, 201));
  await act(async () => {
    await added.saved;
    await edited;
  });
  expect(calls[1]?.[0]).toBe('/api/highlights/real-1');
  expect(cached()[0]).toMatchObject({ id: 'real-1', note: 'late' });
});

it('does not bring back a highlight whose create failed when its delete rolls back', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ error: 'x', message: 'no' }, 500)),
  );
  const { result } = renderHook(() => useHighlightWrites('a'), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  let removed!: Promise<void>;
  act(() => {
    added = result.current.add(draft);
    removed = result.current.remove(added.id);
  });
  await act(async () => {
    await added.saved.catch(() => {});
    await removed.catch(() => {});
  });
  expect(cached()).toEqual([]);
});
