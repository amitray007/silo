import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys, useCounts, useInfiniteLinks, useSearchLinks, useTags } from './hooks';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('queryKeys', () => {
  it('builds stable, distinct keys for later invalidation', () => {
    expect(queryKeys.counts()).toEqual(['counts']);
    expect(queryKeys.tags()).toEqual(['tags']);
    expect(queryKeys.links({ tag: 'mcp' })).toEqual(['links', { tag: 'mcp' }]);
    expect(queryKeys.links()).toEqual(['links', {}]);
    expect(queryKeys.link('abc')).toEqual(['link', 'abc']);
  });
});

describe('useCounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the counts payload', async () => {
    const counts = { live: 12, trash: 3, purgeWindowDays: 30 };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(counts));

    const { result } = renderHook(() => useCounts(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(counts);
    expect(fetch).toHaveBeenCalledWith('/api/counts');
  });

  it('surfaces an error state when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useCounts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 500, error: 'internal_error' });
  });
});

describe('useTags', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the tags payload', async () => {
    const tags = {
      tags: [
        { name: 'mcp', count: 4 },
        { name: 'essays', count: 2 },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(tags));

    const { result } = renderHook(() => useTags(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(tags);
    expect(fetch).toHaveBeenCalledWith('/api/tags');
  });
});

describe('useInfiniteLinks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advances through pages via the opaque cursor and stops when nextCursor is absent', async () => {
    const page1 = { links: [{ id: '1' }], nextCursor: 'cursor-abc' };
    const page2 = { links: [{ id: '2' }] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toEqual([page1]);
    expect(result.current.hasNextPage).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/links');

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toEqual([page1, page2]));
    expect(fetch).toHaveBeenCalledWith('/api/links?cursor=cursor-abc');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('goes from loading to success with the first page', async () => {
    const page1 = { links: [{ id: '1' }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(page1));

    const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toEqual([page1]);
  });

  it('surfaces an error state when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 500, error: 'internal_error' });
  });

  it('scopes the request to ?tag= when a tag is passed (plan 011, V3-2 /tags/:name filtering)', async () => {
    const page1 = { links: [{ id: '1' }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(page1));

    const { result } = renderHook(() => useInfiniteLinks('mcp'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp');
  });

  it('combines ?tag= and ?cursor= on a subsequent page', async () => {
    const page1 = { links: [{ id: '1' }], nextCursor: 'cursor-abc' };
    const page2 = { links: [{ id: '2' }] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const { result } = renderHook(() => useInfiniteLinks('mcp'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp&cursor=cursor-abc');
  });

  it('a differently-tagged call uses a distinct cache key (fetches independently)', async () => {
    const responseA = { links: [{ id: 'a' }] };
    const responseB = { links: [] as unknown[] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(responseA))
      .mockResolvedValueOnce(jsonResponse(responseB));

    const { result: resultA } = renderHook(() => useInfiniteLinks('mcp'), { wrapper });
    const { result: resultB } = renderHook(() => useInfiniteLinks('ai'), { wrapper });

    await waitFor(() => expect(resultA.current.isSuccess).toBe(true));
    await waitFor(() => expect(resultB.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp');
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=ai');
  });
});

describe('useSearchLinks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and returns results for a non-empty query', async () => {
    const response = { results: [{ id: '1', rank: 0.5 }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSearchLinks('typescript'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=typescript');
  });

  it('is disabled (never fetches) for an empty/blank query', () => {
    renderHook(() => useSearchLinks('   '), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trims the query before both the request and the cache key', async () => {
    const response = { results: [] as unknown[] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSearchLinks('  hooks  '), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=hooks');
  });

  it('an empty result set resolves cleanly (the "nothing found" case)', async () => {
    const response = { results: [] as unknown[] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSearchLinks('nosuchtermxyz'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });

  it('re-enables and fetches when the query goes from blank to non-blank', async () => {
    const response = { results: [{ id: '1', rank: 1 }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result, rerender } = renderHook(({ q }) => useSearchLinks(q), {
      wrapper,
      initialProps: { q: '' },
    });
    expect(fetch).not.toHaveBeenCalled();

    rerender({ q: 'typescript' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=typescript');
  });
});
