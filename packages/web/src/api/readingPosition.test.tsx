import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { queryKeys, useSaveReadingPosition } from './hooks';
import type { LinkResponse } from './types';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const cached = () => client.getQueryData<LinkResponse>(queryKeys.link('a'))?.link;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<LinkResponse>(queryKeys.link('a'), {
    link: makeLink({ id: 'a', readingPosition: null }),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('updates the cached link at once, then takes the server timestamp, with no refetch', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ readingPosition: { position: 0.25, updatedAt: '2026-11-01T00:00:00Z' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  void result.current(0.25);
  expect(cached()?.readingPosition?.position).toBe(0.25);
  await waitFor(() => expect(cached()?.readingPosition?.updatedAt).toBe('2026-11-01T00:00:00Z'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/links/a/reading-position');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ position: 0.25, source: 'mark' });
});

it('rolls the cache back and rejects when the save fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 500 })),
  );
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  await expect(result.current(0.4)).rejects.toBeDefined();
  // The cache goes back to what the server last confirmed: nothing was saved.
  expect(cached()?.readingPosition).toBeNull();
});

it('sends a keepalive request that survives the page closing', () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  result.current(0.9, { keepalive: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.keepalive).toBe(true);
  expect(cached()?.readingPosition?.position).toBe(0.9);
});

it('does nothing to a link that is not cached', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  const { result } = renderHook(() => useSaveReadingPosition('missing'), { wrapper });
  result.current(0.5);
  expect(client.getQueryData(queryKeys.link('missing'))).toBeUndefined();
});

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const ok = (position: number) =>
  new Response(
    JSON.stringify({ readingPosition: { position, updatedAt: '2026-11-01T00:00:00Z' } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

it('sends one request at a time and only the newest position waits behind it', async () => {
  const first = deferred();
  const calls: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const position = JSON.parse(String(init.body)).position as number;
      calls.push(position);
      return calls.length === 1 ? first.promise : ok(position);
    }),
  );
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  const one = result.current(0.1);
  void result.current(0.2);
  const three = result.current(0.3);
  expect(calls).toEqual([0.1]);
  first.resolve(ok(0.1));
  await Promise.all([one, three]);
  expect(calls).toEqual([0.1, 0.3]); // 0.2 was replaced while 0.1 was out
  expect(cached()?.readingPosition?.position).toBe(0.3);
});

it('lets a stale response never overwrite a newer position', async () => {
  const first = deferred();
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      count += 1;
      return count === 1 ? first.promise : ok(JSON.parse(String(init.body)).position);
    }),
  );
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  const one = result.current(0.1);
  const two = result.current(0.9);
  expect(cached()?.readingPosition?.position).toBe(0.9);
  first.resolve(ok(0.1));
  await Promise.all([one, two]);
  expect(cached()?.readingPosition?.position).toBe(0.9);
});

it('cancels a refetch in flight so it cannot overwrite the new position', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ok(0.5)),
  );
  const cancel = vi.spyOn(client, 'cancelQueries');
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  await result.current(0.5);
  expect(cancel).toHaveBeenCalledWith({ queryKey: queryKeys.link('a') });
});

it('moves on to the newest position when an earlier request fails', async () => {
  const first = deferred();
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      count += 1;
      return count === 1 ? first.promise : ok(JSON.parse(String(init.body)).position);
    }),
  );
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  const one = result.current(0.1);
  const two = result.current(0.7);
  first.resolve(new Response('{}', { status: 500 }));
  await Promise.all([one, two]);
  expect(cached()?.readingPosition?.position).toBe(0.7);
});

it('keeps the newest source and serializes Remove behind an in-flight save', async () => {
  const first = deferred();
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) return first.promise;
      return new Response(null, { status: 204 });
    }),
  );
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  const pending = result.current(0.4, { source: 'listen' });
  expect(cached()?.readingPosition?.source).toBe('listen');
  void result.current(null);
  expect(cached()?.readingPosition).toBeNull();
  first.resolve(ok(0.4));
  await pending;
  expect(calls.map((call) => call.method)).toEqual(['PUT', 'DELETE']);
  expect(JSON.parse(String(calls[0]?.body))).toEqual({ position: 0.4, source: 'listen' });
  expect(cached()?.readingPosition).toBeNull();
});
