import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { queryKeys, useHighlightWrites, withPendingHighlights } from './hooks';
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

it('shows a new highlight at once as a pending row, then swaps in the server row', async () => {
  const gate = deferred();
  const fetchMock = vi.fn(() => gate.promise);
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  act(() => {
    added = result.current.add(draft);
  });
  expect(result.current.pending).toHaveLength(1);
  expect(result.current.pending[0]?.id).toMatch(/^pending-/);
  expect(cached()).toEqual([]);
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

it('keeps a pending highlight on screen when a refetch replaces the cache', async () => {
  const gate = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => gate.promise),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  act(() => {
    result.current.add(draft);
  });
  // A refetch lands with the server's list, which does not have the new row yet.
  act(() => {
    client.setQueryData<LinkResponse>(queryKeys.link('a'), {
      link: makeLink({ id: 'a', highlights: [] }),
    });
  });
  const shown = withPendingHighlights(cached(), result.current.pending);
  expect(shown.map((h) => h.quote)).toEqual(['quote']);
});

it('hides a pending copy as soon as the saved row shows, with no gap', async () => {
  const saved = server();
  const pending = [{ ...saved, id: 'pending-9', real: saved.id }];
  expect(withPendingHighlights([], pending)).toHaveLength(1);
  expect(withPendingHighlights([saved], pending)).toEqual([saved]);
});

it('removes the pending row and rejects when the create fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ error: 'x', message: 'no' }, 500)),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  act(() => {
    added = result.current.add(draft);
  });
  await act(async () => {
    await expect(added.saved).rejects.toBeDefined();
  });
  expect(result.current.pending).toEqual([]);
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
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
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

it('rolls an edit back to the last confirmed values and rejects when the save fails', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server({ note: 'old', color: 'blue' })] }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ error: 'x', message: 'no' }, 500)),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  await act(async () => {
    await expect(
      result.current.edit('real-1', { note: 'new', color: 'pink' }),
    ).rejects.toBeDefined();
  });
  expect(cached()[0]).toMatchObject({ note: 'old', color: 'blue' });
});

it('sends edits to one highlight one at a time, newest wins, and survives out-of-order replies', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server()] }),
  });
  const gates = [deferred(), deferred()];
  const sent: unknown[] = [];
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return (gates[calls++] as ReturnType<typeof deferred>).promise;
    }),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let all!: Promise<void>[];
  act(() => {
    all = [
      result.current.edit('real-1', { note: 'one' }),
      result.current.edit('real-1', { note: 'two' }),
      result.current.edit('real-1', { note: 'three', color: 'green' }),
    ];
  });
  await act(async () => {});
  // Only the first request is out; the rest wait behind it.
  expect(sent).toEqual([{ note: 'one' }]);
  expect(cached()[0]).toMatchObject({ note: 'three', color: 'green' });
  gates[0]?.resolve(reply({ highlight: server({ note: 'one' }) }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // The two newer edits merge into one request.
  expect(sent).toEqual([{ note: 'one' }, { note: 'three', color: 'green' }]);
  gates[1]?.resolve(reply({ highlight: server({ note: 'three', color: 'green' }) }));
  await act(async () => {
    await Promise.all(all);
  });
  expect(cached()[0]).toMatchObject({ note: 'three', color: 'green' });
});

it('keeps the newest edit when an older one fails, and rolls back only if the last fails', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server({ note: 'start' })] }),
  });
  const first = deferred();
  const replies = [
    first.promise,
    Promise.resolve(reply({ highlight: server({ note: 'newest' }) })),
  ];
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => replies[calls++]),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let all!: Promise<void>[];
  act(() => {
    all = [
      result.current.edit('real-1', { note: 'older' }),
      result.current.edit('real-1', { note: 'newest' }),
    ];
  });
  first.resolve(reply({ error: 'x', message: 'no' }, 500));
  await act(async () => {
    await Promise.all(all);
  });
  expect(cached()[0]?.note).toBe('newest');
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
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
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
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  await act(async () => {
    await result.current.remove('real-1');
  });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/highlights/real-1');
  expect(init.method).toBe('DELETE');
  expect(cached()).toEqual([]);
});

it('waits for the create before an edit made on the pending id, then uses the real id', async () => {
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
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  let edited!: Promise<void>;
  act(() => {
    added = result.current.add(draft);
    edited = result.current.edit(added.id, { note: 'late' });
  });
  expect(result.current.pending[0]?.note).toBe('late');
  expect(calls).toHaveLength(1);
  create.resolve(reply({ highlight: server() }, 201));
  await act(async () => {
    await added.saved;
    await edited;
  });
  expect(calls[1]?.[0]).toBe('/api/highlights/real-1');
  expect(cached()[0]).toMatchObject({ id: 'real-1', note: 'late' });
});

it('a failed delete of a still-saving row never brings back a pending id', async () => {
  const create = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) =>
      init.method === 'POST'
        ? create.promise
        : Promise.resolve(reply({ error: 'x', message: 'no' }, 500)),
    ),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let added!: ReturnType<typeof result.current.add>;
  let removed!: Promise<void>;
  act(() => {
    added = result.current.add(draft);
    removed = result.current.remove(added.id);
  });
  expect(result.current.pending).toEqual([]);
  create.resolve(reply({ highlight: server() }, 201));
  await act(async () => {
    await added.saved;
    await removed.catch(() => {});
  });
  // The create worked, the delete failed: the saved row returns under its real id.
  expect(cached().map((h) => h.id)).toEqual(['real-1']);
  expect(JSON.stringify(cached())).not.toContain('pending-');
});

it('does not bring back a highlight whose create failed when its delete fails too', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ error: 'x', message: 'no' }, 500)),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
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
  expect(result.current.pending).toEqual([]);
});

it('a note save that was in flight when the highlight was deleted is not reported as a failure', async () => {
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', highlights: [server()] }),
  });
  const patch = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) =>
      init.method === 'PATCH' ? patch.promise : Promise.resolve(reply(null, 204)),
    ),
  );
  const { result } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  let saved!: Promise<void>;
  let removed!: Promise<void>;
  act(() => {
    saved = result.current.edit('real-1', { note: 'blur save' });
    removed = result.current.remove('real-1');
  });
  patch.resolve(reply({ error: 'not_found', message: 'gone' }, 404));
  await act(async () => {
    await expect(saved).resolves.toBeUndefined();
    await removed;
  });
  expect(cached()).toEqual([]);
});

it('hands out callbacks that stay the same across re-renders', () => {
  vi.stubGlobal('fetch', vi.fn());
  const { result, rerender } = renderHook(() => useHighlightWrites('a', cached()), { wrapper });
  const first = result.current;
  rerender();
  expect(result.current.add).toBe(first.add);
  expect(result.current.edit).toBe(first.edit);
  expect(result.current.remove).toBe(first.remove);
  expect(result.current.resolveId).toBe(first.resolveId);
});
