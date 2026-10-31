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
  result.current(0.25);
  expect(cached()?.readingPosition?.position).toBe(0.25);
  await waitFor(() => expect(cached()?.readingPosition?.updatedAt).toBe('2026-11-01T00:00:00Z'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/links/a/reading-position');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ position: 0.25 });
});

it('keeps the local value when the save fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 500 })),
  );
  const { result } = renderHook(() => useSaveReadingPosition('a'), { wrapper });
  result.current(0.4);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(cached()?.readingPosition?.position).toBe(0.4);
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
